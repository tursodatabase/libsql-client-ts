import { expect } from "@jest/globals";
import type { MatcherFunction } from "expect";

import "./helpers.js";

import type * as libsql from "..";
import { createClient } from "..";

const config = {
    url: process.env.URL ?? "ws://localhost:8080",
    authToken: process.env.AUTH_TOKEN,
};

const isWs = config.url.startsWith("ws:") || config.url.startsWith("wss:") || config.url.startsWith("libsql:");
const isHttp = config.url.startsWith("http:") || config.url.startsWith("https:");
const isFile = config.url.startsWith("file:");

// This allows us to skip tests based on the Hrana server that we are targeting:
// - "test_v2" is the v2 test server in Python
// - "test_v1" is the v1 test server in Python
// - "sqld" is sqld
const server = process.env.SERVER ?? "test_v2";

function withClient(f: (c: libsql.Client) => Promise<void>): () => Promise<void> {
    return async () => {
        const c = createClient(config);
        try {
            await f(c);
        } finally {
            c.close();
        }
    };
}

describe("createClient()", () => {
    test("URL scheme not supported", () => {
        expect(() => createClient({url: "ftp://localhost"}))
            .toThrow(expect.toBeLibsqlError("URL_SCHEME_NOT_SUPPORTED", /"ftp:"/));
    });

    test("URL param not supported", () => {
        expect(() => createClient({url: "ws://localhost?foo=bar"}))
            .toThrow(expect.toBeLibsqlError("URL_PARAM_NOT_SUPPORTED", /"foo"/));
    });

    test("URL scheme incompatible with ?tls", () => {
        const urls = [
            "ws://localhost?tls=1",
            "wss://localhost?tls=0",
            "http://localhost?tls=1",
            "https://localhost?tls=0",
        ];
        for (const url of urls) {
            expect(() => createClient({url}))
                .toThrow(expect.toBeLibsqlError("URL_INVALID", /TLS/));
        }
    });

    test("missing port in libsql URL with tls=0", () => {
        expect(() => createClient({url: "libsql://localhost?tls=0"}))
            .toThrow(expect.toBeLibsqlError("URL_INVALID", /port/));
    });

    test("invalid value of tls query param", () => {
        expect(() => createClient({url: "libsql://localhost?tls=yes"}))
            .toThrow(expect.toBeLibsqlError("URL_INVALID", /"tls".*"yes"/));
    });

    test("passing URL instead of config object", () => {
        // @ts-expect-error
        expect(() => createClient("ws://localhost")).toThrow(/as object, got string/);
    });
});

describe("execute()", () => {
    test("query a single value", withClient(async (c) => {
        const rs = await c.execute("SELECT 42");
        expect(rs.columns.length).toStrictEqual(1);
        expect(rs.rows.length).toStrictEqual(1);
        expect(rs.rows[0].length).toStrictEqual(1);
        expect(rs.rows[0][0]).toStrictEqual(42);
    }));

    test("query a single row", withClient(async (c) => {
        const rs = await c.execute("SELECT 1 AS one, 'two' AS two, 0.5 AS three");
        expect(rs.columns).toStrictEqual(["one", "two", "three"]);
        expect(rs.rows.length).toStrictEqual(1);
        
        const r = rs.rows[0];
        expect(r.length).toStrictEqual(3);
        expect(Array.from(r)).toStrictEqual([1, "two", 0.5]);
        expect(Object.entries(r)).toStrictEqual([["one", 1], ["two", "two"], ["three", 0.5]]);
    }));

    test("query multiple rows", withClient(async (c) => {
        const rs = await c.execute("VALUES (1, 'one'), (2, 'two'), (3, 'three')");
        expect(rs.columns.length).toStrictEqual(2);
        expect(rs.rows.length).toStrictEqual(3);
        
        expect(Array.from(rs.rows[0])).toStrictEqual([1, "one"]);
        expect(Array.from(rs.rows[1])).toStrictEqual([2, "two"]);
        expect(Array.from(rs.rows[2])).toStrictEqual([3, "three"]);
    }));

    test("statement that produces error", withClient(async (c) => {
        await expect(c.execute("SELECT foobar")).rejects.toBeLibsqlError();
    }));

    test("rowsAffected with INSERT", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
        ]);
        const rs = await c.execute("INSERT INTO t VALUES (1), (2)");
        expect(rs.rowsAffected).toStrictEqual(2);
    }));

    test("rowsAffected with DELETE", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
            "INSERT INTO t VALUES (1), (2), (3), (4), (5)",
        ]);
        const rs = await c.execute("DELETE FROM t WHERE a >= 3");
        expect(rs.rowsAffected).toStrictEqual(3);
    }));

    test("lastInsertRowid with INSERT", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
            "INSERT INTO t VALUES ('one'), ('two')",
        ]);
        const insertRs = await c.execute("INSERT INTO t VALUES ('three')");
        expect(insertRs.lastInsertRowid).not.toBeUndefined();
        const selectRs = await c.execute({
            sql: "SELECT a FROM t WHERE ROWID = ?",
            args: [insertRs.lastInsertRowid!],
        });
        expect(Array.from(selectRs.rows[0])).toStrictEqual(["three"]);
    }));

    test("rows from INSERT RETURNING", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
        ]);

        const rs = await c.execute("INSERT INTO t VALUES (1) RETURNING 42 AS x, 'foo' AS y");
        expect(rs.columns).toStrictEqual(["x", "y"]);
        expect(rs.rows.length).toStrictEqual(1);
        expect(Array.from(rs.rows[0])).toStrictEqual([42, "foo"]);
    }));

    (server != "test_v1" ? test : test.skip)("rowsAffected with WITH INSERT", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
            "INSERT INTO t VALUES (1), (2), (3)",
        ]);

        const rs = await c.execute(`
            WITH x(a) AS (SELECT 2*a FROM t)
            INSERT INTO t SELECT a+1 FROM x
        `);
        expect(rs.rowsAffected).toStrictEqual(3);
    }));
});

