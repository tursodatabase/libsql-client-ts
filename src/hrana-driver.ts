import * as hrana from "@libsql/hrana-client";
import type { Driver } from "./driver.js";
import type { BoundStatement, Params, ResultSet, SqlValue, Row } from "./shared-types.js";

export class HranaDriver implements Driver {
    #client: hrana.Client

    constructor(url: string, jwt?: string) {
        this.#client = hrana.open(url, jwt);
        // TODO: close the client when we add a `close()` method
    }

    async execute(stmt: string, params?: Params): Promise<ResultSet> {
        const stream = this.#client.openStream();
        try {
            const hranaStmt = stmtToHrana(stmt, params);
            try {
                const hranaRows = await stream.query(hranaStmt);
                return resultSetFromHranaRows(hranaRows);
            } catch (e) {
                if (e instanceof hrana.ResponseError) {
                    return resultSetFromHranaError(e);
                }
                throw e;
            }
        } finally {
            stream.close();
        }
    }

    async transaction(stmts: (string | BoundStatement)[]): Promise<ResultSet[]> {
        const stream = this.#client.openStream();
        try {
            const beginPromise = stream.execute("BEGIN");
            const resultPromises = stmts.map((stmt) => {
                const hranaStmt = typeof stmt === "string" 
                    ? stmtToHrana(stmt, undefined) : stmtToHrana(stmt.q, stmt.params);
                return stream.query(hranaStmt);
            });

            // TODO: this has different semantics from the HTTP and SQLite driver.
            //
            // - The HTTP driver ignores the results of the BEGIN and COMMIT statements, so it can return a
            // successful response even if the transaction does not commit
            // - The SQLite driver does not start a transaction at all
            // - Both HTTP and SQLite driver will happily commit a transaction if some of the statements
            // failed
            //
            // This is not correct behavior by any stretch of imagination.
            //
            // Our behavior is as follows:
            // - We throw an error if the BEGIN or COMMIT fail
            // - We also throw an error if any of the statements fails, and we don't commit the transaction in
            // this case
            await beginPromise;
            const hranaResults = await Promise.all(resultPromises);
            await stream.execute("COMMIT");

            return hranaResults.map(resultSetFromHranaRows);
        } finally {
            stream.close();
        }
    }
}

function stmtToHrana(sql: string, params: Params | undefined): hrana.Stmt {
    // TODO: this cast is necessary (and incorrect) because `SqlValue` uses `{ base64: string }` instead of
    // `ArrayBuffer`
    return [sql, params ?? []] as hrana.Stmt;
}

function resultSetFromHranaRows(hranaRows: hrana.RowArray): ResultSet {
    return {
        success: true,
        columns: hranaRows.columnNames.map((col) => col ?? ""),
        // NOTE: the `ResultSet` type says that every row is a Record, but in fact both the HTTP driver and
        // SQLite driver return Array-s
        rows: hranaRows.map((hranaRow) => Array.of(hranaRow)) as unknown as Array<Row>,
        meta: {duration: 0},
    };
}

function resultSetFromHranaError(error: hrana.ResponseError): ResultSet {
    return {
        success: false,
        error: {message: error.message},
        meta: {duration: 0},
    };
}
