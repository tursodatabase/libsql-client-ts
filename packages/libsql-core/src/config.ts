import type { Config, IntMode } from "./api.js";
import { LibsqlError } from "./api.js";
import type { Authority } from "./uri.js";
import { parseUri } from "./uri.js";
import { supportedUrlLink } from "./util.js";

export interface ExpandedConfig {
    scheme: ExpandedScheme;
    tls: boolean;
    authority: Authority | undefined;
    path: string;
    authToken: string | undefined;
    encryptionKey: string | undefined;
    syncUrl: string | undefined;
    syncInterval: number | undefined;
    intMode: IntMode;
    fetch: Function | undefined;
}

export type ExpandedScheme = "wss" | "ws" | "https" | "http" | "file";

type update = (config: Config, value: string) => void;
type queryParamDef = { values?: string[]; update?: update };
type queryParamsDef = { [key: string]: queryParamDef };

const inMemoryMode = ":memory:";
const uriQueryParamsDef: queryParamsDef = {
    tls: {
        values: ["0", "1"],
        update: (config, value) => (config.tls = value === "1"),
    },
    authToken: {
        update: (config, authToken) => (config.authToken = authToken),
    },
};
const inMemoryQueryParamsDef: queryParamsDef = {
    cache: { values: ["shared", "private"] },
};

export function expandConfig(
    original: Readonly<Config>,
    preferHttp: boolean,
): ExpandedConfig {
    if (typeof original !== "object") {
        // produce a reasonable error message in the common case where users type
        // `createClient("libsql://...")` instead of `createClient({url: "libsql://..."})`
        throw new TypeError(
            `Expected client configuration as object, got ${typeof original}`,
        );
    }

    let config = { ...original };

    // convert plain :memory: url to URI format to make logic more uniform
    if (config.url === inMemoryMode) {
        config.url = "file::memory:";
    }

    // parse url parameters first and override config with update values
    const uri = parseUri(config.url);
    const uriScheme = uri.scheme.toLowerCase();
    const queryParamsDef =
        uri.authority === undefined && uri.path === inMemoryMode
            ? inMemoryQueryParamsDef
            : uriQueryParamsDef;
    for (const { key, value } of uri.query?.pairs ?? []) {
        if (!Object.hasOwn(queryParamsDef, key)) {
            throw new LibsqlError(
                `Unknown URL query parameter ${JSON.stringify(key)}`,
                "URL_PARAM_NOT_SUPPORTED",
            );
        }
        const queryParamDef = queryParamsDef[key];
        if (
            queryParamDef.values !== undefined &&
            !queryParamDef.values.includes(value)
        ) {
            throw new LibsqlError(
                `Unknown value for the "${key}" query argument: ${JSON.stringify(value)}. Supported values are: ${queryParamDef.values}`,
                "URL_INVALID",
            );
        }
        if (queryParamDef.update !== undefined) {
            queryParamDef?.update(config, value);
        }
    }

    // fill defaults & validate config
    config.intMode ??= "number";
    if (uriScheme === "http" || uriScheme === "ws") {
        config.tls ??= false;
    } else {
        config.tls ??= true;
    }
    let scheme: ExpandedScheme;
    if (uriScheme === "libsql") {
        if (config.tls === false) {
            if (uri.authority?.port === undefined) {
                throw new LibsqlError(
                    'A "libsql:" URL with ?tls=0 must specify an explicit port',
                    "URL_INVALID",
                );
            }
            scheme = preferHttp ? "http" : "ws";
        } else {
            scheme = preferHttp ? "https" : "wss";
        }
    } else if (
        uriScheme === "http" ||
        uriScheme === "ws" ||
        uriScheme === "https" ||
        uriScheme === "wss" ||
        uriScheme === "file"
    ) {
        scheme = uriScheme;
    } else {
        throw new LibsqlError(
            'The client supports only "libsql:", "wss:", "ws:", "https:", "http:" and "file:" URLs, ' +
                `got ${JSON.stringify(uri.scheme + ":")}. ` +
                `For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
    if (
        config.intMode !== "number" &&
        config.intMode !== "bigint" &&
        config.intMode !== "string"
    ) {
        throw new TypeError(
            `Invalid value for intMode, expected "number", "bigint" or "string", got ${JSON.stringify(config.intMode)}`,
        );
    }
    if (uri.fragment !== undefined) {
        throw new LibsqlError(
            `URL fragments are not supported: ${JSON.stringify("#" + uri.fragment)}`,
            "URL_INVALID",
        );
    }

    if (
        uri.scheme === "file" &&
        uri.path === inMemoryMode &&
        uri.authority === undefined
    ) {
        return {
            path: inMemoryMode,
            scheme: "file",
            tls: false,
            syncUrl: config.syncUrl,
            syncInterval: config.syncInterval,
            intMode: config.intMode,
            fetch: config.fetch,
            authToken: undefined,
            encryptionKey: undefined,
            authority: undefined,
        };
    }

    return {
        scheme,
        authority: uri.authority,
        path: uri.path,
        tls: config.tls,
        authToken: config.authToken,
        encryptionKey: config.encryptionKey,
        syncUrl: config.syncUrl,
        syncInterval: config.syncInterval,
        intMode: config.intMode,
        fetch: config.fetch,
    };
}
