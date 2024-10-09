<p align="center">
  <a href="https://tur.so/turso-ts">
    <picture>
      <img src="/.github/cover.png" alt="libSQL TypeScript" />
    </picture>
  </a>
  <h1 align="center">libSQL TypeScript</h1>
</p>

<p align="center">
  Databases for TypeScript and JS multi-tenant AI Apps.
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
  <a href="https://packagist.org/packages/turso/libsql">
    <picture>
      <img src="https://img.shields.io/packagist/dt/turso/libsql?color=0F624B" alt="Total downloads" />
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

> [!WARNING]
> This SDK is currently in technical preview. <a href="https://tur.so/discord-ts">Join us in Discord</a> to report any issues.

## Install

```bash
npm install @libsql/client
```

> [!NOTE]
> This will only work with the Android Gradle Plugin for now.

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

await client.batch(
    [
        "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
        {
            sql: "INSERT INTO users VALUES (?)",
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

## Documentation

Visit our [official documentation](https://docs.turso.tech/sdk/kotlin).

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
