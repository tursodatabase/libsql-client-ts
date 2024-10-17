import { createClient } from "@libsql/client";

const client = createClient({
    url: "file:local.db",
});

await client.batch(
    [
        "CREATE TABLE IF NOT EXISTS users (email TEXT)",
        {
            sql: "INSERT INTO users VALUES (?)",
            args: ["first@example.com"],
        },
        {
            sql: "INSERT INTO users VALUES (?)",
            args: ["second@example.com"],
        },
        {
            sql: "INSERT INTO users VALUES (?)",
            args: ["third@example.com"],
        },
    ],
    "write",
);

const result = await client.execute("SELECT * FROM users");

console.log("Users:", result.rows);
