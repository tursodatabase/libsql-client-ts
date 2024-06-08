import { expect } from "@jest/globals";

import "./helpers.js";

import { expandConfig } from "@libsql/core/config";

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
            },
        },
        {
            name: "wss with user info",
            config: {
                url: "wss://user:password@localhost:8888/libsql/connect",
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
            },
        },
    ];
    for (const { name, config, expanded } of cases) {
        test(name, () => {
            expect(expandConfig(config, false)).toEqual(expanded);
        });
    }
});
