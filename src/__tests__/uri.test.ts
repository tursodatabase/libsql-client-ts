import { expect } from "@jest/globals";
import type { MatcherFunction } from "expect";

import "./helpers.js";

import { parseUri, encodeBaseUrl } from "../uri.js";

describe("parseUri()", () => {
    test("authority and path", () => {
        const cases = [
            {text: "file://localhost", path: ""},
            {text: "file://localhost/", path: "/"},
            {text: "file://localhost/absolute/path", path: "/absolute/path"},
            {text: "file://localhost/k%C5%AF%C5%88", path: "/kůň"},
        ];
        for (const {text, path} of cases) {
            expect(parseUri(text)).toEqual({
                scheme: "file",
                authority: {host: "localhost"},
                path,
            });
        }
    });

    test("empty authority and path", () => {
        const cases = [
            {text: "file:///absolute/path", path: "/absolute/path"},
            {text: "file://", path: ""},
            {text: "file:///k%C5%AF%C5%88", path: "/kůň"},
        ];
        for (const {text, path} of cases) {
            expect(parseUri(text)).toEqual({
                scheme: "file",
                authority: {host: ""},
                path,
            });
        }
    });

    test("no authority and path", () => {
        const cases = [
            {text: "file:/absolute/path", path: "/absolute/path"},
            {text: "file:relative/path", path: "relative/path"},
            {text: "file:", path: ""},
            {text: "file:C:/path/to/file", path: "C:/path/to/file"},
            {text: "file:k%C5%AF%C5%88", path: "kůň"},
        ];
        for (const {text, path} of cases) {
            expect(parseUri(text)).toEqual({
                scheme: "file",
                path,
            });
        }
    });

    test("authority", () => {
        const hosts = [
            {text: "localhost", host: "localhost"},
            {text: "domain.name", host: "domain.name"},
            {text: "some$weird.%20!name", host: "some$weird. !name"},
            {text: "1.20.255.99", host: "1.20.255.99"},
            {text: "[2001:4860:4802:32::a]", host: "2001:4860:4802:32::a"},
            {text: "%61", host: "a"},
            {text: "100%2e100%2e100%2e100", host: "100.100.100.100"},
            {text: "k%C5%AF%C5%88", host: "kůň"},
        ];
        const ports = [
            {text: "", port: undefined},
            {text: ":", port: undefined},
            {text: ":0", port: 0},
            {text: ":99", port: 99},
            {text: ":65535", port: 65535},
        ];
        const userinfos = [
            {text: "", userinfo: undefined},
            {text: "@", userinfo: {username: ""}},
            {text: "alice@", userinfo: {username: "alice"}},
            {text: "alice:secret@", userinfo: {username: "alice", password: "secret"}},
            {text: "alice:sec:et@", userinfo: {username: "alice", password: "sec:et"}},
            {text: "alice%3Asecret@", userinfo: {username: "alice:secret"}},
            {text: "alice:s%65cret@", userinfo: {username: "alice", password: "secret"}},
        ];

        for (const {text: hostText, host} of hosts) {
            for (const {text: portText, port} of ports) {
                for (const {text: userText, userinfo} of userinfos) {
                    const text = `http://${userText}${hostText}${portText}`;
                    expect(parseUri(text)).toEqual({
                        scheme: "http",
                        authority: {host, port, userinfo},
                        path: "",
                    });
                }
            }
        }
    });

    test("query", () => {
        const cases = [
            {text: "?", pairs: []},
            {text: "?key=value", pairs: [
                {key: "key", value: "value"},
            ]},
            {text: "?&key=value", pairs: [
                {key: "key", value: "value"},
            ]},
            {text: "?key=value&&", pairs: [
                {key: "key", value: "value"},
            ]},
            {text: "?a", pairs: [
                {key: "a", value: ""},
            ]},
            {text: "?a=", pairs: [
                {key: "a", value: ""},
            ]},
            {text: "?=a", pairs: [
                {key: "", value: "a"},
            ]},
            {text: "?=", pairs: [
                {key: "", value: ""},
            ]},
            {text: "?a=b=c", pairs: [
                {key: "a", value: "b=c"},
            ]},
            {text: "?a=b&c=d", pairs: [
                {key: "a", value: "b"},
                {key: "c", value: "d"},
            ]},
            {text: "?a+b=c", pairs: [
                {key: "a b", value: "c"},
            ]},
            {text: "?a=b+c", pairs: [
                {key: "a", value: "b c"},
            ]},
            {text: "?a?b", pairs: [
                {key: "a?b", value: ""},
            ]},
            {text: "?%61=%62", pairs: [
                {key: "a", value: "b"},
            ]},
            {text: "?a%3db", pairs: [
                {key: "a=b", value: ""},
            ]},
            {text: "?a=%2b", pairs: [
                {key: "a", value: "+"},
            ]},
            {text: "?%2b=b", pairs: [
                {key: "+", value: "b"},
            ]},
            {text: "?a=b%26c", pairs: [
                {key: "a", value: "b&c"},
            ]},
            {text: "?a=k%C5%AF%C5%88", pairs: [
                {key: "a", value: "kůň"},
            ]},
        ];
        for (const {text: queryText, pairs} of cases) {
            const text = `file:${queryText}`;
            expect(parseUri(text)).toEqual({
                scheme: "file",
                path: "",
                query: {pairs},
            });
        }
    });

    test("fragment", () => {
        const cases = [
            {text: "", fragment: undefined},
            {text: "#a", fragment: "a"},
            {text: "#a?b", fragment: "a?b"},
            {text: "#%61", fragment: "a"},
            {text: "#k%C5%AF%C5%88", fragment: "kůň"},
        ];
        for (const {text: fragmentText, fragment} of cases) {
            const text = `file:${fragmentText}`;
            expect(parseUri(text)).toEqual({
                scheme: "file",
                path: "",
                fragment,
            });
        }
    });

    test("parse errors", () => {
        const cases = [
            {text: "", message: /format/},
            {text: "foo", message: /format/},
            {text: "h$$p://localhost", message: /format/},
            {text: "h%74%74p://localhost", message: /format/},
            {text: "http://localhost:%38%38", message: /authority/},
            {text: "file:k%C5%C5%88", message: /percent encoding/},
        ];

        for (const {text, message} of cases) {
            expect(() => parseUri(text)).toThrow(expect.toBeLibsqlError("URL_INVALID", message));
        }
    });
});

