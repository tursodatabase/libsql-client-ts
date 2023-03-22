import type { Config, Client } from "./api.js";
import { LibsqlError } from "./api.js";
export * from "./api.js";

export function createClient(_config: Config): Client {
    throw new LibsqlError("The sqlite3 client is not yet implemented", "NOT_IMPLEMENTED");
}
