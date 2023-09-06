import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { supportedUrlLink } from "./util.js";

import { _createClient as _createWsClient } from "./ws.js";
import { _createClient as _createHttpClient } from "./http.js";
import { _createClient as _createBunSqliteClient } from "./bun_sqlite.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
}

export const isBun = () => {
    if ((globalThis as any).Bun || (globalThis as any).process?.versions?.bun) return;
    throw new LibsqlError("Bun is not available", "BUN_NOT_AVAILABLE");
};

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    isBun();
    if (config.scheme === "ws" || config.scheme === "wss") {
        return _createWsClient(config);
    } else if (config.scheme === "http" || config.scheme === "https") {
        return _createHttpClient(config);
    } else if (config.scheme === "file") {
        return _createBunSqliteClient(config);
    } else {
        throw new LibsqlError(
            'The Bun client supports "file", "libsql:", "wss:", "ws:", "https:" and "http:" URLs, ' +
                `got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED"
        );
    }
}
