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
    const url = new URL(text);
    return {
        scheme: url.protocol.slice(0, -1),
        authority: {
            userinfo: {
                username: url.username,
                password: url.password,
            },
            host: url.hostname,
            port: url.port ? parseInt(url.port) : undefined,
        },
        path: url.pathname,
        query: { pairs: [...url.searchParams.values()].map(([key, value]) => ({ key, value })) },
        fragment: url.hash || undefined ? percentDecode(url.hash) : undefined,
    };
}

function percentDecode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch (e) {
        if (e instanceof URIError) {
            throw new LibsqlError(`URL component has invalid percent encoding: ${e}`, "URL_INVALID", undefined, e);
        }
        throw e;
    }
}

export function encodeBaseUrl(scheme: string, authority: Authority | undefined, path: string): URL {
    if (authority === undefined) {
        throw new LibsqlError(
            `URL with scheme ${JSON.stringify(scheme + ":")} requires authority (the "//" part)`,
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
