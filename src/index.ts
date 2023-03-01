import { Config, Client } from "./shared-types.js";
import { HranaDriver } from "./hrana-driver.js";
import { HttpDriver } from "./http/http-driver.js";
import { SqliteDriver } from "./sqlite-driver.js";

export function createClient(config: Config): Client {
    const rawUrl = config.url;
    const url = new URL(rawUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
        return new Client(new HttpDriver(url));
    } else if (url.protocol === "ws:" || url.protocol === "wss:") {
        return new Client(new HranaDriver(rawUrl, config.jwt));
    } else {
        return new Client(new SqliteDriver(rawUrl));
    }
}

export * from "./shared-types.js";
