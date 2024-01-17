import { createClient } from "@libsql/client-wasm";

async function main() {
  const config = {
    url: "file:local.db",
    sqliteWasmPath: "/node_modules/@libsql/client/node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm"
  };
  const db = await createClient(config);
  const rs = await db.execute("SELECT * FROM users");
  console.log(rs);
}

main()
  .catch((error) => {
    console.log(error);
  });
