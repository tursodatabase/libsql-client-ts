# Changelog

## 0.2.1 -- 2023-06-13

- Added `TransactionMode` argument to `batch()` and `transaction()` ([#46](https://github.com/libsql/libsql-client-ts/pull/46))
- Added `Client.executeMultiple()` and `Transaction.executeMultiple()` ([#49](https://github.com/libsql/libsql-client-ts/pull/49))
- Added `Transaction.batch()` ([#49](https://github.com/libsql/libsql-client-ts/pull/49))
- **Changed the default transaction mode** from `BEGIN DEFERRED` to `BEGIN IMMEDIATE`

## 0.2.0 -- 2023-06-07

- **Added support for interactive transactions over HTTP** by using `@libsql/hrana-client` version 0.4 ([#44](https://github.com/libsql/libsql-client-ts/pull/44))
- Added `?tls=0` query parameter to turn off TLS for `libsql:` URLs
- Changed the `libsql:` URL to use HTTP instead of WebSockets
- Changed the `Value` type to include `bigint` (so that we can add support for reading integers as bigints in the future, without breaking compatibility)
- Removed the `./hrana` import, added `./ws` to import the WebSocket-only client
