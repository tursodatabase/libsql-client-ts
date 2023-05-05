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
        throw e;
    }

    return new HranaClient(client, url, config.authToken);
}

interface ConnState {
    client: hrana.Client;
    useSqlCache: boolean | undefined;
    sqlCache: Lru<string, hrana.Sql>;
}

interface StreamState extends ConnState {
    stream: hrana.Stream;
}

export class HranaClient implements Client {
    #url: URL;
    #authToken: string | undefined;
    #connState: ConnState;
    closed: boolean;

    /** @private */
    constructor(client: hrana.Client, url: URL, authToken: string | undefined) {
        this.#url = url;
        this.#authToken = authToken;
        this.#connState = {
            client,
            useSqlCache: undefined,
            sqlCache: new Lru(),
        };
        this.closed = false;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        const state = await this.#openStream();
        try {
            const hranaStmt = applySqlCache(state, stmtToHrana(stmt));
            const hranaRows = await state.stream.query(hranaStmt);
            evictSqlCache(state);
            return resultSetFromHrana(hranaRows);
        } catch (e) {
            throw mapHranaError(e);
        } finally {
            state.stream.close();
        }
    }

    async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        const state = await this.#openStream();
        try {
            const batch = state.stream.batch();
            
            const beginStep = batch.step();
            const beginPromise = beginStep.run("BEGIN").catch(_ => undefined);

            let lastStep = beginStep;
            const stmtPromises = stmts.map((stmt) => {
                const hranaStmt = applySqlCache(state, stmtToHrana(stmt));
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
            evictSqlCache(state);

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
            state.stream.close();
        }
    }

    async transaction(): Promise<HranaTransaction> {
        const state = await this.#openStream();
        try {
            await state.stream.run("BEGIN");
            return new HranaTransaction(state);
        } catch (e) {
            state.stream.close();
            throw mapHranaError(e);
        }
    }

    async #openStream(): Promise<StreamState> {
        if (this.closed) {
            throw new LibsqlError("The client is closed", "CLIENT_CLOSED");
        }

        if (this.#connState.client.closed) {
            try {
                this.#connState = {
                    client: hrana.open(this.#url, this.#authToken),
                    useSqlCache: undefined,
                    sqlCache: new Lru(),
                };
            } catch (e) {
                throw mapHranaError(e);
            }
        }

        const connState = this.#connState;
        try {
            if (connState.useSqlCache === undefined) {
                connState.useSqlCache = await connState.client.getVersion() >= 2;
            }
            const stream = connState.client.openStream();
            return {stream, ...connState};
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    close(): void {
        this.#connState.client.close();
        this.closed = true;
    }
}

export class HranaTransaction implements Transaction {
    #state: StreamState;

    /** @private */
    constructor(state: StreamState) {
        this.#state = state;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        if (this.#state.stream.closed) {
            throw new LibsqlError(
                "Cannot execute a statement because the transaction is closed",
                "TRANSACTION_CLOSED",
            );
        }

        try {
            const hranaStmt = applySqlCache(this.#state, stmtToHrana(stmt));
            const hranaRows = await this.#state.stream.query(hranaStmt);
            evictSqlCache(this.#state);
            return resultSetFromHrana(hranaRows);
        } catch (e) {
            throw mapHranaError(e);
        }
    }

    async rollback(): Promise<void> {
        if (this.#state.stream.closed) {
            return;
        }
        const promise = this.#state.stream.run("ROLLBACK")
            .catch(e => { throw mapHranaError(e); });
        this.#state.stream.close();
        await promise;
    }

    async commit(): Promise<void> {
        if (this.#state.stream.closed) {
            throw new LibsqlError(
                "Cannot commit the transaction because it is already closed",
                "TRANSACTION_CLOSED",
            );
        }
        const promise = this.#state.stream.run("COMMIT")
            .catch(e => { throw mapHranaError(e); });
        this.#state.stream.close();
        await promise;
    }

    close(): void {
        this.#state.stream.close();
    }

    get closed(): boolean {
        return this.#state.stream.closed;
    }
}



const sqlCacheCapacity = 100;

function applySqlCache(state: ConnState, hranaStmt: hrana.Stmt): hrana.Stmt {
    if (state.useSqlCache && typeof hranaStmt.sql === "string") {
        const sqlText: string = hranaStmt.sql;

        let sqlObj = state.sqlCache.get(sqlText);
        if (sqlObj === undefined) {
            sqlObj = state.client.storeSql(sqlText);
            state.sqlCache.set(sqlText, sqlObj);
        }

        if (sqlObj !== undefined) {
            hranaStmt.sql = sqlObj;
        }
    }
    return hranaStmt;
}

function evictSqlCache(state: ConnState): void {
    while (state.sqlCache.size > sqlCacheCapacity) {
        const sqlObj = state.sqlCache.deleteLru()!;
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
