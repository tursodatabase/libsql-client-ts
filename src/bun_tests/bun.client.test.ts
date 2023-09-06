import { describe, test, expect } from "bun:test";

import type { Request, Response } from "@libsql/hrana-client";
import { fetch } from "@libsql/hrana-client";

import type * as libsql from "../bun";
import { createClient } from "../bun";
import { expectBunSqliteError, expectLibSqlError, withPattern } from "./bun.helpers";

const config = {
    url: process.env.URL ?? "file:///tmp/test.db" ?? "ws://localhost:8080",
    authToken: process.env.AUTH_TOKEN,
};

function withClient(f: (c: libsql.Client) => Promise<void>, extraConfig?: Partial<libsql.Config>): () => Promise<void> {
    return async () => {
        const c = createClient({ ...config, ...extraConfig });
        try {
            await f(c);
        } finally {
            c.close();
        }
    };
}

describe("createClient()", () => {
    test("URL scheme not supported", () => {
        expectLibSqlError(() => createClient({ url: "ftp://localhost" }), withPattern("URL_SCHEME_NOT_SUPPORTED", /"ftp:"/));
    });

    test("URL param not supported", () => {
        expectLibSqlError(() => createClient({ url: "ws://localhost?foo=bar" }), withPattern("URL_PARAM_NOT_SUPPORTED", /"foo"/));
    });

    test("URL scheme incompatible with ?tls", () => {
        const urls = ["ws://localhost?tls=1", "wss://localhost?tls=0", "http://localhost?tls=1", "https://localhost?tls=0"];
        for (const url of urls) {
            expectLibSqlError(() => createClient({ url }), withPattern("URL_INVALID", /TLS/));
        }
    });

    test("missing port in libsql URL with tls=0", () => {
        expectLibSqlError(() => createClient({ url: "libsql://localhost?tls=0" }), withPattern("URL_INVALID", /port/));
    });

    test("invalid value of tls query param", () => {
        expectLibSqlError(() => createClient({ url: "libsql://localhost?tls=yes" }), withPattern("URL_INVALID", /"tls".*"yes"/));
    });

    test("passing URL instead of config object", () => {
        // @ts-expect-error
        expect(() => createClient("ws://localhost").toThrow(/as object, got string/));
    });

    test("invalid value for `intMode`", () => {
        // @ts-expect-error
        expect(() => createClient({ ...config, intMode: "foo" }).toThrow(/"foo"/));
    });
});

