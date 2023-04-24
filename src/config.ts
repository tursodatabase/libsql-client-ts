import type { Config } from "./api.js";
import { LibsqlError } from "./api.js";
import type { Authority } from "./uri.js";
import { parseUri } from "./uri.js";

export interface ExpandedConfig {
    scheme: string;
    authority: Authority | undefined;
    path: string;
    authToken: string | undefined;
}

export function expandConfig(config: Config): ExpandedConfig {
    const uri = parseUri(config.url);

    let authToken = config.authToken;
    for (const {key, value} of uri.query?.pairs ?? []) {
        if (key === "authToken") {
            authToken = value ? value : undefined;
        } else {
            throw new LibsqlError(
                `Unknown URL query parameter ${JSON.stringify(key)}`, 
                "URL_PARAM_NOT_SUPPORTED",
            );
        }
    }

    if (uri.fragment !== undefined) {
        throw new LibsqlError(
            `URL fragments are not supported: ${JSON.stringify("#" + uri.fragment)}`,
            "URL_INVALID",
        );
    }

    return {
        scheme: uri.scheme,
        authority: uri.authority,
        path: uri.path,
        authToken,
    };
}
