import * as hrana from "@libsql/hrana-client";

import type { Config, Client, Transaction, ResultSet, InStatement } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { supportedUrlLink } from "./help.js";
import { Lru } from "./lru.js";
import { encodeBaseUrl } from "./uri.js";

export * from "./api.js";

export function createClient(config: Config): HranaClient {
    return _createClient(expandConfig(config));
}

/** @private */
export function _createClient(config: ExpandedConfig): HranaClient {
    let scheme = config.scheme.toLowerCase();
    if (scheme === "libsql") {
        scheme = "wss";
    }
    if (scheme !== "wss" && scheme !== "ws") {
        throw new LibsqlError(
            'The WebSocket (Hrana) client supports only "libsql:", "wss:" and "ws:" URLs, ' +
                `got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
    const url = encodeBaseUrl(scheme, config.authority, config.path);

    let client: hrana.Client;
    try {
        client = hrana.open(url, config.authToken);
    } catch (e) {
        if (e instanceof hrana.WebSocketUnsupportedError) {
            const suggestedScheme = scheme === "wss" ? "https" : "http";
            const suggestedUrl = encodeBaseUrl(suggestedScheme, config.authority, config.path);
            throw new LibsqlError(
                "This environment does not support WebSockets, please switch to the HTTP client by using " +
                    `a "${suggestedScheme}:" URL (${JSON.stringify(suggestedUrl)}). ` +
                    "Note that the HTTP client does not support interactive transactions. " +
                    `For more information, please read ${supportedUrlLink}`,
                "WEBSOCKETS_NOT_SUPPORTED",
            );
        }
        throw mapHranaError(e);
    }

    return new HranaClient(client, url, config.authToken);
}

// This object maintains state for a single WebSocket connection.
interface ConnState {
    // The Hrana client (which corresponds to a single WebSocket).
    client: hrana.Client;
    // We can cache SQL texts on the server only if the server supports Hrana 2. But to get the server
    // version, we need to wait for the WebSocket handshake to complete, so this value is initially
    // `undefined`, until we find out the version.
    useSqlCache: boolean | undefined;
    // The LRU cache of SQL texts cached on the server. Can only be used if `useSqlCache` is `true`.
    sqlCache: Lru<string, hrana.Sql>;
    // The time when the connection was opened.
    openTime: Date;
    // Set of all `StreamState`-s that were opened from this connection. We can safely close the connection
    // only when this is empty.
    streamStates: Set<StreamState>;
}

interface StreamState {
    conn: ConnState;
    stream: hrana.Stream;
}

const maxConnAgeMillis = 60*1000;

export class HranaClient implements Client {
    #url: URL;
    #authToken: string | undefined;
    // State of the current connection. The `hrana.Client` inside may be closed at any moment due to an
    // asynchronous error.
    #connState: ConnState;
    // If defined, this is a connection that will be used in the future, once it is ready.
    #futureConnState: ConnState | undefined;
    closed: boolean;

    /** @private */
    constructor(client: hrana.Client, url: URL, authToken: string | undefined) {
        this.#url = url;
        this.#authToken = authToken;
        this.#connState = this.#openConn(client);
        this.#futureConnState = undefined;
        this.closed = false;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        const streamState = await this.#openStream();
        try {
            const hranaStmt = applySqlCache(streamState.conn, stmtToHrana(stmt));
            const hranaRows = await streamState.stream.query(hranaStmt);
            evictSqlCache(streamState.conn);
            return resultSetFromHrana(hranaRows);
        } catch (e) {
            throw mapHranaError(e);
        } finally {
            this._closeStream(streamState);
        }
    }

    async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        const streamState = await this.#openStream();
        try {
            const batch = streamState.stream.batch();
            
            const beginStep = batch.step();
            const beginPromise = beginStep.run("BEGIN").catch(_ => undefined);

            let lastStep = beginStep;
            const stmtPromises = stmts.map((stmt) => {
                const hranaStmt = applySqlCache(streamState.conn, stmtToHrana(stmt));
                const stmtStep = batch.step()
                    .condition(hrana.BatchCond.ok(lastStep));
                const stmtPromise = stmtStep.query(hranaStmt);

                lastStep = stmtStep;
                return stmtPromise;
            });

            const commitStep = batch.step()
                .condition(hrana.BatchCond.ok(lastStep));
            const commitPromise = commitStep.run("COMMIT");

            const rollbackStep = batch.step()
                .condition(hrana.BatchCond.not(hrana.BatchCond.ok(commitStep)));
            rollbackStep.run("ROLLBACK").catch(_ => undefined);

            await batch.execute();
            evictSqlCache(streamState.conn);

            const resultSets = [];
            for (const stmtPromise of stmtPromises) {
                const hranaRows = await stmtPromise;
                if (hranaRows === undefined) {
                    throw new LibsqlError(
                        "Server did not return a result for statement in a batch",
                        "SERVER_ERROR",
                    );
                }
                resultSets.push(resultSetFromHrana(hranaRows));
            }
            await commitPromise;

            return resultSets;
        } catch (e) {
            throw mapHranaError(e);
        } finally {
            this._closeStream(streamState);
        }
    }

    async transaction(): Promise<HranaTransaction> {
        const streamState = await this.#openStream();
        try {
            await streamState.stream.run("BEGIN");
            return new HranaTransaction(this, streamState);
        } catch (e) {
            this._closeStream(streamState);
            throw mapHranaError(e);
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
            }

            const stream = connState.client.openStream();
            const streamState = {conn: connState, stream};
            connState.streamStates.add(streamState);
            return streamState;
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    #openConn(client?: hrana.Client): ConnState {
        try {
            return {
                client: client ?? hrana.open(this.#url, this.#authToken),
                useSqlCache: undefined,
                sqlCache: new Lru(),
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

export class HranaTransaction implements Transaction {
    #client: HranaClient;
    #streamState: StreamState;

    /** @private */
    constructor(client: HranaClient, state: StreamState) {
        this.#client = client;
        this.#streamState = state;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        if (this.#streamState.stream.closed) {
            throw new LibsqlError(
                "Cannot execute a statement because the transaction is closed",
                "TRANSACTION_CLOSED",
            );
        }

        try {
            const hranaStmt = applySqlCache(this.#streamState.conn, stmtToHrana(stmt));
            const hranaRows = await this.#streamState.stream.query(hranaStmt);
            evictSqlCache(this.#streamState.conn);
            return resultSetFromHrana(hranaRows);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async rollback(): Promise<void> {
        if (this.#streamState.stream.closed) {
            return;
        }
        const promise = this.#streamState.stream.run("ROLLBACK")
            .catch(e => { throw mapHranaError(e); });
        this.#streamState.stream.close();
        await promise;
    }

    async commit(): Promise<void> {
        if (this.#streamState.stream.closed) {
            throw new LibsqlError(
                "Cannot commit the transaction because it is already closed",
                "TRANSACTION_CLOSED",
            );
        }
        const promise = this.#streamState.stream.run("COMMIT")
            .catch(e => { throw mapHranaError(e); });
        this.#streamState.stream.close();
        await promise;
    }

    close(): void {
        this.#client._closeStream(this.#streamState);
    }

    get closed(): boolean {
        return this.#streamState.stream.closed;
    }
}



const sqlCacheCapacity = 100;

function applySqlCache(connState: ConnState, hranaStmt: hrana.Stmt): hrana.Stmt {
    if (connState.useSqlCache && typeof hranaStmt.sql === "string") {
        const sqlText: string = hranaStmt.sql;

        let sqlObj = connState.sqlCache.get(sqlText);
        if (sqlObj === undefined) {
            sqlObj = connState.client.storeSql(sqlText);
            connState.sqlCache.set(sqlText, sqlObj);
        }

        if (sqlObj !== undefined) {
            hranaStmt.sql = sqlObj;
        }
    }
    return hranaStmt;
}

function evictSqlCache(connState: ConnState): void {
    while (connState.sqlCache.size > sqlCacheCapacity) {
        const sqlObj = connState.sqlCache.deleteLru()!;
        sqlObj.close();
    }
}



export function stmtToHrana(stmt: InStatement): hrana.Stmt {
    if (typeof stmt === "string") {
        return new hrana.Stmt(stmt);
    }

    const hranaStmt = new hrana.Stmt(stmt.sql);
    if (Array.isArray(stmt.args)) {
        hranaStmt.bindIndexes(stmt.args);
    } else {
        for (const [key, value] of Object.entries(stmt.args)) {
            hranaStmt.bindName(key, value);
        }
    }

    return hranaStmt;
}

export function resultSetFromHrana(hranaRows: hrana.RowsResult): ResultSet {
    return {
        columns: hranaRows.columnNames.map(c => c ?? ""),
        rows: hranaRows.rows,
        rowsAffected: hranaRows.affectedRowCount,
        lastInsertRowid: hranaRows.lastInsertRowid !== undefined
            ? BigInt(hranaRows.lastInsertRowid) : undefined,
    };
}

export function mapHranaError(e: unknown): unknown {
    if (e instanceof hrana.ClientError) {
        let code = "UNKNOWN";
        if (e instanceof hrana.ResponseError && e.code !== undefined) {
            code = e.code;
        } else if (e instanceof hrana.ProtoError) {
            code = "HRANA_PROTO_ERROR";
        } else if (e instanceof hrana.ClosedError) {
            code = "HRANA_CLOSED_ERROR";
        } else if (e instanceof hrana.WebSocketError) {
            code = "HRANA_WEBSOCKET_ERROR";
        }
        return new LibsqlError(e.message, code, e);
    }
    return e;
}