describe("execute()", () => {
    test(
        "query a single value",
        withClient(async (c) => {
            const rs = await c.execute("SELECT 42");
            expect(rs.columns.length).toStrictEqual(1);
            expect(rs.rows.length).toStrictEqual(1);
            expect(rs.rows[0].length).toStrictEqual(1);
            expect(rs.rows[0][0]).toStrictEqual(42);
        })
    );

    test(
        "query a single row",
        withClient(async (c) => {
            const rs = await c.execute("SELECT 1 AS one, 'two' AS two, 0.5 AS three");
            expect(rs.columns).toStrictEqual(["one", "two", "three"]);
            expect(rs.rows.length).toStrictEqual(1);

            const r = rs.rows[0];
            expect(r.length).toStrictEqual(3);
            expect(Array.from(r)).toStrictEqual([1, "two", 0.5]);
            expect(Object.entries(r)).toStrictEqual([
                ["one", 1],
                ["two", "two"],
                ["three", 0.5],
            ]);
        })
    );

    test(
        "query multiple rows",
        withClient(async (c) => {
            const rs = await c.execute("VALUES (1, 'one'), (2, 'two'), (3, 'three')");
            expect(rs.columns.length).toStrictEqual(2);
            expect(rs.rows.length).toStrictEqual(3);

            expect(Array.from(rs.rows[0])).toStrictEqual([1, "one"]);
            expect(Array.from(rs.rows[1])).toStrictEqual([2, "two"]);
            expect(Array.from(rs.rows[2])).toStrictEqual([3, "three"]);
        })
    );

    test(
        "statement that produces error",
        withClient(async (c) => {
            await expectBunSqliteError(() => c.execute("SELECT foobar"));
        })
    );

    test(
        "rowsAffected with INSERT",
        withClient(async (c) => {
            await c.batch(["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)"], "write");
            const rs = await c.execute("INSERT INTO t VALUES (1), (2)");
            expect(rs.rowsAffected).toStrictEqual(2);
        })
    );

    test(
        "rowsAffected with DELETE",
        withClient(async (c) => {
            await c.batch(
                ["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)", "INSERT INTO t VALUES (1), (2), (3), (4), (5)"],
                "write"
            );
            const rs = await c.execute("DELETE FROM t WHERE a >= 3");
            expect(rs.rowsAffected).toStrictEqual(3);
        })
    );

    //@note lastInsertRowId is not implemented with bun
    test.skip(
        "lastInsertRowid with INSERT",
        withClient(async (c) => {
            await c.batch(["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)", "INSERT INTO t VALUES ('one'), ('two')"], "write");
            const insertRs = await c.execute("INSERT INTO t VALUES ('three')");
            expect(insertRs.lastInsertRowid).not.toBeUndefined();
            const selectRs = await c.execute({
                sql: "SELECT a FROM t WHERE ROWID = ?",
                args: [insertRs.lastInsertRowid!],
            });
            expect(Array.from(selectRs.rows[0])).toStrictEqual(["three"]);
        })
    );

    test(
        "rows from INSERT RETURNING",
        withClient(async (c) => {
            await c.batch(["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)"], "write");

            const rs = await c.execute("INSERT INTO t VALUES (1) RETURNING 42 AS x, 'foo' AS y");
            expect(rs.columns).toStrictEqual(["x", "y"]);
            expect(rs.rows.length).toStrictEqual(1);
            expect(Array.from(rs.rows[0])).toStrictEqual([42, "foo"]);
        })
    );

    test(
        "rowsAffected with WITH INSERT",
        withClient(async (c) => {
            await c.batch(["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)", "INSERT INTO t VALUES (1), (2), (3)"], "write");

            const rs = await c.execute(`
            WITH x(a) AS (SELECT 2*a FROM t)
            INSERT INTO t SELECT a+1 FROM x
        `);
            expect(rs.rowsAffected).toStrictEqual(3);
        })
    );
});

