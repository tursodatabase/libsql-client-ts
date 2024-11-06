import { createClient } from "@libsql/client";

const client = createClient({
    url: ":memory:",
});

await client.batch(
    [
        "CREATE TABLE users (email TEXT)",
        "INSERT INTO users VALUES ('first@example.com')",
        "INSERT INTO users VALUES ('second@example.com')",
        "INSERT INTO users VALUES ('third@example.com')",
    ],
    "write",
);

const result = await client.execute("SELECT * FROM users");

console.log("Users:", result.rows);
