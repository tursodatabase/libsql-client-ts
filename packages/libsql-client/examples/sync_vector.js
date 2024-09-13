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
    await db.execute(
        "CREATE TABLE IF NOT EXISTS movies (title TEXT, embedding FLOAT32(4))",
    );
    await db.execute(
        "CREATE INDEX IF NOT EXISTS movies_idx ON movies (libsql_vector_idx(embedding))",
    );
    await db.sync();

    const title = reader.question("Add movie (title): ");
    const embedding = reader.question(
        "Add movie (embedding, e.g. [1,2,3,4]): ",
    );

    await db.execute({
        sql: "INSERT INTO movies (title, embedding) VALUES (?, vector32(?))",
        args: [title, embedding],
    });

    await db.sync();

    const all = await db.execute(
        "SELECT title, vector_extract(embedding) as embedding FROM movies",
    );
    console.info("all movies:");
    for (const row of all.rows) {
        console.log(" - " + row.title + ": " + row.embedding);
    }

    const query = reader.question("KNN query (e.g. [1,2,3,4]): ");
    const nn = await db.execute({
        sql: "SELECT title, vector_extract(embedding) as embedding FROM vector_top_k('movies_idx', vector32(?), 2) as knn JOIN movies ON knn.id = movies.rowid",
        args: [query],
    });
    console.info("nearest neighbors:");
    for (const row of nn.rows) {
        console.log(" - " + row.title + ": " + row.embedding);
    }
}

example();
