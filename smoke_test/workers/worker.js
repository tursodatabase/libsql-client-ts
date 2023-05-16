import * as libsql from "@libsql/client/web";

export default {
    async fetch(request, env, ctx) {
        function respond(status, responseBody) {
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
        if (url.pathname === "/") {
            return respond(200, "This is a smoke-test Worker for @libsql/client");
        }

        const testCaseFn = testCases[url.pathname];
        if (testCaseFn === undefined) {
            return respond(404, "Unknown test case");
        }

        let client;
        try {
            client = libsql.createClient({url: env.CLIENT_URL});
            await testCaseFn(client);
            return respond(200, "Test passed");
        } catch (e) {
            return respond(500, `Test failed\n${e.stack}`);
        } finally {
            if (client !== undefined) {
                client.close();
            }
        }
    },
};

const testCases = {
    "/execute": async (client) => {
        const rs = await client.execute("SELECT 1+1 AS two");
        assert(rs.columns.length === 1);
        assert(rs.columns[0] === "two");
        assert(rs.rows.length === 1);
        assert(rs.rows[0].length === 1);
        assert(rs.rows[0][0] === 2.0);
    },

    "/batch": async (client) => {
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

    "/transaction": async (client) => {
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

function assert(value, message) {
    if (!value) {
        throw new Error(message ?? "Assertion failed");
    }
}
