import { createClient } from "@libsql/client"

async function example() {
  const url = process.env.URL ?? "file:local.db";
  const config = {
    url
  };
  const db = createClient(config);
  await db.batch("write", [
    "CREATE TABLE IF NOT EXISTS users (email TEXT)",
    "INSERT INTO users (email) VALUES ('alice@example.com')",
    "INSERT INTO users (email) VALUES ('bob@example.com')"
  ]);
  const rs = await db.execute("SELECT * FROM users");
  console.log(rs);
}

example()
