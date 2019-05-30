# carbon
[image-tile-server](https://github.com/hfu/image-tile-server) to be integrated with [onyx](https://github.com/un-vector-tile-toolkit/onyx)

# limitations: Works with Node 8 only
As discussed [here](https://github.com/mapbox/mapbox-gl-native/issues/12252), node-mapbox-gl-native has some issue with Node 10. Please use Node 8. See also `.node-version`.

# install
```console
git clone git@github.com:hfu/carbon
cd carbon
npm install
vi config/default.hjson
```

# use
```console
vi config/default.hjson
npm run-script Xvfb
./pmstart.sh
# ...
./pmstop.sh
```

I renamed pmserve.sh to pmstart.sh since this time. 
