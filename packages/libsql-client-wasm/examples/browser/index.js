import { createClient } from "@libsql/client-wasm";

async function main() {
  const config = {
    url: "file:local.db",
  };
  const db = await createClient(config);
  const rs = await db.execute("SELECT * FROM users");
  console.log(rs);
}

main()
  .catch((error) => {
    console.log(error);
  });
