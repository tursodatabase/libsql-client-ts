import type { Config } from "./api.js";
import { LibsqlError } from "./api.js";

export interface ExpandedConfig extends Config {
    url: URL;
    authToken: string | undefined;
}

export function expandConfig(config: Config): ExpandedConfig {
    const url = config.url instanceof URL ? config.url : new URL(config.url);

    let authToken = config.authToken;
    for (const [key, value] of url.searchParams.entries()) {
        if (key === "authToken") {
            authToken = value ? value : undefined;
        } else {
            throw new LibsqlError(
                `Unknown URL query parameter ${JSON.stringify(key)}`, 
                "URL_PARAM_NOT_SUPPORTED",
            );
        }
    }

    for (const key of Array.from(url.searchParams.keys())) {
        url.searchParams.delete(key);
    }

    return {url, authToken};
}

export function mapLibsqlUrl(url: URL, protocol: string): URL {
    if (url.protocol === "libsql:") {
        // we can't use the `URL.protocol` setter, because the specification forbids changing a non-special
        // scheme ("libsql") to special scheme ("https").
        return new URL(protocol + url.toString().substring(url.protocol.length));
    } else {
        return url;
    }
}
