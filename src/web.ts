import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { _createClient as _createHranaClient } from "./hrana.js";
import { _createClient as _createHttpClient } from "./http.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config));
}

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    const scheme = config.scheme.toLowerCase();
    if (scheme === "libsql" || scheme === "wss" || scheme === "ws") {
        return _createHranaClient(config);
    } else if (scheme === "https" || scheme === "http") {
        return _createHttpClient(config);
    } else {
        throw new LibsqlError(
            'The client that uses Web standard APIs supports only "libsql", "wss", "ws", "https" and "http" URLs, ' +
                `got ${JSON.stringify(config.scheme)}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
}
