const config = require('config')
const express = require('express')
const mbgl = require('@mapbox/mapbox-gl-native')
// const tilebelt = require('@mapbox/tilebelt')
const vtpbf = require('vt-pbf')
// const request = require('request')
const sharp = require('sharp')
const fs = require('fs')
const Queue = require('better-queue')
const MBTiles = require('@mapbox/mbtiles')
const zlib = require('zlib')
const genericPool = require('generic-pool')

const htdocsPath = config.get('htdocsPath')
const stylePath = config.get('stylePath')
const spriteJsonPath = config.get('spriteJsonPath')
const spritePngPath = config.get('spritePngPath')
const port = config.get('port')
const mbtilesDir = config.get('mbtilesDir')
const defaultZ = config.get('defaultZ')
const fontsDir = config.get('fontsDir')

const tile2long = (x, z) => {
  return x / 2 ** z * 360 - 180
}

const tile2lat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

mbgl.on('message', msg => {
  console.log(msg)
})

const emptyTile = vtpbf({ features: [] })
const etag = 'a'

let mbtilesPool = {}
let tz = config.get('tz')

const createResponse = data => {
  return {
    modified: new Date(),
    expires: new Date(),
    etag: etag,
    data: data
  }
}

const getMBTiles = async (t, z, x, y) => {
  if (!tz[t]) tz[t] = defaultZ
  const mbtilesPath = z < tz[t] ? `${mbtilesDir}/0-0-0.mbtiles` :
    `${mbtilesDir}/${tz[t]}-${x >> (z - tz[t])}-${y >> (z - tz[t])}.mbtiles`
  return new Promise((resolve, reject) => {
    if (mbtilesPool[mbtilesPath]) {
      resolve(mbtilesPool[mbtilesPath])
    } else {
      if (fs.existsSync(mbtilesPath)) {
        new MBTiles(`${mbtilesPath}?mode=ro`, (err, mbtiles) => {
          if (err) return reject(err)
          // console.log(`${mbtilesPath} was newly open.`)
          mbtilesPool[mbtilesPath] = mbtiles
          resolve(mbtiles)
        })
      } else {
        reject(new Error(`${mbtilesPath} was not found.`))
      }
    }
  })
}

const getTile = (url) => {
  return new Promise((resolve, reject) => {
    let r = url.split('/')
    const t = r[r.length - 4]
    const z = parseInt(r[r.length - 3])
    const x = parseInt(r[r.length - 2])
    const y = parseInt(r[r.length - 1].split('.')[0])
    getMBTiles(t, z, x, y)
      .then(mbtiles => {
        mbtiles.getTile(z, x, y, (err, tile, headers) => {
          if (err) {
            resolve(emptyTile)
          } else {
            resolve(zlib.gunzipSync(tile))
          }
        })
      }).catch(e => {
        resolve(emptyTile)
      })
  })
}

const getFont = async (url) => {
  return new Promise((resolve, reject) => {
    let r = url.split('/')
    let fontstack = r[r.length - 2]
    let range = r[r.length - 1].split('.')[0]
    const fontPath = `${fontsDir}/${fontstack}/${range}.pbf.gz`
    fs.readFile(fontPath, (err, gz) => {
      if (err) {
        reject(err)
      } else {
        zlib.gunzip(gz, (err, data) => {
          if (err) {
            reject(err)
          } else {
            resolve(data)
          }
        })
      }
    })
  })
}

const mbglRequestQueue = new Queue((req, cb) => {
  switch (req.kind) {
    case 6:
      fs.readFile(spriteJsonPath, (err, data) => {
        if (err) cb(err)
        cb(null, data)
      })
      break
    case 5:
      fs.readFile(spritePngPath, (err, data) => {
        if (err) cb(err)
        cb(null, data)
      })
      break
    case 4:
      getFont(req.url).then(data => {
        cb(null, data)
      })
      break
    case 3:
      getTile(req.url).then(tile => {
        cb(null, tile)
      })
      break
    default:
  }
}, { concurrent: 6 })

const maps = genericPool.createPool({
  create: function () {
    const map = new mbgl.Map({
      request: (req, cb) => {
        mbglRequestQueue.push(req, (err, data) => {
          if (err) cb(err)
          cb(null, createResponse(data))
        })
      },
      mode: 'tile',
    })
    map.load(require(stylePath))
    return map
  },
  destroy: function (map) {
    map.release()
  }
}, {
  max: 10,
  min: 2
})

const tileQueue = new Queue((r, cb) => {
  const [t, z, x, y] = [r.t, r.z, r.x, r.y]
  const center = [ tile2long(x + 0.5, z), tile2lat(y + 0.5, z) ]

  maps.acquire().then(map => {
    map.render({
      zoom: z,
      center: center,
      width: z > 2 ? 1024 : 512,
      height: z > 2 ? 1024 : 512
      //width: 512,
      //height: 512
    }, (err, buffer) => {
      maps.release(map)
      if (err) return cb(err)
      let image = sharp(buffer, {
        raw: {
          width: z > 2 ? 1024 : 512,
          height: z > 2 ? 1024 : 512,
          //width: 512,
          //height: 512,
          channels: 4
        }
      })
      if (z > 2) {
        image = image.extract({
          left: 256, top: 256, width: 512, height: 512
        })
      }
      cb(null, image)
    })
  })
}, { concurrent: 6 })

const app = express()
app.use(express.static(htdocsPath))

app.get('/:t/:z/:x/:y.png', (req, res) => {
  tileQueue.push({
    t: req.params.t,
    z: parseInt(req.params.z),
    x: parseInt(req.params.x),
    y: parseInt(req.params.y)
  }, (err, image) => {
    if (err) {
      res.send(err)
    } else {
      res.set('content-type', 'image/png')
      image.png().toBuffer()
        .then((result) => {
          res.send(result)
        })
    }
  })
})

app.listen(port, () => {
  console.log(`server is ready at ${port}`)
})