describe("values", () => {
    function testRoundtrip(name: string, passed: libsql.InValue, expected: libsql.Value, intMode?: libsql.IntMode): void {
        test(
            name,
            withClient(
                async (c) => {
                    const rs = await c.execute({ sql: "SELECT ?", args: [passed] });
                    expect(rs.rows[0][0]).toStrictEqual(expected);
                },
                { intMode }
            )
        );
    }

    function testDifference(name: string, passed: libsql.InValue, intMode?: libsql.IntMode): void {
        test(
            name,
            withClient(
                async (c) => {
                    const rs = await c.execute({ sql: "SELECT ?", args: [passed] });
                    expect(rs.rows[0][0]).not.toStrictEqual(passed);
                },
                { intMode }
            )
        );
    }

    function testRoundtripError(name: string, passed: libsql.InValue, expectedError: unknown, intMode?: libsql.IntMode): void {
        test(
            name,
            withClient(
                async (c) => {
                    await expect(
                        c.execute({
                            sql: "SELECT ?",
                            args: [passed],
                        })
                    ).rejects.toBeInstanceOf(expectedError);
                },
                { intMode }
            )
        );
    }

    testRoundtrip("string", "boomerang", "boomerang");
    testRoundtrip("string with weird characters", "a\n\r\t ", "a\n\r\t ");
    testRoundtrip("string with unicode", "žluťoučký kůň úpěl ďábelské ódy", "žluťoučký kůň úpěl ďábelské ódy");

    testRoundtrip("zero number", 0, 0);
    testRoundtrip("integer number", -2023, -2023);
    testRoundtrip("float number", 12.345, 12.345);

    describe("'number' int mode", () => {
        testRoundtrip("zero integer", 0n, 0, "number");
        testRoundtrip("small integer", -42n, -42, "number");
        testRoundtrip("largest safe integer", 9007199254740991n, 9007199254740991, "number");
        testDifference("smallest unsafe positive integer", 9007199254740992n, "number");
        testDifference("large unsafe negative integer", -1152921504594532842n, "number");
    });

    //@note not implemented with bun:sqlite
    describe.skip("'bigint' int mode", () => {
        testRoundtrip("zero integer", 0n, 0n, "bigint");
        testRoundtrip("small integer", -42n, -42n, "bigint");
        testRoundtrip("large positive integer", 1152921504608088318n, 1152921504608088318n, "bigint");
        testRoundtrip("large negative integer", -1152921504594532842n, -1152921504594532842n, "bigint");
        testRoundtrip("largest positive integer", 9223372036854775807n, 9223372036854775807n, "bigint");
        testRoundtrip("largest negative integer", -9223372036854775808n, -9223372036854775808n, "bigint");
    });

    //@note not implemented with bun:sqlite
    describe.skip("'string' int mode", () => {
        testRoundtrip("zero integer", 0n, "0", "string");
        testRoundtrip("small integer", -42n, "-42", "string");
        testRoundtrip("large positive integer", 1152921504608088318n, "1152921504608088318", "string");
        testRoundtrip("large negative integer", -1152921504594532842n, "-1152921504594532842", "string");
        testRoundtrip("largest positive integer", 9223372036854775807n, "9223372036854775807", "string");
        testRoundtrip("largest negative integer", -9223372036854775808n, "-9223372036854775808", "string");
    });

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

    //@ts-expect-error this tests for an error
    testRoundtripError("undefined produces error", undefined, TypeError);
    testRoundtripError("NaN produces error", NaN, RangeError);
    testRoundtripError("Infinity produces error", Infinity, RangeError);
    testRoundtripError("large bigint produces error", -1267650600228229401496703205376n, RangeError);

    test(
        "max 64-bit bigint",
        withClient(async (c) => {
            const rs = await c.execute({ sql: "SELECT ?||''", args: [9223372036854775807n] });
            expect(rs.rows[0][0]).toStrictEqual("9223372036854775807");
        })
    );

    test(
        "min 64-bit bigint",
        withClient(async (c) => {
            const rs = await c.execute({ sql: "SELECT ?||''", args: [-9223372036854775808n] });
            expect(rs.rows[0][0]).toStrictEqual("-9223372036854775808");
        })
    );
});

describe("ResultSet.toJSON()", () => {
    test(
        "simple result set",
        withClient(async (c) => {
            const rs = await c.execute("SELECT 1 AS a");
            const json = rs.toJSON();
            expect(json["lastInsertRowid"] === null || json["lastInsertRowid"] === "0").toBe(true);
            expect(json["columns"]).toStrictEqual(["a"]);
            expect(json["rows"]).toStrictEqual([[1]]);
            expect(json["rowsAffected"]).toStrictEqual(0);

            const str = JSON.stringify(rs);
            expect(
                str === '{"columns":["a"],"rows":[[1]],"rowsAffected":0,"lastInsertRowid":null}' ||
                    str === '{"columns":["a"],"rows":[[1]],"rowsAffected":0,"lastInsertRowid":"0"}'
            ).toBe(true);
        })
    );

    test(
        "lastInsertRowid",
        withClient(async (c) => {
            await c.execute("DROP TABLE IF EXISTS t");
            await c.execute("CREATE TABLE t (id INTEGER PRIMARY KEY NOT NULL)");
            const rs = await c.execute("INSERT INTO t VALUES (12345)");
            expect(rs.toJSON()).toStrictEqual({
                columns: [],
                rows: [],
                rowsAffected: 1,
                lastInsertRowid: "0", //@note not implemented with bun
            });
        })
    );

    test(
        "row values",
        withClient(async (c) => {
            const rs = await c.execute("SELECT 42 AS integer, 0.5 AS float, NULL AS \"null\", 'foo' AS text, X'626172' AS blob");
            const json = rs.toJSON();
            expect(json["columns"]).toStrictEqual(["integer", "float", "null", "text", "blob"]);
            expect(json["rows"]).toStrictEqual([[42, 0.5, null, "foo", "YmFy"]]);
        })
    );

    //@note not implemented with bun:sqlite
    test.skip(
        "bigint row value",
        withClient(
            async (c) => {
                const rs = await c.execute("SELECT 42");
                const json = rs.toJSON();
                expect(json["rows"]).toStrictEqual([["42"]]);
            },
            { intMode: "bigint" }
        )
    );
});

