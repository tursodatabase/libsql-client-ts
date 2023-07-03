import * as hrana from "@libsql/hrana-client";

import type { Config, IntMode, Client, Transaction, ResultSet, InStatement } from "./api.js";
import { TransactionMode, LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import {
    HranaTransaction, executeHranaBatch,
    stmtToHrana, resultSetFromHrana, mapHranaError,
} from "./hrana.js";
import { SqlCache } from "./sql_cache.js";
import { encodeBaseUrl } from "./uri.js";
import { supportedUrlLink, extractBatchArgs } from "./util.js";

export * from "./api.js";

export function createClient(config: Config): WsClient {
    return _createClient(expandConfig(config, false));
}

/** @private */
export function _createClient(config: ExpandedConfig): WsClient {
    if (config.scheme !== "wss" && config.scheme !== "ws") {
        throw new LibsqlError(
            'The WebSocket client supports only "libsql:", "wss:" and "ws:" URLs, ' +
                `got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }

    if (config.scheme === "ws" && config.tls) {
        throw new LibsqlError(`A "ws:" URL cannot opt into TLS by using ?tls=1`, "URL_INVALID");
    } else if (config.scheme === "wss" && !config.tls) {
        throw new LibsqlError(`A "wss:" URL cannot opt out of TLS by using ?tls=0`, "URL_INVALID");
    }

    const url = encodeBaseUrl(config.scheme, config.authority, config.path);

    let client: hrana.WsClient;
    try {
        client = hrana.openWs(url, config.authToken);
    } catch (e) {
        if (e instanceof hrana.WebSocketUnsupportedError) {
            const suggestedScheme = config.scheme === "wss" ? "https" : "http";
            const suggestedUrl = encodeBaseUrl(suggestedScheme, config.authority, config.path);
            throw new LibsqlError(
                "This environment does not support WebSockets, please switch to the HTTP client by using " +
                    `a "${suggestedScheme}:" URL (${JSON.stringify(suggestedUrl)}). ` +
                    `For more information, please read ${supportedUrlLink}`,
                "WEBSOCKETS_NOT_SUPPORTED",
            );
        }
        throw mapHranaError(e);
    }

    return new WsClient(client, url, config.authToken, config.intMode);
}

// This object maintains state for a single WebSocket connection.
interface ConnState {
    // The Hrana client (which corresponds to a single WebSocket).
    client: hrana.WsClient;
    // We can cache SQL texts on the server only if the server supports Hrana 2. But to get the server
    // version, we need to wait for the WebSocket handshake to complete, so this value is initially
    // `undefined`, until we find out the version.
    useSqlCache: boolean | undefined;
    // The cache of SQL texts stored on the server. Initially has capacity 0, but it is set to
    // `sqlCacheCapacity` when `useSqlCache` is set to `true`.
    sqlCache: SqlCache,
    // The time when the connection was opened.
    openTime: Date;
    // Set of all `StreamState`-s that were opened from this connection. We can safely close the connection
    // only when this is empty.
    streamStates: Set<StreamState>;
}

interface StreamState {
    conn: ConnState;
    stream: hrana.WsStream;
}

const maxConnAgeMillis = 60*1000;
const sqlCacheCapacity = 100;

export class WsClient implements Client {
    #url: URL;
    #authToken: string | undefined;
    #intMode: IntMode;
    // State of the current connection. The `hrana.WsClient` inside may be closed at any moment due to an
    // asynchronous error.
    #connState: ConnState;
    // If defined, this is a connection that will be used in the future, once it is ready.
    #futureConnState: ConnState | undefined;
    closed: boolean;
    protocol: "ws";

    /** @private */
    constructor(client: hrana.WsClient, url: URL, authToken: string | undefined, intMode: IntMode) {
        this.#url = url;
        this.#authToken = authToken;
        this.#intMode = intMode;
        this.#connState = this.#openConn(client);
        this.#futureConnState = undefined;
        this.closed = false;
        this.protocol = "ws";
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        const streamState = await this.#openStream();
        try {
            const hranaStmt = stmtToHrana(stmt);

            // Schedule all operations synchronously, so they will be pipelined and executed in a single
            // network roundtrip.
            streamState.conn.sqlCache.apply([hranaStmt]);
            const hranaRowsPromise = streamState.stream.query(hranaStmt);
            streamState.stream.close();

            return resultSetFromHrana(await hranaRowsPromise);
        } catch (e) {
            throw mapHranaError(e);
        } finally {
            this._closeStream(streamState);
        }
    }

    batch(mode: TransactionMode, stmts: Array<InStatement>): Promise<Array<ResultSet>>;
    batch(stmts: Array<InStatement>): Promise<Array<ResultSet>>;
    async batch(arg1: unknown, arg2: unknown = undefined): Promise<Array<ResultSet>> {
        const {mode, stmts} = extractBatchArgs(arg1, arg2);

        const streamState = await this.#openStream();
        try {
            const hranaStmts = stmts.map(stmtToHrana);

            // Schedule all operations synchronously, so they will be pipelined and executed in a single
            // network roundtrip.
            streamState.conn.sqlCache.apply(hranaStmts);
            const batch = streamState.stream.batch();
            const resultsPromise = executeHranaBatch(mode, batch, hranaStmts);
            streamState.stream.close();

            return await resultsPromise;
        } catch (e) {
            throw mapHranaError(e);
        } finally {
            this._closeStream(streamState);
        }
    }

    async transaction(mode: TransactionMode = "write"): Promise<WsTransaction> {
        const streamState = await this.#openStream();
        try {
            // the BEGIN statement will be batched with the first statement on the transaction to save a
            // network roundtrip
            return new WsTransaction(this, streamState, mode);
        } catch (e) {
            this._closeStream(streamState);
            throw mapHranaError(e);
        }
    }

    async executeMultiple(sql: string): Promise<void> {
        const streamState = await this.#openStream();
        try {
            // Schedule all operations synchronously, so they will be pipelined and executed in a single
            // network roundtrip.
            const promise = streamState.stream.sequence(sql);
            streamState.stream.close();

            await promise;
        } catch (e) {
            throw mapHranaError(e);
        } finally {
            this._closeStream(streamState);
        }
    }

    async #openStream(): Promise<StreamState> {
        if (this.closed) {
            throw new LibsqlError("The client is closed", "CLIENT_CLOSED");
        }

        const now = new Date();

        const ageMillis = now.valueOf() - this.#connState.openTime.valueOf();
        if (ageMillis > maxConnAgeMillis && this.#futureConnState === undefined) {
            // The existing connection is too old, let's open a new one.
            const futureConnState = this.#openConn();
            this.#futureConnState = futureConnState;

            // However, if we used `futureConnState` immediately, we would introduce additional latency,
            // because we would have to wait for the WebSocket handshake to complete, even though we may a
            // have perfectly good existing connection in `this.#connState`!
            //
            // So we wait until the `hrana.Client.getVersion()` operation completes (which happens when the
            // WebSocket hanshake completes), and only then we replace `this.#connState` with
            // `futureConnState`, which is stored in `this.#futureConnState` in the meantime.
            futureConnState.client.getVersion().then(
                (_version) => {
                    if (this.#connState !== futureConnState) {
                        // We need to close `this.#connState` before we replace it. However, it is possible
                        // that `this.#connState` has already been replaced: see the code below.
                        if (this.#connState.streamStates.size === 0) {
                            this.#connState.client.close();
                        } else {
                            // If there are existing streams on the connection, we must not close it, because
                            // these streams would be broken. The last stream to be closed will also close the
                            // connection in `_closeStream()`.
                        }
                    }

                    this.#connState = futureConnState;
                    this.#futureConnState = undefined;
                },
                (_e) => {
                    // If the new connection could not be established, let's just ignore the error and keep
                    // using the existing connection.
                    this.#futureConnState = undefined;
                },
            );
        }

        if (this.#connState.client.closed) {
            // An error happened on this connection and it has been closed. Let's try to seamlessly reconnect.
            try {
                if (this.#futureConnState !== undefined) {
                    // We are already in the process of opening a new connection, so let's just use it
                    // immediately.
                    this.#connState = this.#futureConnState;
                } else {
                    this.#connState = this.#openConn();
                }
            } catch (e) {
                throw mapHranaError(e);
            }
        }

        const connState = this.#connState;
        try {
            // Now we wait for the WebSocket handshake to complete (if it hasn't completed yet). Note that
            // this does not increase latency, because any messages that we would send on the WebSocket before
            // the handshake would be queued until the handshake is completed anyway.
            if (connState.useSqlCache === undefined) {
                connState.useSqlCache = await connState.client.getVersion() >= 2;
                if (connState.useSqlCache) {
                    connState.sqlCache.capacity = sqlCacheCapacity;
                }
            }

            const stream = connState.client.openStream();
            stream.intMode = this.#intMode;
            const streamState = {conn: connState, stream};
            connState.streamStates.add(streamState);
            return streamState;
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    #openConn(client?: hrana.WsClient): ConnState {
        try {
            client ??= hrana.openWs(this.#url, this.#authToken);
            return {
                client,
                useSqlCache: undefined,
                sqlCache: new SqlCache(client, 0),
                openTime: new Date(),
                streamStates: new Set(),
            };
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    _closeStream(streamState: StreamState): void {
        streamState.stream.close();

        const connState = streamState.conn;
        connState.streamStates.delete(streamState);
        if (connState.streamStates.size === 0 && connState !== this.#connState) {
            // We are not using this connection anymore and this is the last stream that was using it, so we
            // must close it now.
            connState.client.close();
        }
    }

    close(): void {
        this.#connState.client.close();
        this.closed = true;
    }
}

export class WsTransaction extends HranaTransaction implements Transaction {
    #client: WsClient;
    #streamState: StreamState;

    /** @private */
    constructor(client: WsClient, state: StreamState, mode: TransactionMode) {
        super(mode);
        this.#client = client;
        this.#streamState = state;
    }

    /** @private */
    override _getStream(): hrana.Stream {
        return this.#streamState.stream;
    }

    /** @private */
    override _getSqlCache(): SqlCache {
        return this.#streamState.conn.sqlCache;
    }

    override close(): void {
        this.#client._closeStream(this.#streamState);
    }

    override get closed(): boolean {
        return this.#streamState.stream.closed;
    }
}
