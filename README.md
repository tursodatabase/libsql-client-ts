# JavaScript & TypeScript SDK for libSQL

[![Node.js CI](https://github.com/libsql/libsql-client-ts/actions/workflows/ci.yaml/badge.svg)](https://github.com/libsql/libsql-client-ts/actions/workflows/ci.yaml)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/libsql/libsql-client-ts/blob/main/LICENSE)

This is the source repository of the JavaScript & TypeScript SDK for libSQL. You can use it to interact with the following types of databases:

- Local SQLite database files
- [libSQL sqld] instances (including [Turso])

## Installation

```shell
npm install @libsql/client
```

This step is not required if using the Deno style import shown below.

## Create a database client object

### Importing

There are multiple ways to import the module. For Node.js and other environments where you need to use a local SQLite [file URL](#local-sqlite-file-urls), as well as network access to `sqld`:

```typescript
import { createClient } from "@libsql/client";
```

For environments that don't have a local filesystem, but support HTTP or WebSockets, including:

- Browsers
- CloudFlare Workers
- Netlify Edge Functions

```typescript
import { createClient } from "@libsql/client/web";
```

For environments that only support HTTP, including Vercel Edge Functions:

```typescript
import { createClient } from "@libsql/client/http";
```

For Deno:

```typescript
// replace [version] with the client version
import { createClient } from "https://esm.sh/@libsql/client@[version]/web";
```

In each case, the client API is the same, with the exception that [HTTP URLs](#http-urls) don't support interactive transactions.

### Local SQLite files

To connect to a local SQLite database file using a [local file URL](#local-sqlite-file-urls):

```typescript
const config = {
  url: "file:local.db"
};
const db = createClient(config);
const rs = await db.execute("SELECT * FROM users");
console.log(rs);
```

### libSQL sqld instance

To connect to a [libSQL sqld] instance using a [WebSocket URL](#websocket-urls) or [HTTP URL](#http-urls):

```typescript
import { createClient } from "@libsql/client"

const config = {
  url: "libsql://[your-sqld-host]",
  authToken: "[your-token]"
};
const db = createClient(config);
const rs = await db.execute("SELECT * FROM users");
console.log(rs);
```

If you are querying a `sqld` instance on your local machine, use the `ws:` URL it provides.

`authToken` in the config object is a token that your sqld instance recognizes to allow client access. For Turso databases, [a token is obtained using the Turso CLI][turso-cli-token]. No token is required by default when running `sqld` on its own.


## Supported URLs

The client can connect to the database using different methods depending on the scheme (protocol) of the passed URL:

### Local SQLite file URLs

A `file:` URL connects to a local SQLite database (using [better-sqlite3]).

- This is only supported on Node.js. It will not work in the browser or with most hosted environments that don't provide access to a local filesystem.
- `file:/absolute/path` or `file:///absolute/path` is an absolute path on local filesystem.
- `file:relative/path` is a relative path on local filesystem.
- `file://path` is not a valid URL.

### libSQL sqld instances

#### WebSocket URLs

`ws:`, `wss:`, or `libsql:` URLs use a stateful WebSocket to connect to `sqld`.

- `libsql:` always uses `wss:` internally (using TLS at the transport layer).
- WebSockets are implemented using the Hrana protocol implemented by [hrana-client-ts].
- WebSockets are supported in Node.js and browser.
- If you are running in a cloud or edge hosted environments, you should check to see if WebSockets are supported. If not, change the URL to use an [HTTP URL](#http-urls).

#### HTTP URLs

`http:` or `https:` URLs connect to `sqld` using HTTP.

- This is supported in Node.js and in every environment that supports the [web fetch API].
- Interactive transactions using `transaction()` are not supported over HTTP, as it requires a stateful connection to the server.

## Additional documentation

You can find more examples of how to use this library using the [Turso docs for JS&TS][turso-js-ts].

## License

This project is licensed under the MIT license.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in `@libsql/client` by you, shall be licensed as MIT, without any additional terms or conditions.


[Turso]: https://docs.turso.tech
[libSQL sqld]: https://github.com/libsql/sqld
[turso-cli-token]: https://docs.turso.tech/reference/turso-cli#authentication-tokens-for-client-access
[better-sqlite3]: https://github.com/WiseLibs/better-sqlite3
[hrana-client-ts]: https://github.com/libsql/hrana-client-ts
[web fetch API]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
[turso-js-ts]: https://docs.turso.tech/reference/client-access/javascript-typescript-sdk
