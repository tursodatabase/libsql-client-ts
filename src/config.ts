import type { Config } from "./api.js";
import { LibsqlError } from "./api.js";

export interface ExpandedConfig extends Config {
    url: URL;
    authToken: string | undefined;
    transactions: boolean;
}

export function expandConfig(config: Config): ExpandedConfig {
    const url = config.url instanceof URL ? config.url : new URL(config.url);

    let authToken = config.authToken;
    let transactions = config.transactions ?? false;
    for (const [key, value] of url.searchParams.entries()) {
        if (key === "authToken") {
            authToken = value ? value : undefined;
        } else if (key === "transactions") {
            transactions = urlParamToBoolean(key, value);
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

    return {url, authToken, transactions};
}

function urlParamToBoolean(key: string, value: string): boolean {
    switch (value.toLowerCase()) {
        case "0": case "no": case "off": case "disable":
            return false;
        case "1": case "yes": case "on": case "enable":
            return true;
        default:
            throw new LibsqlError(
                `URL query parameter ${JSON.stringify(key)} has invalid value ` +
                    `${JSON.stringify(value)}, expected a boolean`,
                "URL_PARAM_INVALID_VALUE",
            );
    }
}

export function mapLibsqlUrl(url: URL, scheme: string): URL {
    if (url.protocol === "libsql:") {
        return setProtocol(url, `${scheme}:`);
    } else if (url.protocol === "libsqls:") {
        return setProtocol(url, `${scheme}s:`);
    } else {
        return url;
    }
}

function setProtocol(url: URL, targetProtocol: string): URL {
    // we can't use the `protocol` setter, because the specification forbids changing a non-special scheme
    // ("libsql") to special scheme ("http").
    return new URL(targetProtocol + url.toString().substring(url.protocol.length));
}
