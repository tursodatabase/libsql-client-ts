<p align="center">
  <a href="https://tur.so/turso-ts">
    <picture>
      <img src="/.github/cover.png" alt="libSQL TypeScript" />
    </picture>
  </a>
  <h1 align="center">libSQL TypeScript</h1>
</p>

<p align="center">
  Databases for all TypeScript and JS multi-tenant apps.
</p>

<p align="center">
  <a href="https://tur.so/turso-ts"><strong>Turso</strong></a> ·
  <a href="https://docs.turso.tech"><strong>Docs</strong></a> ·
  <a href="https://docs.turso.tech/sdk/ts/quickstart"><strong>Quickstart</strong></a> ·
  <a href="https://docs.turso.tech/sdk/ts/reference"><strong>SDK Reference</strong></a> ·
  <a href="https://turso.tech/blog"><strong>Blog &amp; Tutorials</strong></a>
</p>

<p align="center">
  <a href="LICENSE">
    <picture>
      <img src="https://img.shields.io/github/license/tursodatabase/libsql-client-ts?color=0F624B" alt="MIT License" />
    </picture>
  </a>
  <a href="https://tur.so/discord-ts">
    <picture>
      <img src="https://img.shields.io/discord/933071162680958986?color=0F624B" alt="Discord" />
    </picture>
  </a>
  <a href="#contributors">
    <picture>
      <img src="https://img.shields.io/github/contributors/tursodatabase/libsql-client-ts?color=0F624B" alt="Contributors" />
    </picture>
  </a>
  <a href="https://www.npmjs.com/package/@libsql/client">
    <picture>
      <img src="https://img.shields.io/npm/dw/%40libsql%2Fclient?color=0F624B" alt="Weekly downloads" />
    </picture>
  </a>
  <a href="/examples">
    <picture>
      <img src="https://img.shields.io/badge/browse-examples-0F624B" alt="Examples" />
    </picture>
  </a>
</p>

## Features

