import { createClient } from "@libsql/client";

async function example() {
  const config = {
    url: process.env.URL ?? "file:local.db",
  };
  const db = createClient(config);
  await db.batch([
    "CREATE TABLE IF NOT EXISTS users (email TEXT)",
    "INSERT INTO users (email) VALUES ('alice@example.com')",
    "INSERT INTO users (email) VALUES ('bob@example.com')"
  ], "write");
  const rs = await db.execute("SELECT * FROM users");
  console.log(rs);
}

await example();