describe("arguments", () => {
    test(
        "? arguments",
        withClient(async (c) => {
            const rs = await c.execute({
                sql: "SELECT ?1, ?2",
                args: ["one", "two"],
            });
            expect(Array.from(rs.rows[0])).toStrictEqual(["one", "two"]);
        })
    );

    test(
        "?NNN arguments",
        withClient(async (c) => {
            const rs = await c.execute({
                sql: "SELECT ?2, ?3, ?1",
                args: ["one", "two", "three"],
            });
            expect(Array.from(rs.rows[0])).toStrictEqual(["two", "three", "one"]);
        })
    );

    test(
        "?NNN arguments with holes",
        withClient(async (c) => {
            const rs = await c.execute({
                sql: "SELECT ?3, ?1",
                args: ["one", "two", "three"],
            });
            expect(Array.from(rs.rows[0])).toStrictEqual(["three", "one"]);
        })
    );

    //@note not supported by bun:sqlite
    test(
        "?NNN and ? arguments",
        withClient(async (c) => {
            const rs = await c.execute({
                sql: "SELECT ?2, ?, ?3",
                args: ["one", "two", "three"],
            });
            expect(Array.from(rs.rows[0])).toStrictEqual(["two", "three", "three"]);
        })
    );

    for (const sign of [":", "@", "$"]) {
        test(
            `${sign}AAAA arguments`,
            withClient(async (c) => {
                const rs = await c.execute({
                    sql: `SELECT ${sign}b, ${sign}a`,
                    args: { [`${sign}a`]: "one", [`${sign}b`]: "two" },
                });
                expect(Array.from(rs.rows[0])).toStrictEqual(["two", "one"]);
            })
        );

        test(
            `${sign}AAAA arguments used multiple times`,
            withClient(async (c) => {
                const rs = await c.execute({
                    sql: `SELECT ${sign}b, ${sign}a, ${sign}b || ${sign}a`,
                    args: { [`${sign}a`]: "one", [`${sign}b`]: "two" },
                });
                expect(Array.from(rs.rows[0])).toStrictEqual(["two", "one", "twoone"]);
            })
        );

        test(
            `${sign}AAAA arguments and ?NNN arguments`,
            withClient(async (c) => {
                const rs = await c.execute({
                    sql: `SELECT ${sign}b, ${sign}a, ?1`,
                    args: { [`${sign}a`]: "one", [`${sign}b`]: "two" },
                });
                expect(Array.from(rs.rows[0])).toStrictEqual(["two", "one", "two"]);
            })
        );
    }
});

