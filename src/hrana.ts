import * as hrana from "@libsql/hrana-client";

import type { Config, Client, Transaction, ResultSet, InStatement } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
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
            'The WebSocket (Hrana) client supports only "libsql", "wss" and "ws" URLs, ' +
                `got ${JSON.stringify(config.scheme)}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }
    const url = encodeBaseUrl(scheme, config.authority, config.path);
    
    let client: hrana.Client;
    try {
      client = hrana.open(url, config.authToken);
    } catch (e) {
      throw new LibsqlError('The WebSocket (Hrana) client failed to open, try using "https" URL if your platform does not support web sockets', "HRANA_WEBSOCKET_ERROR");
    }
    return new HranaClient(client);
}

export class HranaClient implements Client {
    client: hrana.Client;

    /** @private */
    constructor(client: hrana.Client) {
        this.client = client;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        const stream = this.client.openStream();
        try {
            const hranaStmt = stmtToHrana(stmt);
            const hranaRows = await stream.query(hranaStmt);
            return resultSetFromHrana(hranaRows);
        } catch (e) {
            throw mapHranaError(e);
        } finally {
            stream.close();
        }
    }

    async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        const stream = this.client.openStream();
        try {
            const batch = stream.batch();
            
            const beginStep = batch.step();
            const beginPromise = beginStep.run("BEGIN").catch(_ => undefined);

            let lastStep = beginStep;
            const stmtPromises = stmts.map((stmt) => {
                const hranaStmt = stmtToHrana(stmt);
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

            const resultSets = [];
            for (const stmtPromise of stmtPromises) {
                const hranaRows = await stmtPromise;
                if (hranaRows === undefined) {
                    throw new LibsqlError("Server did not return a result", "SERVER_ERROR");
                }
                resultSets.push(resultSetFromHrana(hranaRows));
            }
            await commitPromise;

            return resultSets;
        } catch (e) {
            throw mapHranaError(e);
        } finally {
            stream.close();
        }
    }

    async transaction(): Promise<HranaTransaction> {
        const stream = this.client.openStream();
        try {
            await stream.run("BEGIN");
            return new HranaTransaction(stream);
        } catch (e) {
            stream.close();
            throw mapHranaError(e);
        }
    }

    close(): void {
        this.client.close();
    }

    get closed(): boolean {
        return this.client.closed;
    }
}

export class HranaTransaction implements Transaction {
    stream: hrana.Stream;

    /** @private */
    constructor(stream: hrana.Stream) {
        this.stream = stream;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        if (this.stream.closed) {
            throw new LibsqlError(
                "Cannot execute a statement, the transaction has already ended",
                "TRANSACTION_CLOSED",
            );
        }
        const hranaStmt = stmtToHrana(stmt);
        const hranaRows = await this.stream.query(hranaStmt)
            .catch(e => { throw mapHranaError(e); });
        return resultSetFromHrana(hranaRows);
    }

    async rollback(): Promise<void> {
        if (this.stream.closed) {
            return;
        }
        const promise = this.stream.run("ROLLBACK")
            .catch(e => { throw mapHranaError(e); });
        this.stream.close();
        await promise;
    }

    async commit(): Promise<void> {
        if (this.stream.closed) {
            throw new LibsqlError(
                "Cannot commit the transaction, because it has already ended",
                "TRANSACTION_CLOSED",
            );
        }
        const promise = this.stream.run("COMMIT")
            .catch(e => { throw mapHranaError(e); });
        this.stream.close();
        await promise;
    }

    close(): void {
        this.stream.close();
    }

    get closed(): boolean {
        return this.stream.closed;
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
        }
        return new LibsqlError(e.message, code, e);
    }
    return e;
}
