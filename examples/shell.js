import * as readline from "node:readline/promises";
import { stdin, stdout, argv } from "node:process";
import * as libsql from "@libsql/client";

async function main() {
    const url = argv[2];
    if (!url) {
        console.error("Please specify database URL as command-line argument");
        return;
    }

    const client = libsql.createClient({url});
    const rl = readline.createInterface({input: stdin, output: stdout});

    for (;;) {
        const sql = await rl.question("> ");

        let rs;
        try {
            rs = await client.execute(sql);
        } catch (e) {
            if (e instanceof libsql.LibsqlError) {
                console.error(e);
                continue;
            }
            throw e;
        }

        console.log(JSON.stringify(rs.columns));
        for (const row of rs.rows) {
            console.log(JSON.stringify(Array.from(row)));
        }
    }
}

await main();