describe("values", () => {
    function testRoundtrip(
        name: string,
        passed: libsql.InValue,
        expected: libsql.Value,
        opts: { skip?: boolean } = {},
    ): void {
        const skip = opts.skip ?? false;
        (skip ? test.skip : test)(name, withClient(async (c) => {
            const rs = await c.execute({sql: "SELECT ?", args: [passed]});
            expect(rs.rows[0][0]).toStrictEqual(expected);
        }));
    }

    testRoundtrip("string", "boomerang", "boomerang");
    testRoundtrip("string with weird characters", "a\n\r\t ", "a\n\r\t ");
    testRoundtrip("string with unicode",
        "žluťoučký kůň úpěl ďábelské ódy", "žluťoučký kůň úpěl ďábelské ódy");

    testRoundtrip("zero", 0, 0);
    testRoundtrip("integer number", -2023, -2023);
    testRoundtrip("float number", 12.345, 12.345);

    const buf = new ArrayBuffer(256);
    const array = new Uint8Array(buf);
    for (let i = 0; i < 256; ++i) {
        array[i] = i ^ 0xab;
    }
    testRoundtrip("ArrayBuffer", buf, buf);
    testRoundtrip("Uint8Array", array, buf);

    testRoundtrip("null", null, null);
    testRoundtrip("true", true, 1);
    testRoundtrip("false", false, 0);
    
    testRoundtrip("bigint", -1000n, -1000);
    testRoundtrip("Date", new Date("2023-01-02T12:34:56Z"), 1672662896000);

    test("undefined produces error", withClient(async (c) => {
        await expect(c.execute({
            sql: "SELECT ?",
            // @ts-expect-error
            args: [undefined],
        })).rejects.toBeInstanceOf(TypeError);
    }));

    test("NaN produces error", withClient(async (c) => {
        await expect(c.execute({
            sql: "SELECT ?",
            args: [NaN],
        })).rejects.toBeInstanceOf(Error); // TODO: test for RangeError
    }));

    test("Infinity produces error", withClient(async (c) => {
        await expect(c.execute({
            sql: "SELECT ?",
            args: [Infinity],
        })).rejects.toBeInstanceOf(Error); // TODO: test for RangeError
    }));

    test("large bigint produces error", withClient(async (c) => {
        await expect(c.execute({
            sql: "SELECT ?",
            args: [-1267650600228229401496703205376n],
        })).rejects.toBeInstanceOf(RangeError);
    }));

    test("max 64-bit bigint", withClient(async (c) => {
        const rs = await c.execute({sql: "SELECT ?||''", args: [9223372036854775807n]});
        expect(rs.rows[0][0]).toStrictEqual("9223372036854775807");
    }));

    test("min 64-bit bigint", withClient(async (c) => {
        const rs = await c.execute({sql: "SELECT ?||''", args: [-9223372036854775808n]});
        expect(rs.rows[0][0]).toStrictEqual("-9223372036854775808");
    }));
});

