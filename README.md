# JavaScript & TypeScript SDK for libSQL

[![Node.js CI](https://github.com/libsql/libsql-client-ts/actions/workflows/ci.yaml/badge.svg)](https://github.com/libsql/libsql-client-ts/actions/workflows/ci.yaml)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/libsql/libsql-client-ts/blob/main/LICENSE)

This is the source repository of the JavaScript & TypeScript SDK for libSQL.

You can use this SDK to interact with the following types of databases:

- Local SQLite/libSQL database files
- [Remote libSQL databases], including [Turso]

## Installation

```shell
npm install @libsql/client
```

This step is not required if using the Deno style import shown below.

### Using the library with Next.js

To use `libsql-client`, you need to add the following to your Next configuration:

```javascript
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["libsql"],
  },
}

module.exports = nextConfig
```

> [!NOTE]
> If you are using Next.js v13.5.5 or above, this is done automatically for you.

## Create a database client object

### Importing

There are multiple ways to import the module. For Node.js and other environments where you need to use a local SQLite [file URL](#local-sqlite-file-urls), as well as network access to `sqld`:

```typescript
import { createClient } from "@libsql/client";
```

For environments that don't have a local filesystem, but support HTTP or WebSockets, including:

- Browsers
- CloudFlare Workers
- Vercel Edge Functions
- Netlify Edge Functions

```typescript
import { createClient } from "@libsql/client/web";
```

For Deno:

```typescript
// replace [version] with the client version
import { createClient } from "https://esm.sh/@libsql/client@[version]/web";
```

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

To connect to a [libSQL sqld] instance using a [libsql: URL](#libsql-urls):

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

If you are querying a `sqld` instance on your local machine, add `?tls=0` to the URL to disable TLS.

`authToken` in the config object is a token that your sqld instance recognizes to allow client access. For Turso databases, [a token is obtained using the Turso CLI][turso-cli-token]. No token is required by default when running `sqld` on its own.


## Supported URLs

The client can connect to the database using different methods depending on the scheme (protocol) of the passed URL:

### Local SQLite file URLs

A `file:` URL connects to a local SQLite database (using [libsql]).

- This is only supported on Node.js. It will not work in the browser or with most hosted environments that don't provide access to a local filesystem.
- `file:/absolute/path` or `file:///absolute/path` is an absolute path on local filesystem.
- `file:relative/path` is a relative path on local filesystem.
- `file://path` is not a valid URL.

### libSQL sqld instances

The client can connect to `sqld` using HTTP or WebSockets. Internally, it uses the Hrana protocol implemented by [hrana-client-ts].

#### libsql URLs

`libsql:` URL leaves the choice of protocol to the client. We are now using HTTP by default, but this may change in the future.

- By default, a `libsql:` URL uses TLS (i.e. `https:` or `wss:`).
- To disable TLS, you can pass the query parameter `?tls=0`. You will also need to specify the port.

#### HTTP URLs

`http:` or `https:` URLs connect to `sqld` using HTTP.

- This is supported in Node.js and in every environment that supports the [Web fetch API].

#### WebSocket URLs

`ws:` or `wss:` URLs use a stateful WebSocket to connect to `sqld`.

- WebSockets are supported in Node.js and browser.
- If you are running in a cloud or edge hosted environments, you should check to see if WebSockets are supported. If not, change the URL to use an [HTTP URL](#http-urls).

## Additional documentation

You can find more examples of how to use this library using the [Turso docs for JS&TS][turso-js-ts].

## License

This project is licensed under the MIT license.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in `@libsql/client` by you, shall be licensed as MIT, without any additional terms or conditions.

[Turso]: https://docs.turso.tech
[Remote libSQL databases]: https://github.com/libsql/sqld
[turso-cli-token]: https://docs.turso.tech/reference/turso-cli#authentication-tokens-for-client-access
[libsql]: https://github.com/libsql/libsql
[hrana-client-ts]: https://github.com/libsql/hrana-client-ts
[Web fetch API]: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
[turso-js-ts]: https://docs.turso.tech/reference/client-access/javascript-typescript-sdk
