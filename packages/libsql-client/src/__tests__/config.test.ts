import { expect } from "@jest/globals";

import "./helpers.js";

import { expandConfig } from "@libsql/core/config";
import { IntMode } from "@libsql/hrana-client";

describe("expandConfig - default tls values", () => {
    const cases = [
        {
            name: "file",
            preferHttp: true,
            config: { url: "file://local.db" },
            tls: true,
        },
        {
            name: "http",
            preferHttp: true,
            config: { url: "http://localhost" },
            tls: false,
        },
        {
            name: "http (tls in config)",
            preferHttp: true,
            config: { url: "http://localhost", tls: true },
            tls: true,
        },
        {
            name: "http (tls in query)",
            preferHttp: true,
            config: { url: "http://localhost?tls=1", tls: false },
            tls: true,
        },
        {
            name: "http (no tls in query)",
            preferHttp: true,
            config: { url: "http://localhost?tls=0", tls: true },
            tls: false,
        },
        {
            name: "http (no tls in query)",
            preferHttp: true,
            config: { url: "http://localhost?tls=0", tls: true },
            tls: false,
        },
    ];
    for (const { name, config, preferHttp, tls } of cases) {
        test(name, () => {
            expect(expandConfig(config, preferHttp).tls).toEqual(tls);
        });
    }
});

describe("expandConfig - invalid arguments", () => {
    const cases = [
        {
            name: "in-memory with unsupported query params",
            config: { url: "file::memory:?mode=memory" },
            error: 'Unsupported URL query parameter "mode"',
        },
        {
            name: "in-memory with tls param",
            config: { url: "file::memory:?tls=0" },
            error: 'Unsupported URL query parameter "tls"',
        },
        {
            name: "in-memory with authToken param",
            config: { url: "file::memory:?authToken=0" },
            error: 'Unsupported URL query parameter "authToken"',
        },
        {
            name: "invalid tls param value",
            config: { url: "libsql://localhost?tls=2" },
            error: 'Unknown value for the "tls" query argument: "2". Supported values are: ["0", "1"]',
        },
        {
            name: "invalid scheme",
            config: { url: "ftp://localhost" },
            error: /The client supports only.*got "ftp:"/g,
        },
        {
            name: "invalid intMode",
            config: { url: "file://localhost", intMode: "decimal" as IntMode },
            error: /Invalid value for intMode.*got "decimal"/g,
        },
        {
            name: "fragment in uri",
            config: { url: "file://localhost#fragment" },
            error: "URL fragments are not supported",
        },
        {
            name: "libsql, no tls, no port",
            config: { url: "libsql://localhost?tls=0" },
            error: "must specify an explicit port",
        },
    ];
    for (const { name, config, error } of cases) {
        test(name, () => {
            try {
                expandConfig(config, false);
                throw new Error("expand command must fail");
            } catch (e: any) {
                expect(e.message).toMatch(error);
            }
        });
    }
});

describe("expandConfig - parsing of valid arguments", () => {
    const cases = [
        {
            name: "in-memory",
            config: { url: ":memory:" },
            expanded: {
                scheme: "file",
                tls: false,
                intMode: "number",
                path: ":memory:",
                concurrency: 20,
            },
        },
        {
            name: "in-memory with params",
            config: { url: "file::memory:?cache=shared" },
            expanded: {
                scheme: "file",
                tls: false,
                intMode: "number",
                path: ":memory:?cache=shared",
                concurrency: 20,
            },
        },
        {
            name: "simple local file",
            config: { url: "file://local.db" },
            expanded: {
                scheme: "file",
                authority: { host: "local.db" },
                tls: true,
                intMode: "number",
                path: "",
                concurrency: 20,
            },
        },
        {
            name: "wss with path & port",
            config: { url: "wss://localhost:8888/libsql/connect" },
            expanded: {
                scheme: "wss",
                authority: { host: "localhost", port: 8888 },
                tls: true,
                intMode: "number",
                path: "/libsql/connect",
                concurrency: 20,
            },
        },
        {
            name: "wss with user info",
            config: {
                url: "wss://user:password@localhost:8888/libsql/connect",
                concurrency: 20,
            },
            expanded: {
                scheme: "wss",
                authority: {
                    host: "localhost",
                    port: 8888,
                    userinfo: { username: "user", password: "password" },
                },
                tls: true,
                intMode: "number",
                path: "/libsql/connect",
                concurrency: 20,
            },
        },
        {
            name: "override tls=0",
            config: { url: "wss://localhost/libsql/connect?tls=0", tls: true },
            expanded: {
                scheme: "wss",
                authority: { host: "localhost" },
                tls: false,
                intMode: "number",
                path: "/libsql/connect",
                concurrency: 20,
            },
        },
        {
            name: "override tls=1",
            config: { url: "wss://localhost/libsql/connect?tls=1", tls: false },
            expanded: {
                scheme: "wss",
                authority: { host: "localhost" },
                tls: true,
                intMode: "number",
                path: "/libsql/connect",
                concurrency: 20,
            },
        },
        {
            name: "override auth token",
            config: {
                url: "wss://localhost/libsql/connect?authToken=new",
                authToken: "old",
            },
            expanded: {
                authToken: "new",
                scheme: "wss",
                authority: { host: "localhost" },
                tls: true,
                intMode: "number",
                path: "/libsql/connect",
                concurrency: 20,
            },
        },
    ];
    for (const { name, config, expanded } of cases) {
        test(name, () => {
            expect(expandConfig(config, false)).toEqual(expanded);
        });
    }
});
