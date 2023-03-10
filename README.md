# libSQL client API for TypeScript and JavaScript

[![Node.js CI](https://github.com/libsql/libsql-client-ts/actions/workflows/node-ci.yaml/badge.svg)](https://github.com/libsql/libsql-client-ts/actions/workflows/node-ci.yaml)

## Getting Started

To get started, you need `sqld` running somewhere. Then:

```typescript
import { createClient } from "@libsql/client"

const config = {
  url: "http://localhost:8080"
};
const db = createClient(config);
const rs = await db.execute("SELECT * FROM users");
console.log(rs);
```

You can also just run against local SQLite with:

```typescript
import { createClient } from "@libsql/client"

const config = {
  url: "file:example.db" // Use "file::memory:" for in-memory mode.
};
const db = createClient(config);
const rs = await db.execute("SELECT * FROM users");
console.log(rs);
```

## Features

* SQLite JavaScript API
* SQLite-backed local-only backend
* SQL over HTTP with `fetch()`
