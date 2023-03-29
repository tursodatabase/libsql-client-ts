import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
import { expandConfig } from "./config.js";
import { createClient as createHranaClient } from "./hrana.js";
import { createClient as createHttpClient } from "./http.js";

export function createClient(config: Config): Client {
    const expandedConfig = expandConfig(config);
    const url = expandedConfig.url;
    if (url.protocol === "http:" || url.protocol === "https:") {
        return createHttpClient(expandedConfig);
    } else if (url.protocol === "ws:" || url.protocol === "wss:" || url.protocol === "libsql:") {
        return createHranaClient(expandedConfig);
    } else {
        throw new LibsqlError(
            `URL scheme ${JSON.stringify(url.protocol)} is not supported`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
}
