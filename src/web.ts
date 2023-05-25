import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { supportedUrlLink } from "./help.js";
import { _createClient as _createWsClient } from "./ws.js";
import { _createClient as _createHttpClient } from "./http.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
}

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    if (config.scheme === "ws" || config.scheme === "wss") {
        return _createWsClient(config);
    } else if (config.scheme === "http" || config.scheme === "https") {
        return _createHttpClient(config);
    } else {
        throw new LibsqlError(
            'The client that uses Web standard APIs supports only "libsql:", "wss:", "ws:", "https:" and "http:" URLs, ' +
                `got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
}
