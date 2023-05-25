import * as hrana from "@libsql/hrana-client";
import { fetch } from "@libsql/isomorphic-fetch";

import type { Config, Client } from "./api.js";
import type { InStatement, ResultSet, Transaction } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { supportedUrlLink } from "./help.js";
import {
    HranaTransaction, executeHranaBatch,
    stmtToHrana, resultSetFromHrana, mapHranaError,
} from "./hrana.js";
import { Lru } from "./lru.js";
import { encodeBaseUrl } from "./uri.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
}

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    if (config.scheme !== "https" && config.scheme !== "http") {
        throw new LibsqlError(
            'The HTTP client supports only "libsql:", "https:" and "http:" URLs, ' +
                `got ${JSON.stringify(config.scheme)}. For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }

    if (config.scheme === "http" && config.tls) {
        throw new LibsqlError(`A "http" URL cannot opt into TLS by using ?tls=1`, "URL_INVALID");
    } else if (config.scheme === "https" && !config.tls) {
        throw new LibsqlError(`A "https" URL cannot opt out of TLS by using ?tls=0`, "URL_INVALID");
    }

    const url = encodeBaseUrl(config.scheme, config.authority, config.path);
    return new HttpClient(url, config.authToken);
}

export class HttpClient implements Client {
    #client: hrana.HttpClient;

    /** @private */
    constructor(url: URL, authToken: string | undefined) {
        this.#client = hrana.openHttp(url, authToken);
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        try {
            const hranaStmt = stmtToHrana(stmt);

            // Pipeline all operations, so `hrana.HttpClient` can open the stream, execute the statement and
            // close the stream in a single HTTP request.
            let rowsPromise: Promise<hrana.RowsResult>;
            const stream = this.#client.openStream();
            try {
                rowsPromise = stream.query(hranaStmt);
            } finally {
                stream.close();
            }

            return resultSetFromHrana(await rowsPromise);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        try {
            const hranaStmts = stmts.map(stmtToHrana);

            // Pipeline all operations, so `hrana.HttpClient` can open the stream, execute the batch and
            // close the stream in a single HTTP request.
            let resultsPromise: Promise<Array<ResultSet>>;
            const stream = this.#client.openStream();
            try {
                const batch = stream.batch();
                resultsPromise = executeHranaBatch(batch, hranaStmts);
            } finally {
                stream.close();
            }

            return await resultsPromise;
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async transaction(): Promise<HttpTransaction> {
        try {
            return new HttpTransaction(this.#client.openStream());
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    close(): void {
        this.#client.close();
    }

    get closed(): boolean {
        return this.#client.closed;
    }
}

const sqlCacheCapacity = 30;

export class HttpTransaction extends HranaTransaction implements Transaction {
    #stream: hrana.HttpStream;
    #sqlCache: Lru<string, hrana.Sql>;

    /** @private */
    constructor(stream: hrana.HttpStream) {
        super();
        this.#stream = stream;
        this.#sqlCache = new Lru();
    }

    /** @private */
    override _getStream(): hrana.Stream {
        return this.#stream;
    }

    /** @private */
    override _applySqlCache(hranaStmt: hrana.Stmt): hrana.Stmt {
        if (typeof hranaStmt.sql === "string") {
            const sqlText: string = hranaStmt.sql;

            let sqlObj = this.#sqlCache.get(sqlText);
            if (sqlObj === undefined) {
                while (this.#sqlCache.size + 1 > sqlCacheCapacity) {
                    const evictedSqlObj = this.#sqlCache.deleteLru()!;
                    evictedSqlObj.close();
                }

                sqlObj = this.#stream.storeSql(sqlText);
                this.#sqlCache.set(sqlText, sqlObj);
            }

            if (sqlObj !== undefined) {
                hranaStmt.sql = sqlObj;
            }
        }
        return hranaStmt;
    }

    override close(): void {
        this.#stream.close();
    }

    override get closed(): boolean {
        return this.#stream.closed;
    }
}
