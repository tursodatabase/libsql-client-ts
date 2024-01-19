import { createClient } from "@libsql/client";
import reader from "readline-sync";

async function example() {
  const config = {
    url: process.env.URL ?? "file:local.db",
    syncUrl: process.env.SYNC_URL,
    authToken: process.env.AUTH_TOKEN,
  };
  const db = createClient(config);
  await db.sync();
  await db.execute("CREATE TABLE IF NOT EXISTS guest_book_entries (comment TEXT)");
  await db.sync();

  const comment = reader.question("Enter your comment: ");

  await db.execute({ sql: "INSERT INTO guest_book_entries (comment) VALUES (?)", args: [comment]});
  await db.sync();

  console.log("Guest book entries:");
  const rs = await db.execute("SELECT * FROM guest_book_entries");
  for (const row of rs.rows) {
    console.log(" - " + row.comment);
  }
}

example()
