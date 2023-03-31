# libSQL client API for TypeScript and JavaScript

[![Node.js CI](https://github.com/libsql/libsql-client-ts/actions/workflows/ci.yaml/badge.svg)](https://github.com/libsql/libsql-client-ts/actions/workflows/ci.yaml)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/libsql/libsql-client-ts/blob/main/LICENSE)

## Getting Started

To get started, you need `sqld` running somewhere. Then:

```typescript
import { createClient } from "@libsql/client"

const config = {
  url: "ws://localhost:8080"
};
const db = createClient(config);
const rs = await db.execute("SELECT * FROM users");
console.log(rs);
```

You can also connect to a local SQLite database with:

```typescript
import { createClient } from "@libsql/client"

const config = {
  url: "file:local.db"
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
