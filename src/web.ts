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
    const url = config.url;
    if (url.protocol === "http:" || url.protocol === "https:") {
        return _createHttpClient(config);
    } else if (url.protocol === "ws:" || url.protocol === "wss:" || url.protocol === "libsql:") {
        return _createHranaClient(config);
    } else {
        throw new LibsqlError(
            `URL scheme ${JSON.stringify(url.protocol)} is not supported`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
}
