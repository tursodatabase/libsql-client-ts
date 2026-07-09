import { createClient } from "@libsql/client";

const client = createClient({
    url: "file:local.db",
});

await client.batch(
    [
        "DROP TABLE IF EXISTS users",
        "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
        "INSERT INTO users (name) VALUES ('Iku Turso')",
    ],
    "write",
);

const names = ["John Doe", "Mary Smith", "Alice Jones", "Mark Taylor"];

let transaction, secondTransaction;

transaction = await client.transaction("write");
try{
    for (const name of names) {
        await transaction.execute({
            sql: "INSERT INTO users (name) VALUES (?)",
            args: [name],
        });
    }
    await transaction.rollback();
}finally {
    secondTransaction?.close();
}

secondTransaction = await client.transaction("write");
try{
    for (const name of names) {
        await secondTransaction.execute({
            sql: "INSERT INTO users (name) VALUES (?)",
            args: [name],
        });
    }
    await secondTransaction.commit();
} catch (e) {
    await secondTransaction.rollback();
}finally {
    secondTransaction?.close();
}


const result = await client.execute("SELECT * FROM users");

console.log("Users:", result.rows);
