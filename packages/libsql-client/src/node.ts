import type { Config, Client } from "@libsql/core/api";
import { LibsqlError } from "@libsql/core/api";
import type { ExpandedConfig } from "@libsql/core/config";
import { expandConfig } from "@libsql/core/config";
import { _createClient as _createSqlite3Client } from "./sqlite3.js";
import { _createClient as _createWsClient } from "./ws.js";
import { _createClient as _createHttpClient } from "./http.js";

export * from "@libsql/core/api";

/** Creates a {@link Client} object.
 *
 * You must pass at least an `url` in the {@link Config} object.
 */
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
