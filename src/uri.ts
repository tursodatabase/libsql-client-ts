// URI parser based on RFC 3986
// We can't use the standard `URL` object, because we want to support relative `file:` URLs like
// `file:relative/path/database.db`, which are not correct according to RFC 8089, which standardizes the
// `file` scheme.

import { LibsqlError } from "./api.js";

export interface Uri {
    scheme: string;
    authority: Authority | undefined;
    path: string;
    query: Query | undefined;
    fragment: string | undefined;
}

export interface HierPart {
    authority: Authority | undefined;
    path: string;
}

export interface Authority {
    host: string;
    port: number | undefined;
    userinfo: Userinfo | undefined;
}

export interface Userinfo {
    username: string;
    password: string | undefined;
}

export interface Query {
    pairs: Array<KeyValue>,
}

export interface KeyValue {
    key: string;
    value: string;
}

export function parseUri(text: string): Uri {
    const match = URI_RE.exec(text);
    if (match === null) {
        throw new LibsqlError("The URL is not in a valid format", "URL_INVALID");
    }

    const groups = match.groups!;
    const scheme = groups["scheme"]!;
    const authority = groups["authority"] !== undefined 
        ? parseAuthority(groups["authority"]) : undefined;
    const path = percentDecode(groups["path"]!);
    const query = groups["query"] !== undefined 
        ? parseQuery(groups["query"]) : undefined;
    const fragment = groups["fragment"] !== undefined
        ? percentDecode(groups["fragment"]) : undefined;
    return {scheme, authority, path, query, fragment};
}

const URI_RE = (() => {
    const SCHEME = '(?<scheme>[A-Za-z][A-Za-z.+-]*)';
    const AUTHORITY = '(?<authority>[^/?#]*)';
    const PATH = '(?<path>[^?#]*)';
    const QUERY = '(?<query>[^#]*)';
    const FRAGMENT = '(?<fragment>.*)'
    return new RegExp(`^${SCHEME}:(//${AUTHORITY})?${PATH}(\\?${QUERY})?(#${FRAGMENT})?$`, "su");
})();

function parseAuthority(text: string): Authority {
    const match = AUTHORITY_RE.exec(text);
    if (match === null) {
        throw new LibsqlError("The authority part of the URL is not valid", "URL_INVALID");
    }

    const groups = match.groups!;
    const host = percentDecode(groups["host_br"] ?? groups["host"]);
    const port = groups["port"] 
        ? parseInt(groups["port"], 10) 
        : undefined;
    const userinfo = groups["username"] !== undefined
        ? {
            username: percentDecode(groups["username"]),
            password: groups["password"] !== undefined
                ? percentDecode(groups["password"]) : undefined,
        }
        : undefined;
    return {host, port, userinfo};
}

const AUTHORITY_RE = (() => {
    const USERINFO = '(?<username>[^:]*)(:(?<password>.*))?';
    const HOST = '((?<host>[^:\\[\\]]*)|(\\[(?<host_br>[^\\[\\]]*)\\]))';
    const PORT = '(?<port>[0-9]*)';
    return new RegExp(`^(${USERINFO}@)?${HOST}(:${PORT})?$`, "su");
})();

// Query string is parsed as application/x-www-form-urlencoded according to the Web URL standard:
// https://url.spec.whatwg.org/#urlencoded-parsing
function parseQuery(text: string): Query {
    const sequences = text.split("&");
    const pairs = [];
    for (const sequence of sequences) {
        if (sequence === "") {
            continue;
        }

        let key: string;
        let value: string;
        const splitIdx = sequence.indexOf("=");
        if (splitIdx < 0) {
            key = sequence;
            value = "";
        } else {
            key = sequence.substring(0, splitIdx);
            value = sequence.substring(splitIdx+1);
        }

        pairs.push({
            key: percentDecode(key.replaceAll("+", " ")),
            value: percentDecode(value.replaceAll("+", " ")),
        });
    }
    return {pairs};
}

function percentDecode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch (e) {
        if (e instanceof URIError) {
            throw new LibsqlError("URL component has invalid percent encoding", "URL_INVALID", e);
        }
        throw e;
    }
}

export function encodeBaseUrl(scheme: string, authority: Authority | undefined, path: string): URL {
    if (authority === undefined) {
        throw new LibsqlError(
            `URL with scheme ${JSON.stringify(scheme)} requires authority (the "//" part)`,
            "URL_INVALID",
        );
    }

    const schemeText = `${scheme}:`;

    const hostText = encodeHost(authority.host);
    const portText = encodePort(authority.port);
    const userinfoText = encodeUserinfo(authority.userinfo);
    const authorityText = `//${userinfoText}${hostText}${portText}`;

    let pathText = path.split("/").map(encodeURIComponent).join("/");
    if (pathText !== "" && !pathText.startsWith("/")) {
        pathText = "/" + pathText;
    }

    return new URL(`${schemeText}${authorityText}${pathText}`);
}

function encodeHost(host: string): string {
    return host.includes(":") ? `[${encodeURI(host)}]` : encodeURI(host);
}

function encodePort(port: number | undefined): string {
    return port !== undefined ? `:${port}` : "";
}

function encodeUserinfo(userinfo: Userinfo | undefined): string {
    if (userinfo === undefined) {
        return "";
    }

    const usernameText = encodeURIComponent(userinfo.username);
    const passwordText = userinfo.password !== undefined
        ? `:${encodeURIComponent(userinfo.password)}` : "";
    return `${usernameText}${passwordText}@`;
}
