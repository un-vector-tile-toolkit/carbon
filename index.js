const config = require('config')
const express = require('express')
const mbgl = require('@mapbox/mapbox-gl-native')
const tilebelt = require('@mapbox/tilebelt')
const vtpbf = require('vt-pbf')
const request = require('request')
const sharp = require('sharp')
const fs = require('fs')
const Queue = require('better-queue')

const htdocsPath = config.get('htdocsPath')
const stylePath = config.get('stylePath')
const spriteJsonPath = config.get('spriteJsonPath')
const spritePngPath = config.get('spritePngPath')
const port = config.get('port')

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
const app = express()
app.use(express.static(htdocsPath))

const createResponse = data => {
  return {
    modified: new Date(),
    expires: new Date(),
    etag: etag,
    data: data
  }
}

const getTile = (url) => {
  return emptyTile
}

const map = new mbgl.Map({
  request: (req, cb) => {
    console.log(req)
    switch(req.kind) {
      case 6:
        fs.readFile(spriteJsonPath, (err, data) => {
          if (err) throw err
          cb(null, createResponse(data))
        })
        break
      case 5:
        fs.readFile(spritePngPath, (err, data) => {
          if (err) throw err
          cb(null, createResponse(data))
        })
        break
      case 3:
        cb(null, createResponse(getTile(req.url)))
        break
      default:
    }
  }
})

map.load(require(stylePath))

app.listen(port, () => {
  console.log(`server is ready at ${port}`)
})
