import { createClient } from "@libsql/client";

const client = createClient({
    url: "file:local.db",
    syncUrl: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

await client.batch(
    [
        "CREATE TABLE IF NOT EXISTS users (email TEXT)",
        "INSERT INTO users VALUES ('first@example.com')",
        "INSERT INTO users VALUES ('second@example.com')",
        "INSERT INTO users VALUES ('third@example.com')",
    ],
    "write",
);

const result = await client.execute("SELECT * FROM users");

console.log("Users:", result.rows);