test("encodeBaseUrl()", () => {
    const cases = [
        {
            scheme: "http",
            host: "localhost",
            path: "",
            url: "http://localhost",
        },
        {
            scheme: "http",
            host: "localhost",
            path: "/",
            url: "http://localhost/",
        },
        {
            scheme: "http",
            host: "localhost",
            port: 8080,
            path: "",
            url: "http://localhost:8080",
        },
        {
            scheme: "http",
            host: "localhost",
            path: "/foo/bar",
            url: "http://localhost/foo/bar",
        },
        {
            scheme: "http",
            host: "localhost",
            path: "foo/bar",
            url: "http://localhost/foo/bar",
        },
        {
            scheme: "http",
            host: "some.long.domain.name",
            path: "",
            url: "http://some.long.domain.name",
        },
        {
            scheme: "http",
            host: "1.2.3.4",
            path: "",
            url: "http://1.2.3.4",
        },
        {
            scheme: "http",
            host: "2001:4860:4802:32::a",
            path: "",
            url: "http://[2001:4860:4802:32::a]",
        },
        {
            scheme: "http",
            host: "localhost",
            userinfo: {username: "alice", password: undefined},
            path: "",
            url: "http://alice@localhost",
        },
        {
            scheme: "http",
            host: "localhost",
            userinfo: {username: "alice", password: "secr:t"},
            path: "",
            url: "http://alice:secr%3At@localhost",
        },
        {
            scheme: "https",
            host: "localhost",
            userinfo: {username: "alice", password: "secret"},
            port: 8080,
            path: "/some/path",
            url: "https://alice:secret@localhost:8080/some/path",
        },
    ];

    for (const {scheme, host, port, userinfo, path, url} of cases) {
        expect(encodeBaseUrl(scheme, {host, port, userinfo}, path)).toStrictEqual(new URL(url));
    }
});
