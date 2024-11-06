import { createClient } from "@libsql/client";

// You should set the ENCRYPTION_KEY in a environment variable
// For demo purposes, we're using a fixed key
const encryptionKey = "my-safe-encryption-key";

const client = createClient({
    url: "file:encrypted.db",
    encryptionKey,
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
