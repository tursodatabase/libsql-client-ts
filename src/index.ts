import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
import { expandConfig } from "./config.js";
import { createClient as createSqlite3Client } from "./sqlite3.js";
import { createClient as createWebClient } from "./web.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    const expandedConfig = expandConfig(config);
    const url = expandedConfig.url;
    if (url.protocol === "file:") {
        return createSqlite3Client(expandedConfig);
    } else {
        return createWebClient(expandedConfig);
    }
}
