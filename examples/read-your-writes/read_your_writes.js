import { createClient } from "@libsql/client";

const client = createClient({
    url: "file:local.db",
    syncUrl: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
    readYourWrites: false,
});

await client.execute("DROP TABLE users");
await client.execute("CREATE TABLE IF NOT EXISTS users (email TEXT)");
await client.sync();

await client.execute("INSERT INTO users VALUES ('first@example.com')");
await client.execute("INSERT INTO users VALUES ('second@example.com')");
await client.execute("INSERT INTO users VALUES ('third@example.com')");

{
    // No users, sinc no sync has happend since inserts
    const result = await client.execute("SELECT * FROM users");

    console.log("Users:", result.rows);
}

{
    await client.sync();

    // No users, sinc no sync has happend since inserts
    const result = await client.execute("SELECT * FROM users");

    console.log("Users:", result.rows);
}
