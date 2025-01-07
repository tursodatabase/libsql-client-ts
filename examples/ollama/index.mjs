import { createClient } from "@libsql/client";
import ollama from "ollama";

const client = createClient({
    url: "file:local.db",
});

await client.batch(
    [
        "CREATE TABLE IF NOT EXISTS movies (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, embedding F32_BLOB(4096))",
        "CREATE INDEX IF NOT EXISTS movies_embedding_idx ON movies(libsql_vector_idx(embedding))",
    ],
    "write",
);

async function getEmbedding(prompt) {
    const response = await ollama.embeddings({
        model: "mistral",
        prompt,
    });

    return response.embedding;
}

async function insertMovie(title, description) {
    const embedding = await getEmbedding(description);

    await client.execute({
        sql: `
      INSERT INTO movies (title, description, embedding)
      VALUES (?, ?, vector(?))
    `,
        args: [title, description, JSON.stringify(embedding)],
    });
}

async function findSimilarMovies(description, limit = 3) {
    const queryEmbedding = await getEmbedding(description);

    const results = await client.execute({
        sql: `
          WITH vector_scores AS (
            SELECT
              rowid as id,
              title,
              description,
              embedding,
              1 - vector_distance_cos(embedding, vector32(?)) AS similarity
            FROM movies
            ORDER BY similarity DESC
            LIMIT ?
          )
          SELECT id, title, description, similarity FROM vector_scores
        `,
        args: [JSON.stringify(queryEmbedding), limit],
    });

    return results.rows;
}

try {
    const sampleMovies = [
        {
            title: "Inception",
            description:
                "A thief who enters the dreams of others to steal secrets from their subconscious.",
        },
        {
            title: "The Matrix",
            description:
                "A computer programmer discovers that reality as he knows it is a simulation created by machines.",
        },
        {
            title: "Interstellar",
            description:
                "Astronauts travel through a wormhole in search of a new habitable planet for humanity.",
        },
    ];

    for (const movie of sampleMovies) {
        await insertMovie(movie.title, movie.description);
        console.log(`Inserted: ${movie.title}`);
    }

    const query =
        "A sci-fi movie about virtual reality and artificial intelligence";
    console.log("\nSearching for movies similar to:", query);

    const similarMovies = await findSimilarMovies(query);
    console.log("\nSimilar movies found:");
    similarMovies.forEach((movie) => {
        console.log(`\nTitle: ${movie.title}`);
        console.log(`Description: ${movie.description}`);
    });
} catch (error) {
    console.error("Error:", error);
}
