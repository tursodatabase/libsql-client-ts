# Changelog

## Unreleased

- Switch to Hrana 2 by default to let Hrana 3 cook some more.

## 0.3.3 -- 2023-09-11

- Updated `@libsql/hrana-client` to version 0.5.1, which has Bun support.

## 0.3.2 -- 2023-07-29

- Updated `@libsql/hrana-client` to version 0.5.0, which implements Hrana 3
    - Dropped workarounds for broken WebSocket support in Miniflare 2
- Added a `@libsql/client/node` import for explicit Node.js-specific module

## 0.3.1 -- 2023-07-20

- Added `ResultSet.toJSON()` to provide better JSON serialization. ([#61](https://github.com/libsql/libsql-client-ts/pull/61))
- Added conditional exports to `package.json` that redirect the default import of `@libsql/client` to `@libsql/client/web` on a few supported edge platforms. ([#65](https://github.com/libsql/libsql-client-ts/pull/65))
- Added `Config.fetch` to support overriding the `fetch` implementation from `@libsql/isomorphic-fetch`. ([#66](https://github.com/libsql/libsql-client-ts/pull/66))

## 0.3.0 -- 2023-07-07

- **Changed the order of parameters to `batch()`**, so that the transaction mode is passed as the second parameter. ([#57](https://github.com/libsql/libsql-client-ts/pull/57))
- **Changed the default transaction mode to `"deferred"`**. ([#57](https://github.com/libsql/libsql-client-ts/pull/57))
- Added `Client.protocol` property to find out which protocol the client uses ([#54](https://github.com/libsql/libsql-client-ts/pull/54)).

## 0.2.2 -- 2023-06-22

- Added `intMode` field to the `Config`, which chooses whether SQLite integers are represented as numbers, bigints or strings in JavaScript ([#51](https://github.com/libsql/libsql-client-ts/pull/51)).

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