-   🔌 Works offline with [Embedded Replicas](https://docs.turso.tech/features/embedded-replicas/introduction)
-   🌎 Works with remote Turso databases
-   ✨ Works with Turso [AI & Vector Search](https://docs.turso.tech/features/ai-and-embeddings)
-   🔐 Supports [encryption at rest](https://docs.turso.tech/libsql#encryption-at-rest)

## Install

```bash
npm install @libsql/client
```

## Quickstart

The example below uses Embedded Replicas and syncs every minute from Turso.

```ts
import { createClient } from "@libsql/client";

export const turso = createClient({
    url: "file:local.db",
    syncUrl: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
    syncInterval: 60000,
});

await turso.batch(
    [
        "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
        {
            sql: "INSERT INTO users(name) VALUES (?)",
            args: ["Iku"],
        },
    ],
    "write",
);

await turso.execute({
    sql: "SELECT * FROM users WHERE id = ?",
    args: [1],
});
```

## Examples

| Example                               | Description                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| [local](examples/local)               | Uses libsql with a local SQLite file. Creates database, inserts data, and queries.      |
| [remote](examples/remote)             | Connects to a remote database. Requires environment variables for URL and auth token.   |
| [sync](examples/sync)                 | Demonstrates synchronization between local and remote databases.                        |
| [batch](examples/batch)               | Executes multiple SQL statements in a single batch operation.                           |
| [transactions](examples/transactions) | Shows transaction usage: starting, performing operations, and committing/rolling back.  |
| [memory](examples/memory)             | Uses an in-memory SQLite database for temporary storage or fast access.                 |
| [vector](examples/vector)             | Works with vector embeddings, storing and querying for similarity search.               |
| [encryption](examples/encryption)     | Creates and uses an encrypted SQLite database, demonstrating setup and data operations. |
| [ollama](examples/ollama)             | Similarity search with Ollama and Mistral.                                              |

## Attaching Databases

libSQL supports attaching multiple SQLite databases to a single connection, allowing cross-database queries using schema prefixes.

### Config-Based Attachment (Static)

For databases that exist at client creation time:

```typescript
import { createClient } from "@libsql/client";

const client = createClient({
    url: "file:main.db",
    attach: [{ alias: "analytics", path: "file:analytics.db?mode=ro" }],
});

// Query main database
await client.execute("SELECT * FROM users");

// Query attached database
await client.execute("SELECT * FROM analytics.events");

// Cross-database JOIN
await client.execute(`
  SELECT u.name, COUNT(e.id) as event_count
  FROM users u
  LEFT JOIN analytics.events e ON u.id = e.user_id
  GROUP BY u.id
`);
```

### Explicit Attachment (Dynamic)

For databases that don't exist at client creation time:

```typescript
const client = createClient({ url: "file:main.db" });

// Later, when database becomes available
await client.attach("obs", "file:observability.db?mode=ro");

// Query newly attached database
await client.execute("SELECT * FROM obs.traces");

// Detach when no longer needed
await client.detach("obs");
```

### Read-Only Attachments

Use the `file:` URI scheme with `?mode=ro` parameter to attach databases in read-only mode. This prevents write lock conflicts when another connection is writing to the attached database:

```typescript
// Config-based
const client = createClient({
    url: "file:main.db",
    attach: [{ alias: "analytics", path: "file:analytics.db?mode=ro" }],
});

// Explicit
await client.attach("obs", "file:observability.db?mode=ro");
```

**When to use read-only mode:**

-   Attached database has a dedicated writer connection
-   You only need to read from the attached database
-   Prevents `SQLITE_BUSY` errors from lock contention

### Persistence Across Transactions

Both config and explicit attachments automatically persist across connection recycling (e.g., after `transaction()`):

```typescript
const client = createClient({
    url: "file:main.db",
    attach: [{ alias: "analytics", path: "analytics.db" }],
});

await client.attach("obs", "observability.db");

// Both work before transaction
await client.execute("SELECT * FROM analytics.events");
await client.execute("SELECT * FROM obs.traces");

// Create transaction (may recycle connection internally)
const tx = await client.transaction();
await tx.execute("INSERT INTO main_table VALUES (1)");
await tx.commit();

// Both still work after transaction ✅
await client.execute("SELECT * FROM analytics.events");
await client.execute("SELECT * FROM obs.traces");
```

This fixes a bug where ATTACH statements were lost after transactions in previous versions.

### API Methods

```typescript
interface Client {
    /**
     * Attach a database at runtime.
     * Persists across transaction() and connection recycling.
     */
    attach(alias: string, path: string): Promise<void>;

    /**
     * Detach a previously attached database.
     * Detachment persists across transaction() and connection recycling.
     */
    detach(alias: string): Promise<void>;
}
```

### Notes

-   Attached databases use schema prefixes: `analytics.table_name`
-   Config attachments applied on client creation
-   Explicit attachments applied when `attach()` is called
-   Both types re-applied automatically after connection recycling
-   Failed attachments (e.g., missing file) log warnings but don't crash
-   Duplicate aliases throw `ATTACH_DUPLICATE` error

## Documentation

Visit our [official documentation](https://docs.turso.tech/sdk/ts).

## Support

Join us [on Discord](https://tur.so/discord-ts) to get help using this SDK. Report security issues [via email](mailto:security@turso.tech).

## Contributors

See the [contributing guide](CONTRIBUTING.md) to learn how to get involved.

![Contributors](https://contrib.nn.ci/api?repo=tursodatabase/libsql-client-ts)

<a href="https://github.com/tursodatabase/libsql-client-ts/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22">
  <picture>
    <img src="https://img.shields.io/github/issues-search/tursodatabase/libsql-client-ts?label=good%20first%20issue&query=label%3A%22good%20first%20issue%22%20&color=0F624B" alt="good first issue" />
  </picture>
</a>
