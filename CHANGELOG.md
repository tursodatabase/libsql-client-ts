# Changelog

## Unreleased

## 0.2.0 -- 2023-06-07

- **Added support for interactive transactions over HTTP** by using `@libsql/hrana-client` version 0.4 ([#44](https://github.com/libsql/libsql-client-ts/pull/44))
- Added `?tls=0` query parameter to turn off TLS for `libsql:` URLs
- Changed the `libsql:` URL to use HTTP instead of WebSockets
- Changed the `Value` type to include `bigint` (so that we can add support for reading integers as bigints in the future, without breaking compatibility)
- Removed the `./hrana` import, added `./ws` to import the WebSocket-only client