describe("batch()", () => {
    test(
        "multiple queries",
        withClient(async (c) => {
            const rss = await c.batch(
                [
                    "SELECT 1+1",
                    "SELECT 1 AS one, 2 AS two",
                    { sql: "SELECT ?", args: ["boomerang"] },
                    { sql: "VALUES (?), (?)", args: ["big", "ben"] },
                ],
                "read"
            );

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
        })
    );

    test(
        "statements are executed sequentially",
        withClient(async (c) => {
            const rss = await c.batch(
                [
                    /* 0 */ "DROP TABLE IF EXISTS t",
                    /* 1 */ "CREATE TABLE t (a, b)",
                    /* 2 */ "INSERT INTO t VALUES (1, 'one')",
                    /* 3 */ "SELECT * FROM t ORDER BY a",
                    /* 4 */ "INSERT INTO t VALUES (2, 'two')",
                    /* 5 */ "SELECT * FROM t ORDER BY a",
                    /* 6 */ "DROP TABLE t",
                ],
                "write"
            );

            expect(rss.length).toStrictEqual(7);
            expect(rss[3].rows).toEqual([{ a: 1, b: "one" }]);
            expect(rss[5].rows).toEqual([
                { a: 1, b: "one" },
                { a: 2, b: "two" },
            ]);
        })
    );

    test(
        "statements are executed in a transaction",
        withClient(async (c) => {
            await c.batch(
                ["DROP TABLE IF EXISTS t1", "DROP TABLE IF EXISTS t2", "CREATE TABLE t1 (a)", "CREATE TABLE t2 (a)"],
                "write"
            );

            const n = 100;
            const promises: Promise<void>[] = [];
            for (let i = 0; i < n; ++i) {
                const ii = i;
                promises.push(
                    (async () => {
                        const rss = await c.batch(
                            [
                                { sql: "INSERT INTO t1 VALUES (?)", args: [ii] },
                                { sql: "INSERT INTO t2 VALUES (?)", args: [ii * 10] },
                                "SELECT SUM(a) FROM t1",
                                "SELECT SUM(a) FROM t2",
                            ],
                            "write"
                        );

                        const sum1 = rss[2].rows[0][0] as number;
                        const sum2 = rss[3].rows[0][0] as number;
                        expect(sum2).toStrictEqual(sum1 * 10);
                    })()
                );
            }
            await Promise.all(promises);

            const rs1 = await c.execute("SELECT SUM(a) FROM t1");
            expect(rs1.rows[0][0]).toStrictEqual((n * (n - 1)) / 2);
            const rs2 = await c.execute("SELECT SUM(a) FROM t2");
            expect(rs2.rows[0][0]).toStrictEqual(((n * (n - 1)) / 2) * 10);
        }),
        10000
    );

    test(
        "error in batch",
        withClient(async (c) => {
            await expectBunSqliteError(() => c.batch(["SELECT 1+1", "SELECT foobar"], "read"));
        })
    );

    test(
        "error in batch rolls back transaction",
        withClient(async (c) => {
            await c.execute("DROP TABLE IF EXISTS t");
            await c.execute("CREATE TABLE t (a)");
            await c.execute("INSERT INTO t VALUES ('one')");
            await expectBunSqliteError(() =>
                c.batch(["INSERT INTO t VALUES ('two')", "SELECT foobar", "INSERT INTO t VALUES ('three')"], "write")
            );

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(1);
        })
    );

    test(
        "batch with a lot of different statements",
        withClient(async (c) => {
            const stmts: string[] = [];
            for (let i = 0; i < 1000; ++i) {
                stmts.push(`SELECT ${i}`);
            }
            const rss = await c.batch(stmts, "read");
            for (let i = 0; i < stmts.length; ++i) {
                expect(rss[i].rows[0][0]).toStrictEqual(i);
            }
        })
    );

    test(
        "batch with a lot of the same statements",
        withClient(async (c) => {
            const n = 2;
            const m = 3;

            const stmts: libsql.InStatement[] = [];
            for (let i = 0; i < n; ++i) {
                for (let j = 0; j < m; ++j) {
                    stmts.push({ sql: `SELECT $a, $b`, args: { $a: i, $b: j } });
                }
            }

            const rss = await c.batch(stmts, "read");
            for (let i = 0; i < n; ++i) {
                for (let j = 0; j < m; ++j) {
                    const rs = rss[i * m + j];
                    expect(rs.rows[0][0]).toStrictEqual(i);
                    expect(rs.rows[0][1]).toStrictEqual(j);
                }
            }
        })
    );

    test(
        "deferred batch",
        withClient(async (c) => {
            const rss = await c.batch(
                ["SELECT 1+1", "DROP TABLE IF EXISTS t", "CREATE TABLE t (a)", "INSERT INTO t VALUES (21) RETURNING 2*a"],
                "deferred"
            );
            expect(rss.length).toStrictEqual(4);
            const [rs0, _rs1, _rs2, rs3] = rss;

            expect(rs0.rows.length).toStrictEqual(1);
            expect(Array.from(rs0.rows[0])).toStrictEqual([2]);

            expect(rs3.rows.length).toStrictEqual(1);
            expect(Array.from(rs3.rows[0])).toStrictEqual([42]);
        })
    );

    test(
        "ROLLBACK statement stops execution of batch",
        withClient(async (c) => {
            await c.execute("DROP TABLE IF EXISTS t");
            await c.execute("CREATE TABLE t (a)");

            await expectLibSqlError(() =>
                c.batch(["INSERT INTO t VALUES (1), (2), (3)", "ROLLBACK", "INSERT INTO t VALUES (4), (5)"], "write")
            );

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(0);
        })
    );
});

