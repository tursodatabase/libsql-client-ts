import { createClient } from "@libsql/client";
import reader from "readline-sync";

async function example() {
    const config = {
        url: process.env.URL ?? "file:local.db",
        syncUrl: process.env.SYNC_URL,
        authToken: process.env.AUTH_TOKEN,
        offline: true,
    };

    const db = createClient(config);

    console.log("Syncing database ...");
    await db.sync();

    await db.execute(
        "CREATE TABLE IF NOT EXISTS guest_book_entries (comment TEXT)",
    );

    const comment = reader.question("Enter your comment: ");

    await db.execute({
        sql: "INSERT INTO guest_book_entries (comment) VALUES (?)",
        args: [comment],
    });

    console.log("Syncing database ...");
    const rep2 = await db.sync();

    console.log("frames_synced: " + rep2.frames_synced);

    console.log("Guest book entries:");
    const rs = await db.execute("SELECT * FROM guest_book_entries");
    for (const row of rs.rows) {
        console.log(" - " + row.comment);
    }
}

example();
