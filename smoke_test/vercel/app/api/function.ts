import * as libsql from "@libsql/client";

export const config = {
    runtime: "edge",
};

export default async function (request: Request) {
    function respond(status: number, responseBody: string) {
        return new Response(responseBody, {
            status,
            headers: [
                ["content-type", "text/plain"],
            ],
        });
    }

    if (request.method !== "GET") {
        return respond(405, "Only GET method is supported");
    }

    const url = new URL(request.url);
    const testCase = url.searchParams.get("test");
    if (testCase === null) {
        return respond(400, "Please specify the test case using the 'test' query parameter");
    }

    const testCaseFn = testCases[testCase];
    if (testCaseFn === undefined) {
        return respond(404, "Unknown test case");
    }

    let client;
    try {
        client = libsql.createClient({url: process.env.CLIENT_URL!});
        await testCaseFn(client);
        return respond(200, "Test passed");
    } catch (e) {
        return respond(500, `Test failed\n${(e as Error).stack}`);
    } finally {
        if (client !== undefined) {
            client.close();
        }
    }
};

const testCases: Record<string, (client: libsql.Client) => Promise<void>> = {
    "execute": async (client: libsql.Client): Promise<void> => {
        const rs = await client.execute("SELECT 1+1 AS two");
        assert(rs.columns.length === 1);
        assert(rs.columns[0] === "two");
        assert(rs.rows.length === 1);
        assert(rs.rows[0].length === 1);
        assert(rs.rows[0][0] === 2.0);
    },

    "batch": async (client: libsql.Client): Promise<void> => {
        const rss = await client.batch([
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a, b)",
            "INSERT INTO t VALUES (1, 'one'), (2, 'two'), (3, 'three')",
            "SELECT * FROM t ORDER BY a",
        ]);

        assert(rss[0].columns.length === 0);
        assert(rss[0].rows.length === 0);

        assert(rss[1].columns.length === 0);
        assert(rss[1].rows.length === 0);

        assert(rss[2].columns.length === 0);
        assert(rss[2].rows.length === 0);

        assert(rss[3].columns.length === 2);
        assert(rss[3].columns[0] === "a");
        assert(rss[3].columns[1] === "b");
        assert(rss[3].rows.length === 3);
        assert(rss[3].rows[0][0] === 1);
        assert(rss[3].rows[0][1] === "one");
        assert(rss[3].rows[1][0] === 2);
        assert(rss[3].rows[1][1] === "two");
        assert(rss[3].rows[2][0] === 3);
        assert(rss[3].rows[2][1] === "three");
    },

    "transaction": async (client: libsql.Client): Promise<void> => {
        await client.batch([
            "DROP TABLE IF EXISTS t",
            "CREATE TABLE t (a, b)",
            "INSERT INTO t VALUES (1, 'one'), (2, 'two'), (3, 'three')",
        ]);

        const txn = await client.transaction();
        try {
            await txn.execute("INSERT INTO t VALUES (4, 'four')");
            await txn.execute("DELETE FROM t WHERE a <= 2");
            await txn.commit();
        } finally {
            txn.close();
        }

        const rs = await client.execute("SELECT COUNT(*) FROM t");
        assert(rs.rows[0][0] === 2);
    },
};

function assert(value: unknown, message?: string) {
    if (!value) {
        throw new Error(message ?? "Assertion failed");
    }
}
