import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
import { expandConfig } from "./config.js";
import { createClient as createHranaClient } from "./hrana.js";
import { createClient as createHttpClient } from "./http.js";
import { createClient as createSqlite3Client } from "./sqlite3.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    const expandedConfig = expandConfig(config);
    const url = expandedConfig.url;
    if (url.protocol === "http:" || url.protocol === "https:") {
        return createHttpClient(expandedConfig);
    } else if (url.protocol === "ws:" || url.protocol === "wss:" || url.protocol === "libsql:") {
        return createHranaClient(expandedConfig);
    } else if (url.protocol === "file:") {
        return createSqlite3Client(expandedConfig);
    } else {
        throw new LibsqlError(
            `URL scheme ${JSON.stringify(url.protocol)} is not supported`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
}
