# libSQL Wasm example for browsers

## Building

Run the following in the `packages/libsql-client-wasm` directory:

```
npm run build
```

Run the following in this directory:

```
npm i
./node_modules/.bin/esbuild --target=safari16 index.js --bundle --outfile=dist/out.js --format=esm
cp ../../../../node_modules/@libsql/libsql-wasm-experimental/sqlite-wasm/jswasm/sqlite3.wasm dist
```

and open the app in browser:

```
npx http-server -o
```
