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
  url: "file:/tmp/example.db"
};
const db = createClient(config);
const rs = await db.execute("SELECT * FROM users");
console.log(rs);
```

## Features

* Connect to `sqld` (with HTTP or WebSockets)
* Connect to a local SQLite database
