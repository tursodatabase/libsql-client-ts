import { HttpDriver } from "./http-driver.js";
import { Config, Client } from "../shared-types.js";

export function createClient(config: Config): Client {
    const rawUrl = config.url;
    const url = new URL(rawUrl);
    if (url.protocol == "http:" || url.protocol == "https:") {
        return new Client(new HttpDriver(url));
    } else {
        throw new Error(
            "@libsql/client/http supports only HTTP connections. For in-memory or file storage, please use @libsql/client."
        );
    }
}

export * from "../shared-types.js";
