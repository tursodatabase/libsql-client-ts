import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { _createClient as _createSqlite3Client } from "./sqlite3.js";
import { supportedUrlLink } from "./help.js";
import { _createClient as _createHranaClient } from "./hrana.js";
import { _createClient as _createHttpClient } from "./http.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config));
}

function _createClient(config: ExpandedConfig) {
    const scheme = config.scheme.toLowerCase();
    if (scheme === "file") {
        return _createSqlite3Client(config);
    } else if (scheme === "libsql" || scheme === "wss" || scheme === "ws") {
        return _createHranaClient(config);
    } else if (scheme === "https" || scheme === "http") {
        return _createHttpClient(config);
    } else {
        throw new LibsqlError(
            'The client supports only "file:", "libsql:", "wss:", "ws:", "https:" and "http:" URLs, ' +
                `got ${JSON.stringify(config.scheme + ":")}. ` +
                `For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
}
