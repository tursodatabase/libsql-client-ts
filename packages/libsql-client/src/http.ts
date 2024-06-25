import * as hrana from "@libsql/hrana-client";

import type { Config, Client } from "@libsql/core/api";
import type {
    InStatement,
    ResultSet,
    Transaction,
    IntMode,
} from "@libsql/core/api";
import { TransactionMode, LibsqlError } from "@libsql/core/api";
import type { ExpandedConfig } from "@libsql/core/config";
import { expandConfig } from "@libsql/core/config";
import {
    HranaTransaction,
    executeHranaBatch,
    stmtToHrana,
    resultSetFromHrana,
    mapHranaError,
} from "./hrana.js";
import { SqlCache } from "./sql_cache.js";
import { encodeBaseUrl } from "@libsql/core/uri";
import { supportedUrlLink } from "@libsql/core/util";
import {
    getIsSchemaDatabase,
    waitForLastMigrationJobToFinish,
} from "./migrations.js";
import promiseLimit from "promise-limit";

export * from "@libsql/core/api";

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

    if (config.encryptionKey !== undefined) {
        throw new LibsqlError(
            "Encryption key is not supported by the remote client.",
            "ENCRYPTION_KEY_NOT_SUPPORTED",
        );
    }

    if (config.scheme === "http" && config.tls) {
        throw new LibsqlError(
            `A "http:" URL cannot opt into TLS by using ?tls=1`,
            "URL_INVALID",
        );
    } else if (config.scheme === "https" && !config.tls) {
        throw new LibsqlError(
            `A "https:" URL cannot opt out of TLS by using ?tls=0`,
            "URL_INVALID",
        );
    }

    const url = encodeBaseUrl(config.scheme, config.authority, config.path);
    return new HttpClient(
        url,
        config.authToken,
        config.intMode,
        config.fetch,
        config.concurrency,
    );
}

const sqlCacheCapacity = 30;

export class HttpClient implements Client {
    #client: hrana.HttpClient;
    protocol: "http";
    #url: URL;
    #authToken: string | undefined;
    #isSchemaDatabase: Promise<boolean> | undefined;
    #promiseLimitFunction: ReturnType<typeof promiseLimit<any>>;

    /** @private */
    constructor(
        url: URL,
        authToken: string | undefined,
        intMode: IntMode,
        customFetch: Function | undefined,
        concurrency: number,
    ) {
        this.#client = hrana.openHttp(url, authToken, customFetch);
        this.#client.intMode = intMode;
        this.protocol = "http";
        this.#url = url;
        this.#authToken = authToken;
        this.#promiseLimitFunction = promiseLimit<any>(concurrency);
    }

    getIsSchemaDatabase(): Promise<boolean> {
        if (this.#isSchemaDatabase === undefined) {
            this.#isSchemaDatabase = getIsSchemaDatabase({
                authToken: this.#authToken,
                baseUrl: this.#url.origin,
            });
        }

        return this.#isSchemaDatabase;
    }

    private async limit<T>(fn: () => Promise<T>): Promise<T> {
        return this.#promiseLimitFunction(fn);
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        return this.limit<ResultSet>(async () => {
            try {
                const isSchemaDatabasePromise = this.getIsSchemaDatabase();
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

                const rowsResult = await rowsPromise;
                const isSchemaDatabase = await isSchemaDatabasePromise;
                if (isSchemaDatabase) {
                    await waitForLastMigrationJobToFinish({
                        authToken: this.#authToken,
                        baseUrl: this.#url.origin,
                    });
                }

                return resultSetFromHrana(rowsResult);
            } catch (e) {
                throw mapHranaError(e);
            }
        });
    }

    async batch(
        stmts: Array<InStatement>,
        mode: TransactionMode = "deferred",
    ): Promise<Array<ResultSet>> {
        return this.limit<Array<ResultSet>>(async () => {
            try {
                const isSchemaDatabasePromise = this.getIsSchemaDatabase();
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
                    resultsPromise = executeHranaBatch(
                        mode,
                        version,
                        batch,
                        hranaStmts,
                    );
                } finally {
                    stream.closeGracefully();
                }

                const results = await resultsPromise;
                const isSchemaDatabase = await isSchemaDatabasePromise;
                if (isSchemaDatabase) {
                    await waitForLastMigrationJobToFinish({
                        authToken: this.#authToken,
                        baseUrl: this.#url.origin,
                    });
                }

                return results;
            } catch (e) {
                throw mapHranaError(e);
            }
        });
    }

    async transaction(
        mode: TransactionMode = "write",
    ): Promise<HttpTransaction> {
        return this.limit<HttpTransaction>(async () => {
            try {
                const version = await this.#client.getVersion();
                return new HttpTransaction(
                    this.#client.openStream(),
                    mode,
                    version,
                );
            } catch (e) {
                throw mapHranaError(e);
            }
        });
    }

    async executeMultiple(sql: string): Promise<void> {
        return this.limit<void>(async () => {
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
        });
    }

    sync(): Promise<void> {
        throw new LibsqlError(
            "sync not supported in http mode",
            "SYNC_NOT_SUPPORTED",
        );
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
    constructor(
        stream: hrana.HttpStream,
        mode: TransactionMode,
        version: hrana.ProtocolVersion,
    ) {
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
