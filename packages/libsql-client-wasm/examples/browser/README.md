# libSQL Wasm example for browsers

## Building

Run the following in top-level directory of this repository:

```
npm run build
```

Then run the following in this directory:

```
./node_modules/.bin/esbuild --target=safari16 index.js --bundle --outfile=dist/out.js --format=esm
```

and open the app in browser:

```
npx http-server -o .
```
