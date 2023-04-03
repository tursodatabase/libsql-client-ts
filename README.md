# JavaScript & TypeScript SDK for libSQL

[![Node.js CI](https://github.com/libsql/libsql-client-ts/actions/workflows/ci.yaml/badge.svg)](https://github.com/libsql/libsql-client-ts/actions/workflows/ci.yaml)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/libsql/libsql-client-ts/blob/main/LICENSE)

This is the source repository of the JavaScript & TypeScript SDK for libSQL. You can either connect to a local SQLite/libSQL database (embedded in the client) or to a remote libSQL server.

## Installation

```
npm install @libsql/client
```

## Getting Started

Connecting to a local SQLite/libSQL database:

```typescript
import { createClient } from "@libsql/client"

const config = {
  url: "file:local.db"
};
const db = createClient(config);
const rs = await db.execute("SELECT * FROM users");
console.log(rs);
```

Connecting to a remote [libSQL server](https://github.com/libsql/sqld):

```typescript
import { createClient } from "@libsql/client"

const config = {
  url: "ws://localhost:8080"
};
const db = createClient(config);
const rs = await db.execute("SELECT * FROM users");
console.log(rs);
```

## Supported URLs

The client can connect to the database using different methods depending on the scheme (protocol) of the passed URL:

* `file:` connects to a local SQLite database (using `better-sqlite3`)
  * `file:/absolute/path` or `file:///absolute/path` is an absolute path on local filesystem
  * `file:relative/path` is a relative path on local filesystem
  * (`file://path` is not a valid URL)
* `ws:` or `wss:` connect to `sqld` using WebSockets (the Hrana protocol).
* `http:` or `https:` connect to `sqld` using HTTP. The `transaction()` API is not available in this case.
* `libsql:` is equivalent to `wss:`.

## License

This project is licensed under the MIT license.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in `sqld` by you, shall be licensed as MIT, without any additional terms or conditions.
