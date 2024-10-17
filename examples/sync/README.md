# Sync

This example demonstrates how to use libSQL with a synced database (local file synced with a remote database).

## Install Dependencies

```bash
npm i
```

## Running

Execute the example:

```bash
TURSO_DATABASE_URL="..." TURSO_AUTH_TOKEN="..." node index.mjs
```

This will connect to a remote SQLite database, insert some data, and then query the results.
