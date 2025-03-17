# Changelog

## Unreleased

-   Bump to latest `libsql` package.

## 0.15.0-pre.3 -- 2024-03-11

-   Fix Bun complaint about duplicate "prepare" key in `package.json`

## 0.15.0-pre.2 -- 2024-02-11

-   Bump to latest `libsql` package.

## 0.15.0-pre.1 -- 2024-11-15

-   Initial support for offline writes.

## 0.12.0 -- 2024-09-16

-   Upgrade `hrana-client-ts` to latest 0.7.0 version which has stable `isomorphic-fetch` implementation (see https://github.com/libsql/hrana-client-ts/pull/19)

## 0.11.0 -- 2024-09-13

-   Upgrade `libsql-js` to latest 0.4.4 version which brings full vector search support for embedded replicas (see vector search documentation here: https://docs.turso.tech/features/ai-and-embeddings)

## 0.10.0 -- 2024-08-26

-   Add a migrate() API that can be used to do migrations on both schema databases and regular databases. It is mostly dedicated to schema migration tools.

## 0.8.1 -- 2024-08-03

-   Fix embedded replica sync WAL index path name , which caused "No such file or directory" for local sync in some cases ([#244](https://github.com/tursodatabase/libsql-client-ts/issues/244)).

## 0.8.0 -- 2024-07-30

-   No changes from 0.8.0-pre.1.

## 0.8.0-pre.1 -- 2024-07-18

-   Bump hrana client to 0.6.2.
-   Support `cache=private|shared` [query parameter](https://www.sqlite.org/uri.html#recognized_query_parameters) in the connection string to local SQLite (https://github.com/tursodatabase/libsql-client-ts/pull/220)
-   Fix bug in wasm experimental client which appears when transaction are used in local mode (https://github.com/tursodatabase/libsql-client-ts/pull/231)
-   Add `execute(sql, args)` overload to make the API similar to other SQLite SDKs

## 0.7.0 -- 2024-06-25

-   Add configurable concurrency limit for parallel query execution
    (defaults to 20) to address socket hangup errors.

## 0.6.2 -- 2024-06-01

-   Fix compatibility issue with libSQL server versions that don't have migrations endpoint.

## 0.6.1 -- 2024-05-30

-   Add an option to `batch()` to wait for schema changes to finish when using shared schema.

## 0.6.0 -- 2024-04-28

-   Bump hrana client to 0.6.0, which uses native Node fetch(). Note that
    `@libsql/client` now requires Node 18 or later.

## 0.5.6 -- 2024-03-12

-   Bump `libsql` package dependency to 0.3.10 that adds `wasm32` as
    supported CPU, which is needed for StackBlitz compatibility.

## 0.5.5 -- 2024-03-11

-   Bump `@libsql/libsql-wasm-experimental"` dependency to 0.0.2, which
    fixes a broken sqlite3_get_autocommit() export.

## 0.5.4 -- 2024-03-11

-   Bump `libsql` dependency to 0.3.9, which fixes symbol not found errors on Alpine.

## 0.5.3 -- 2024-03-06

-   Add `syncInterval` config option to enable periodic sync.
-   Bump `libsql` dependency to 0.3.7, which switches default encryption cipher to aes256cbs.

## 0.5.2 -- 2024-02-24

-   Disable SQL statemen tracing in Wasm.

## 0.5.1 -- 2024-02-19

-   Update `libsql` package to 0.3.2, add `encryptionCipher` option, and switch default cipher to SQLCipher.

## 0.5.0 -- 2024-02-15

-   Add a `encryptionKey` config option, which enables encryption at rest for local database files.

## 0.4.0 -- 2024-01-26

-   Update hrana-client package to 0.5.6.
-   Add a `@libsql/client-wasm` package.
-   Fix Bun on Linux/arm64.

## 0.3.6 -- 2023-10-20

-   Fix import problems on Cloudflare Workers.
-   Add `rawCode` property to errors for local databases.
-   Update the `libsql` package to version 0.1.28.

## 0.3.5 -- 2023-09-25

-   Performance improvements for local database access by reusing connection in `Client`.
-   Embedded replica support.
-   Column introspection support via ResultSet.columnTypes property.

## 0.3.4 -- 2023-09-11

-   Switch to Hrana 2 by default to let Hrana 3 cook some more.

## 0.3.3 -- 2023-09-11

-   Updated `@libsql/hrana-client` to version 0.5.1, which has Bun support.

-   Switched to `libsql` package as a replacement for `better-sqlite3`.

## 0.3.2 -- 2023-07-29

-   Updated `@libsql/hrana-client` to version 0.5.0, which implements Hrana 3
    -   Dropped workarounds for broken WebSocket support in Miniflare 2
-   Added a `@libsql/client/node` import for explicit Node.js-specific module

## 0.3.1 -- 2023-07-20

-   Added `ResultSet.toJSON()` to provide better JSON serialization. ([#61](https://github.com/libsql/libsql-client-ts/pull/61))
-   Added conditional exports to `package.json` that redirect the default import of `@libsql/client` to `@libsql/client/web` on a few supported edge platforms. ([#65](https://github.com/libsql/libsql-client-ts/pull/65))
-   Added `Config.fetch` to support overriding the `fetch` implementation from `@libsql/isomorphic-fetch`. ([#66](https://github.com/libsql/libsql-client-ts/pull/66))

## 0.3.0 -- 2023-07-07

-   **Changed the order of parameters to `batch()`**, so that the transaction mode is passed as the second parameter. ([#57](https://github.com/libsql/libsql-client-ts/pull/57))
-   **Changed the default transaction mode to `"deferred"`**. ([#57](https://github.com/libsql/libsql-client-ts/pull/57))
-   Added `Client.protocol` property to find out which protocol the client uses ([#54](https://github.com/libsql/libsql-client-ts/pull/54)).

## 0.2.2 -- 2023-06-22

-   Added `intMode` field to the `Config`, which chooses whether SQLite integers are represented as numbers, bigints or strings in JavaScript ([#51](https://github.com/libsql/libsql-client-ts/pull/51)).

## 0.2.1 -- 2023-06-13

-   Added `TransactionMode` argument to `batch()` and `transaction()` ([#46](https://github.com/libsql/libsql-client-ts/pull/46))
-   Added `Client.executeMultiple()` and `Transaction.executeMultiple()` ([#49](https://github.com/libsql/libsql-client-ts/pull/49))
-   Added `Transaction.batch()` ([#49](https://github.com/libsql/libsql-client-ts/pull/49))
-   **Changed the default transaction mode** from `BEGIN DEFERRED` to `BEGIN IMMEDIATE`

## 0.2.0 -- 2023-06-07

-   **Added support for interactive transactions over HTTP** by using `@libsql/hrana-client` version 0.4 ([#44](https://github.com/libsql/libsql-client-ts/pull/44))
-   Added `?tls=0` query parameter to turn off TLS for `libsql:` URLs
-   Changed the `libsql:` URL to use HTTP instead of WebSockets
-   Changed the `Value` type to include `bigint` (so that we can add support for reading integers as bigints in the future, without breaking compatibility)
-   Removed the `./hrana` import, added `./ws` to import the WebSocket-only client
