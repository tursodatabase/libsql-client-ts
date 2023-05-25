import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { _createClient as _createSqlite3Client } from "./sqlite3.js";
import { _createClient as _createWsClient } from "./ws.js";
import { _createClient as _createHttpClient } from "./http.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
}

function _createClient(config: ExpandedConfig) {
    if (config.scheme === "wss" || config.scheme === "ws") {
        return _createWsClient(config);
    } else if (config.scheme === "https" || config.scheme === "http") {
        return _createHttpClient(config);
    } else {
        return _createSqlite3Client(config);
    }
}
