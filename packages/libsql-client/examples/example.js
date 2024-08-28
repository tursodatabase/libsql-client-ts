import { createClient } from "@libsql/client";

async function example() {
    const config = {
        url: process.env.URL ?? "file:local.db",
        encryptionKey: process.env.ENCRYPTION_KEY,
    };
    const db = createClient(config);
    await db.batch(
        [
            "CREATE TABLE IF NOT EXISTS users (email TEXT)",
            "INSERT INTO users (email) VALUES ('alice@example.com')",
            "INSERT INTO users (email) VALUES ('bob@example.com')",
        ],
        "write",
    );

    await db.batch(
        [
            {
                sql: "INSERT INTO users (email, age) VALUES (?, ?)",
                args: ["alice@example.com", 30],
            },
            [
                "INSERT INTO users (email, age) VALUES (?, ?)",
                ["bob@example.com", 25],
            ],
            {
                sql: "INSERT INTO users (email, age) VALUES (:email, :age)",
                args: { email: "charlie@example.com", age: 35 },
            },
        ],
        "write",
    );

    const rs = await db.execute("SELECT * FROM users");
    console.log(rs);
}

await example();
