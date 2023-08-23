import * as hrana from "@libsql/hrana-client";

import type { Config, Client } from "./api.js";
import type { InStatement, ResultSet, Transaction, IntMode } from "./api.js";
import { TransactionMode, LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import {
    HranaTransaction, executeHranaBatch,
    stmtToHrana, resultSetFromHrana, mapHranaError,
} from "./hrana.js";
import { SqlCache } from "./sql_cache.js";
import { encodeBaseUrl } from "./uri.js";
import { supportedUrlLink } from "./util.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
}

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    if (config.scheme !== "https" && config.scheme !== "http") {
        throw new LibsqlError(
            'The HTTP client supports only "libsql:", "https:" and "http:" URLs, ' +
                `got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }

    if (config.scheme === "http" && config.tls) {
        throw new LibsqlError(`A "http:" URL cannot opt into TLS by using ?tls=1`, "URL_INVALID");
    } else if (config.scheme === "https" && !config.tls) {
        throw new LibsqlError(`A "https:" URL cannot opt out of TLS by using ?tls=0`, "URL_INVALID");
    }

    const url = encodeBaseUrl(config.scheme, config.authority, config.path);
    return new HttpClient(url, config.authToken, config.intMode, config.fetch);
}

const sqlCacheCapacity = 30;

export class HttpClient implements Client {
    #client: hrana.HttpClient;
    protocol: "http";

    /** @private */
    constructor(
        url: URL,
        authToken: string | undefined,
        intMode: IntMode,
        customFetch: Function | undefined,
    ) {
        this.#client = hrana.openHttp(url, authToken, customFetch);
        this.#client.intMode = intMode;
        this.protocol = "http";
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
                stream.closeGracefully();
            }

            return resultSetFromHrana(await rowsPromise);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async batch(stmts: Array<InStatement>, mode: TransactionMode = "deferred"): Promise<Array<ResultSet>> {
        try {
            const hranaStmts = stmts.map(stmtToHrana);
            const version = await this.#client.getVersion();

            // Pipeline all operations, so `hrana.HttpClient` can open the stream, execute the batch and
            // close the stream in a single HTTP request.
            let resultsPromise: Promise<Array<ResultSet>>;
            const stream = this.#client.openStream();
            try {
                // It makes sense to use a SQL cache even for a single batch, because it may contain the same
                // statement repeated multiple times.
                const sqlCache = new SqlCache(stream, sqlCacheCapacity);
                sqlCache.apply(hranaStmts);

                // TODO: we do not use a cursor here, because it would cause three roundtrips:
                // 1. pipeline request to store SQL texts
                // 2. cursor request
                // 3. pipeline request to close the stream
                const batch = stream.batch(false);
                resultsPromise = executeHranaBatch(mode, version, batch, hranaStmts);
            } finally {
                stream.closeGracefully();
            }

            return await resultsPromise;
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async transaction(mode: TransactionMode = "write"): Promise<HttpTransaction> {
        try {
            const version = await this.#client.getVersion();
            return new HttpTransaction(this.#client.openStream(), mode, version);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async executeMultiple(sql: string): Promise<void> {
        try {
            // Pipeline all operations, so `hrana.HttpClient` can open the stream, execute the sequence and
            // close the stream in a single HTTP request.
            let promise: Promise<void>;
            const stream = this.#client.openStream();
            try {
                promise = stream.sequence(sql);
            } finally {
                stream.closeGracefully();
            }

            await promise;
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

export class HttpTransaction extends HranaTransaction implements Transaction {
    #stream: hrana.HttpStream;
    #sqlCache: SqlCache;

    /** @private */
    constructor(stream: hrana.HttpStream, mode: TransactionMode, version: hrana.ProtocolVersion) {
        super(mode, version);
        this.#stream = stream;
        this.#sqlCache = new SqlCache(stream, sqlCacheCapacity);
    }

    /** @private */
    override _getStream(): hrana.Stream {
        return this.#stream;
    }

    /** @private */
    override _getSqlCache(): SqlCache {
        return this.#sqlCache;
    }

    override close(): void {
        this.#stream.close();
    }

    override get closed(): boolean {
        return this.#stream.closed;
    }
}