describe("arguments", () => {
    test("? arguments", withClient(async (c) => {
        const rs = await c.execute({
            sql: "SELECT ?, ?",
            args: ["one", "two"],
        });
        expect(Array.from(rs.rows[0])).toStrictEqual(["one", "two"]);
    }));

    (!isFile ? test : test.skip)("?NNN arguments", withClient(async (c) => {
        const rs = await c.execute({
            sql: "SELECT ?2, ?3, ?1",
            args: ["one", "two", "three"],
        });
        expect(Array.from(rs.rows[0])).toStrictEqual(["two", "three", "one"]);
    }));

    (!isFile ? test : test.skip)("?NNN arguments with holes", withClient(async (c) => {
        const rs = await c.execute({
            sql: "SELECT ?3, ?1",
            args: ["one", "two", "three"],
        });
        expect(Array.from(rs.rows[0])).toStrictEqual(["three", "one"]);
    }));

    (!isFile ? test : test.skip)("?NNN and ? arguments", withClient(async (c) => {
        const rs = await c.execute({
            sql: "SELECT ?2, ?, ?3",
            args: ["one", "two", "three"],
        });
        expect(Array.from(rs.rows[0])).toStrictEqual(["two", "three", "three"]);
    }));

    for (const sign of [":", "@", "$"]) {
        test(`${sign}AAAA arguments`, withClient(async (c) => {
            const rs = await c.execute({
                sql: `SELECT ${sign}b, ${sign}a`,
                args: {"a": "one", [`${sign}b`]: "two"},
            });
            expect(Array.from(rs.rows[0])).toStrictEqual(["two", "one"]);
        }));

        test(`${sign}AAAA arguments used multiple times`, withClient(async (c) => {
            const rs = await c.execute({
                sql: `SELECT ${sign}b, ${sign}a, ${sign}b || ${sign}a`,
                args: {"a": "one", [`${sign}b`]: "two"},
            });
            expect(Array.from(rs.rows[0])).toStrictEqual(["two", "one", "twoone"]);
        }));

        test(`${sign}AAAA arguments and ?NNN arguments`, withClient(async (c) => {
            const rs = await c.execute({
                sql: `SELECT ${sign}b, ${sign}a, ?1`,
                args: {"a": "one", [`${sign}b`]: "two"},
            });
            expect(Array.from(rs.rows[0])).toStrictEqual(["two", "one", "two"]);
        }));
    }
});

