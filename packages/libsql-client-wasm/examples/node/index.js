import { createClient } from "@libsql/client-wasm";

async function main() {
  const config = {
    url: "file:local.db",
  };
  const db = await createClient(config);
  await db.execute("CREATE TABLE users (id INT PRIMARY KEY, username TEXT)");
  await db.execute("INSERT INTO users VALUES (1, 'penberg')");
  const rs = await db.execute("SELECT * FROM users");
  console.log(rs);
}

main()
  .catch((error) => {
    console.log(error);
  });
