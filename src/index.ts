import type { Config, Client } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { _createClient as _createSqlite3Client } from "./sqlite3.js";
import { _createClient as _createWebClient } from "./web.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config));
}

function _createClient(config: ExpandedConfig) {
    const url = config.url;
    if (url.protocol === "file:") {
        return _createSqlite3Client(config);
    } else {
        return _createWebClient(config);
    }
}