describe("batch()", () => {
    test("multiple queries", withClient(async (c) => {
        const rss = await c.batch("read", [
            "SELECT 1+1",
            "SELECT 1 AS one, 2 AS two",
            {sql: "SELECT ?", args: ["boomerang"]},
            {sql: "VALUES (?), (?)", args: ["big", "ben"]},
        ]);

        expect(rss.length).toStrictEqual(4);
        const [rs0, rs1, rs2, rs3] = rss;

        expect(rs0.rows.length).toStrictEqual(1);
        expect(Array.from(rs0.rows[0])).toStrictEqual([2]);

        expect(rs1.rows.length).toStrictEqual(1);
        expect(Array.from(rs1.rows[0])).toStrictEqual([1, 2]);

        expect(rs2.rows.length).toStrictEqual(1);
        expect(Array.from(rs2.rows[0])).toStrictEqual(["boomerang"]);

        expect(rs3.rows.length).toStrictEqual(2);
        expect(Array.from(rs3.rows[0])).toStrictEqual(["big"]);
        expect(Array.from(rs3.rows[1])).toStrictEqual(["ben"]);
    }));

    test("statements are executed sequentially", withClient(async (c) => {
        const rss = await c.batch("write", [
            /* 0 */ "DROP TABLE IF EXISTS t",
            /* 1 */ "CREATE TABLE t (a, b)",
            /* 2 */ "INSERT INTO t VALUES (1, 'one')",
            /* 3 */ "SELECT * FROM t ORDER BY a",
            /* 4 */ "INSERT INTO t VALUES (2, 'two')",
            /* 5 */ "SELECT * FROM t ORDER BY a",
            /* 6 */ "DROP TABLE t",
        ]);

        expect(rss.length).toStrictEqual(7);
        expect(rss[3].rows).toEqual([
            {a: 1, b: "one"},
        ]);
        expect(rss[5].rows).toEqual([
            {a: 1, b: "one"},
            {a: 2, b: "two"},
        ]);
    }));

    test("statements are executed in a transaction", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t1",
            "DROP TABLE IF EXISTS t2",
            "CREATE TABLE t1 (a)",
            "CREATE TABLE t2 (a)",
        ]);

        const n = 100;
        const promises = [];
        for (let i = 0; i < n; ++i) {
            const ii = i;
            promises.push((async () => {
                const rss = await c.batch("write", [
                    {sql: "INSERT INTO t1 VALUES (?)", args: [ii]},
                    {sql: "INSERT INTO t2 VALUES (?)", args: [ii * 10]},
                    "SELECT SUM(a) FROM t1",
                    "SELECT SUM(a) FROM t2",
                ]);

                const sum1 = rss[2].rows[0][0] as number;
                const sum2 = rss[3].rows[0][0] as number;
                expect(sum2).toStrictEqual(sum1 * 10);
            })());
        }
        await Promise.all(promises);

        const rs1 = await c.execute("SELECT SUM(a) FROM t1");
        expect(rs1.rows[0][0]).toStrictEqual(n*(n-1)/2);
        const rs2 = await c.execute("SELECT SUM(a) FROM t2");
        expect(rs2.rows[0][0]).toStrictEqual(n*(n-1)/2*10);
    }), 10000);

    test("error in batch", withClient(async (c) => {
        await expect(c.batch("read", [
            "SELECT 1+1",
            "SELECT foobar",
        ])).rejects.toBeLibsqlError();
    }));

    test("error in batch rolls back transaction", withClient(async (c) => {
        await c.execute("DROP TABLE IF EXISTS t");
        await c.execute("CREATE TABLE t (a)");
        await c.execute("INSERT INTO t VALUES ('one')");
        await expect(c.batch("write", [
            "INSERT INTO t VALUES ('two')",
            "SELECT foobar",
            "INSERT INTO t VALUES ('three')",
        ])).rejects.toBeLibsqlError();

        const rs = await c.execute("SELECT COUNT(*) FROM t");
        expect(rs.rows[0][0]).toStrictEqual(1);
    }));

    test("batch with a lot of different statements", withClient(async (c) => {
        const stmts = [];
        for (let i = 0; i < 1000; ++i) {
            stmts.push(`SELECT ${i}`);
        }
        const rss = await c.batch("read", stmts);
        for (let i = 0; i < stmts.length; ++i) {
            expect(rss[i].rows[0][0]).toStrictEqual(i);
        }
    }));

    test("batch with a lot of the same statements", withClient(async (c) => {
        const n = 20;
        const m = 200;

        const stmts = [];
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                stmts.push({sql: `SELECT ?, ${j}`, args: [i]});
            }
        }

        const rss = await c.batch("read", stmts);
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                const rs = rss[i*m + j];
                expect(rs.rows[0][0]).toStrictEqual(i);
                expect(rs.rows[0][1]).toStrictEqual(j);
            }
        }
    }));
    
    test("deferred batch", withClient(async (c) => {
        const rss = await c.batch("deferred", [
            "SELECT 1+1",
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
            "INSERT INTO t VALUES (21) RETURNING 2*a",
        ]);

        expect(rss.length).toStrictEqual(4);
        const [rs0, _rs1, _rs2, rs3] = rss;

        expect(rs0.rows.length).toStrictEqual(1);
        expect(Array.from(rs0.rows[0])).toStrictEqual([2]);

        expect(rs3.rows.length).toStrictEqual(1);
        expect(Array.from(rs3.rows[0])).toStrictEqual([42]);
    }));
});