describe("transaction()", () => {
    test(
        "query multiple rows",
        withClient(async (c) => {
            const txn = await c.transaction("read");

            const rs = await txn.execute("VALUES (1, 'one'), (2, 'two'), (3, 'three')");
            expect(rs.columns.length).toStrictEqual(2);
            expect(rs.rows.length).toStrictEqual(3);

            expect(Array.from(rs.rows[0])).toStrictEqual([1, "one"]);
            expect(Array.from(rs.rows[1])).toStrictEqual([2, "two"]);
            expect(Array.from(rs.rows[2])).toStrictEqual([3, "three"]);

            txn.close();
        })
    );

    test(
        "commit()",
        withClient(async (c) => {
            await c.batch(["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)"], "write");

            const txn = await c.transaction("write");
            await txn.execute("INSERT INTO t VALUES ('one')");
            await txn.execute("INSERT INTO t VALUES ('two')");
            expect(txn.closed).toStrictEqual(false);
            await txn.commit();
            expect(txn.closed).toStrictEqual(true);

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(2);
            await expectLibSqlError(() => txn.execute("SELECT 1"), withPattern("TRANSACTION_CLOSED"));
        })
    );

    test(
        "rollback()",
        withClient(async (c) => {
            await c.batch(["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)"], "write");

            const txn = await c.transaction("write");
            await txn.execute("INSERT INTO t VALUES ('one')");
            await txn.execute("INSERT INTO t VALUES ('two')");
            expect(txn.closed).toStrictEqual(false);
            await txn.rollback();
            expect(txn.closed).toStrictEqual(true);

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(0);
            await expectLibSqlError(() => txn.execute("SELECT 1"), withPattern("TRANSACTION_CLOSED"));
        })
    );

    test(
        "close()",
        withClient(async (c) => {
            await c.batch(["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)"], "write");

            const txn = await c.transaction("write");
            await txn.execute("INSERT INTO t VALUES ('one')");
            expect(txn.closed).toStrictEqual(false);
            txn.close();
            expect(txn.closed).toStrictEqual(true);

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(0);
            await expectLibSqlError(() => txn.execute("SELECT 1"), withPattern("TRANSACTION_CLOSED"));
        })
    );

    test(
        "error does not rollback",
        withClient(async (c) => {
            await c.batch(["DROP TABLE IF EXISTS t", "CREATE TABLE t (a)"], "write");

            const txn = await c.transaction("write");
            await expectBunSqliteError(() => txn.execute("SELECT foo"));

            await txn.execute("INSERT INTO t VALUES ('one')");
            await expectBunSqliteError(() => txn.execute("SELECT bar"));

            await txn.commit();

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(1);
        })
    );

    test(
        "ROLLBACK statement stops execution of transaction",
        withClient(async (c) => {
            await c.execute("DROP TABLE IF EXISTS t");
            await c.execute("CREATE TABLE t (a)");

            const txn = await c.transaction("write");
            const prom1 = txn.execute("INSERT INTO t VALUES (1), (2), (3)");
            const prom2 = txn.execute("ROLLBACK");
            const prom3 = txn.execute("INSERT INTO t VALUES (4), (5)");

            await prom1;
            await prom2;
            await expectLibSqlError(() => prom3, withPattern("TRANSACTION_CLOSED"));
            await expectLibSqlError(() => txn.commit());
            txn.close();

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(0);
        })
    );

    test(
        "OR ROLLBACK statement stops execution of transaction",
        withClient(async (c) => {
            await c.execute("DROP TABLE IF EXISTS t");
            await c.execute("CREATE TABLE t (a UNIQUE)");

            const txn = await c.transaction("write");
            const prom1 = txn.execute("INSERT INTO t VALUES (1), (2), (3)");
            const prom2 = txn.execute("INSERT OR ROLLBACK INTO t VALUES (1)");
            const prom3 = txn.execute("INSERT INTO t VALUES (4), (5)");

            await prom1;
            await expectBunSqliteError(() => prom2);
            await expectLibSqlError(() => prom3, withPattern("TRANSACTION_CLOSED"));
            await expectLibSqlError(() => txn.commit(), withPattern("TRANSACTION_CLOSED"));
            txn.close();

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(0);
        })
    );

    test(
        "OR ROLLBACK as the first statement stops execution of transaction",
        withClient(async (c) => {
            await c.execute("DROP TABLE IF EXISTS t");
            await c.execute("CREATE TABLE t (a UNIQUE)");
            await c.execute("INSERT INTO t VALUES (1), (2), (3)");

            const txn = await c.transaction("write");
            const prom1 = txn.execute("INSERT OR ROLLBACK INTO t VALUES (1)");
            const prom2 = txn.execute("INSERT INTO t VALUES (4), (5)");

            await expectBunSqliteError(() => prom1);
            await expectLibSqlError(() => prom2, withPattern("TRANSACTION_CLOSED"));
            await expectLibSqlError(() => txn.commit(), withPattern("TRANSACTION_CLOSED"));

            txn.close();

            const rs = await c.execute("SELECT COUNT(*) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(3);
        })
    );

    test(
        "commit empty",
        withClient(async (c) => {
            const txn = await c.transaction("read");
            await txn.commit();
        })
    );

    test(
        "rollback empty",
        withClient(async (c) => {
            const txn = await c.transaction("read");
            await txn.rollback();
        })
    );
});

describe("batch()", () => {
    test(
        "as the first operation on transaction",
        withClient(async (c) => {
            const txn = await c.transaction("write");

            await txn.batch([
                "DROP TABLE IF EXISTS t",
                "CREATE TABLE t (a)",
                { sql: "INSERT INTO t VALUES (?)", args: [1] },
                { sql: "INSERT INTO t VALUES (?)", args: [2] },
                { sql: "INSERT INTO t VALUES (?)", args: [4] },
            ]);

            const rs = await txn.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(7);
            txn.close();
        })
    );

    test(
        "as the second operation on transaction",
        withClient(async (c) => {
            const txn = await c.transaction("write");

            await txn.execute("DROP TABLE IF EXISTS t");
            await txn.batch([
                "CREATE TABLE t (a)",
                { sql: "INSERT INTO t VALUES (?)", args: [1] },
                { sql: "INSERT INTO t VALUES (?)", args: [2] },
                { sql: "INSERT INTO t VALUES (?)", args: [4] },
            ]);

            const rs = await txn.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(7);
            txn.close();
        })
    );

    test(
        "after error, further statements are not executed",
        withClient(async (c) => {
            const txn = await c.transaction("write");

            await expectBunSqliteError(() =>
                txn.batch([
                    "DROP TABLE IF EXISTS t",
                    "CREATE TABLE t (a UNIQUE)",
                    "INSERT INTO t VALUES (1), (2), (4)",
                    "INSERT INTO t VALUES (1)",
                    "INSERT INTO t VALUES (8), (16)",
                ])
            );
            const rs = await txn.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(7);

            await txn.commit();
        })
    );
});

//@note Bun:sqlite doesn't implement executeMultiple due to lack of mulitine statement support.
describe.skip("executeMultiple()", () => {
    test(
        "as the first operation on transaction",
        withClient(async (c) => {
            const txn = await c.transaction("write");

            await txn.executeMultiple(
                `DROP TABLE IF EXISTS t;
            CREATE TABLE t (a);
            INSERT INTO t VALUES (1), (2), (4), (8);`
            );

            const rs = await txn.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(15);
            txn.close();
        })
    );

    test(
        "as the second operation on transaction",
        withClient(async (c) => {
            const txn = await c.transaction("write");
            await txn.execute("DROP TABLE IF EXISTS t");
            await txn.executeMultiple(`
                CREATE TABLE t (a);
                INSERT INTO t VALUES (1), (2), (4), (8);
            `);

            const rs = await txn.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(15);
            txn.close();
        })
    );

    test(
        "after error, further statements are not executed",
        withClient(async (c) => {
            const txn = await c.transaction("write");

            await expectBunSqliteError(() =>
                txn.executeMultiple(`
                DROP TABLE IF EXISTS t;
                CREATE TABLE t (a UNIQUE);
                INSERT INTO t VALUES (1), (2), (4);
                INSERT INTO t VALUES (1);
                INSERT INTO t VALUES (8), (16);`)
            );
            const rs = await txn.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(7);

            await txn.commit();
        })
    );

    test(
        "multiple statements",
        withClient(async (c) => {
            await c.executeMultiple(`
            DROP TABLE IF EXISTS t;
            CREATE TABLE t (a);
            INSERT INTO t VALUES (1), (2), (4), (8);
        `);
            const rs = await c.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(15);
        })
    );

    test(
        "after an error, statements are not executed",
        withClient(async (c) => {
            await expectBunSqliteError(() =>
                c.executeMultiple(`
                DROP TABLE IF EXISTS t;
            CREATE TABLE t (a);
            INSERT INTO t VALUES (1), (2), (4);
            INSERT INTO t VALUES (foo());
            INSERT INTO t VALUES (100), (1000);`)
            );
            const rs = await c.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(15);
        })
    );

    test(
        "manual transaction control statements",
        withClient(async (c) => {
            await c.executeMultiple(`
            DROP TABLE IF EXISTS t;
            CREATE TABLE t (a);
            BEGIN;
            INSERT INTO t VALUES (1), (2), (4);
            INSERT INTO t VALUES (8), (16);
            COMMIT;
        `);

            const rs = await c.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(31);
        })
    );

    test(
        "error rolls back a manual transaction",
        withClient(async (c) => {
            await expect(
                c.executeMultiple(`
            DROP TABLE IF EXISTS t;
            CREATE TABLE t (a);
            INSERT INTO t VALUES (0);
            BEGIN;
            INSERT INTO t VALUES (1), (2), (4);
            INSERT INTO t VALUES (foo());
            INSERT INTO t VALUES (8), (16);
            COMMIT;
        `)
            ).toThrow();
            // .rejects.toBeLibsqlError();
            const rs = await c.execute("SELECT SUM(a) FROM t");
            expect(rs.rows[0][0]).toStrictEqual(0);
        })
    );
});

//@note bun implementation is tested locally.
describe.skip("network errors", () => {
    const testCases = [
        { title: "WebSocket close", sql: ".close_ws" },
        { title: "TCP close", sql: ".close_tcp" },
    ];

    for (const { title, sql } of testCases) {
        test(
            `${title} in execute()`,
            withClient(async (c) => {
                await expect(c.execute(sql)).toThrow();
                // .rejects.toBeLibsqlError("HRANA_WEBSOCKET_ERROR");

                expect((await c.execute("SELECT 42")).rows[0][0]).toStrictEqual(42);
            })
        );

        test(
            `${title} in transaction()`,
            withClient(async (c) => {
                const txn = await c.transaction("read");
                await expect(txn.execute(sql)).rejects.toThrow();
                // .toBeLibsqlError("HRANA_WEBSOCKET_ERROR");
                await expect(txn.commit()).toThrow();
                // .rejects.toBeLibsqlError("TRANSACTION_CLOSED");
                txn.close();

                expect((await c.execute("SELECT 42")).rows[0][0]).toStrictEqual(42);
            })
        );

        test(
            `${title} in batch()`,
            withClient(async (c) => {
                await expect(c.batch(["SELECT 42", sql, "SELECT 24"], "read")).toThrow();
                // .rejects.toBeLibsqlError("HRANA_WEBSOCKET_ERROR");

                expect((await c.execute("SELECT 42")).rows[0][0]).toStrictEqual(42);
            })
        );
    }
});

//@note bun implementation is tested locally.
test.skip("custom fetch", async () => {
    let fetchCalledCount = 0;
    function customFetch(request: Request): Promise<Response> {
        fetchCalledCount += 1;
        return fetch(request);
    }

    const c = createClient({ ...config, fetch: customFetch });
    try {
        const rs = await c.execute("SELECT 42");
        expect(rs.rows[0][0]).toStrictEqual(42);
        expect(fetchCalledCount).toBeGreaterThan(0);
    } finally {
        c.close();
    }
});