describe("transaction()", () => {
    test("query multiple rows", withClient(async (c) => {
        const txn = await c.transaction("read");

        const rs = await txn.execute("VALUES (1, 'one'), (2, 'two'), (3, 'three')");
        expect(rs.columns.length).toStrictEqual(2);
        expect(rs.rows.length).toStrictEqual(3);

        expect(Array.from(rs.rows[0])).toStrictEqual([1, "one"]);
        expect(Array.from(rs.rows[1])).toStrictEqual([2, "two"]);
        expect(Array.from(rs.rows[2])).toStrictEqual([3, "three"]);

        txn.close();
    }));

    test("commit()", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
        ]);

        const txn = await c.transaction("write");
        await txn.execute("INSERT INTO t VALUES ('one')");
        await txn.execute("INSERT INTO t VALUES ('two')");
        expect(txn.closed).toStrictEqual(false);
        await txn.commit();
        expect(txn.closed).toStrictEqual(true);

        const rs = await c.execute("SELECT COUNT(*) FROM t");
        expect(rs.rows[0][0]).toStrictEqual(2);
        await expect(txn.execute("SELECT 1")).rejects.toBeLibsqlError("TRANSACTION_CLOSED");
    }));

    test("rollback()", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
        ]);

        const txn = await c.transaction("write");
        await txn.execute("INSERT INTO t VALUES ('one')");
        await txn.execute("INSERT INTO t VALUES ('two')");
        expect(txn.closed).toStrictEqual(false);
        await txn.rollback();
        expect(txn.closed).toStrictEqual(true);

        const rs = await c.execute("SELECT COUNT(*) FROM t");
        expect(rs.rows[0][0]).toStrictEqual(0);
        await expect(txn.execute("SELECT 1")).rejects.toBeLibsqlError("TRANSACTION_CLOSED");
    }));

    test("close()", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
        ]);

        const txn = await c.transaction("write");
        await txn.execute("INSERT INTO t VALUES ('one')");
        expect(txn.closed).toStrictEqual(false);
        txn.close();
        expect(txn.closed).toStrictEqual(true);

        const rs = await c.execute("SELECT COUNT(*) FROM t");
        expect(rs.rows[0][0]).toStrictEqual(0);
        await expect(txn.execute("SELECT 1")).rejects.toBeLibsqlError("TRANSACTION_CLOSED");
    }));

    test("error does not rollback", withClient(async (c) => {
        await c.batch("write", [
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a)",
        ]);

        const txn = await c.transaction("write");
        await expect(txn.execute("SELECT foo")).rejects.toBeLibsqlError();
        await txn.execute("INSERT INTO t VALUES ('one')");
        await expect(txn.execute("SELECT bar")).rejects.toBeLibsqlError();
        await txn.commit();

        const rs = await c.execute("SELECT COUNT(*) FROM t");
        expect(rs.rows[0][0]).toStrictEqual(1);
    }));

    test("commit empty", withClient(async (c) => {
        const txn = await c.transaction("read");
        await txn.commit();
    }));

    test("rollback empty", withClient(async (c) => {
        const txn = await c.transaction("read");
        await txn.rollback();
    }));
});

const hasNetworkErrors = isWs && (server == "test_v1" || server == "test_v2");
(hasNetworkErrors ? describe : describe.skip)("network errors", () => {
    const testCases = [
        {title: "WebSocket close", sql: ".close_ws"},
        {title: "TCP close", sql: ".close_tcp"},
    ];

    for (const {title, sql} of testCases) {
        test(`${title} in execute()`, withClient(async (c) => {
            await expect(c.execute(sql)).rejects.toBeLibsqlError("HRANA_WEBSOCKET_ERROR");

            expect((await c.execute("SELECT 42")).rows[0][0]).toStrictEqual(42);
        }));

        test(`${title} in transaction()`, withClient(async (c) => {
            const txn = await c.transaction("read");
            await expect(txn.execute(sql)).rejects.toBeLibsqlError("HRANA_WEBSOCKET_ERROR");
            await expect(txn.commit()).rejects.toBeLibsqlError("HRANA_WEBSOCKET_ERROR");
            txn.close();

            expect((await c.execute("SELECT 42")).rows[0][0]).toStrictEqual(42);
        }));

        test(`${title} in batch()`, withClient(async (c) => {
            await expect(c.batch("read", ["SELECT 42", sql, "SELECT 24"]))
                .rejects.toBeLibsqlError("HRANA_WEBSOCKET_ERROR");

            expect((await c.execute("SELECT 42")).rows[0][0]).toStrictEqual(42);
        }));
    }
});
