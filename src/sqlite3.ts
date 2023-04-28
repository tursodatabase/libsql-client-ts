import Database from "better-sqlite3";
import { Buffer } from "node:buffer";

import type { Config, Client, Transaction, ResultSet, Row, Value, InValue, InStatement } from "./api.js";
import { LibsqlError } from "./api.js";
import type { ExpandedConfig } from "./config.js";
import { expandConfig } from "./config.js";
import { supportedUrlLink } from "./help.js";

export * from "./api.js";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config));
}

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    if (config.scheme !== "file") {
        throw new LibsqlError(
            `URL scheme ${JSON.stringify(config.scheme + ":")} is not supported by the local sqlite3 client. ` +
                `For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED",
        );
    }

    const authority = config.authority;
    if (authority !== undefined) {
        const host = authority.host.toLowerCase();
        if (host !== "" && host !== "localhost") {
            throw new LibsqlError(
                `Invalid host in file URL: ${JSON.stringify(authority.host)}. ` +
                    'A "file:" URL with an absolute path should start with one slash ("file:/absolute/path.db") ' +
                    'or with three slashes ("file:///absolute/path.db"). ' +
                    `For more information, please read ${supportedUrlLink}`,
                "URL_INVALID",
            );
        }

        if (authority.port !== undefined) {
            throw new LibsqlError("File URL cannot have a port", "URL_INVALID");
        }
        if (authority.userinfo !== undefined) {
            throw new LibsqlError("File URL cannot have username and password", "URL_INVALID");
        }
    }

    const path = config.path;
    const options = {};

    const db = new Database(path, options);
    try {
        executeStmt(db, "SELECT 1 AS checkThatTheDatabaseCanBeOpened");
    } finally {
        db.close();
    }

    return new Sqlite3Client(path, options);
}

export class Sqlite3Client implements Client {
    path: string;
    options: Database.Options;
    closed: boolean;

    /** @private */
    constructor(path: string, options: Database.Options) {
        this.path = path;
        this.options = options;
        this.closed = false;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        this.#checkNotClosed();
        const db = new Database(this.path, this.options);
        try {
            return executeStmt(db, stmt);
        } finally {
            db.close();
        }
    }

    async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        this.#checkNotClosed();
        const db = new Database(this.path, this.options);
        try {
            if (stmts.length > 1) executeStmt(db, "BEGIN");
            const resultSets = stmts.map(stmt => executeStmt(db, stmt));
            if (stmts.length > 1) executeStmt(db, "COMMIT");
            return resultSets;
        } finally {
            db.close();
        }
    }

    async transaction(): Promise<Transaction> {
        this.#checkNotClosed();
        const db = new Database(this.path, this.options);
        try {
            executeStmt(db, "BEGIN");
            return new Sqlite3Transaction(db);
        } catch (e) {
            db.close();
            throw e;
        }
    }

    close(): void {
        this.closed = true;
    }

    #checkNotClosed(): void {
        if (this.closed) {
            throw new LibsqlError("The client is closed", "CLIENT_CLOSED");
        }
    }
}

export class Sqlite3Transaction implements Transaction {
    database: Database.Database

    /** @private */
    constructor(database: Database.Database) {
        this.database = database;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        this.#checkNotClosed();
        return executeStmt(this.database, stmt);
    }

    async rollback(): Promise<void> {
        if (!this.database.open) {
            return;
        }
        executeStmt(this.database, "ROLLBACK");
        this.database.close();
    }

    async commit(): Promise<void> {
        this.#checkNotClosed();
        executeStmt(this.database, "COMMIT");
        this.database.close();
    }

    close(): void {
        this.database.close();
    }

    get closed(): boolean {
        return !this.database.open;
    }

    #checkNotClosed(): void {
        if (!this.database.open) {
            throw new LibsqlError("The transaction is closed", "TRANSACTION_CLOSED");
        }
    }
}

function executeStmt(db: Database.Database, stmt: InStatement): ResultSet {
    let sql: string;
    let args: Array<unknown> | Record<string, unknown>;
    if (typeof stmt === "string") {
        sql = stmt;
        args = [];
    } else {
        sql = stmt.sql;
        if (Array.isArray(stmt.args)) {
            args = stmt.args.map(valueToSql);
        } else {
            args = {};
            for (const name in stmt.args) {
                const argName = (name[0] === "@" || name[0] === "$" || name[0] === ":")
                    ? name.substring(1) : name;
                args[argName] = valueToSql(stmt.args[name]);
            }
        }
    }

    try {
        const sqlStmt = db.prepare(sql);

        let returnsData = true;
        try {
            sqlStmt.raw(true);
        } catch {
            // raw() throws an exception if the statement does not return data
            returnsData = false;
        }

        if (returnsData) {
            const columns = Array.from(sqlStmt.columns().map(col => col.name));
            const rows = sqlStmt.all(args).map(sqlRow => rowFromSql(sqlRow, columns));
            // TODO: can we get this info from better-sqlite3?
            const rowsAffected = 0;
            const lastInsertRowid = undefined;
            return { columns, rows, rowsAffected, lastInsertRowid };
        } else {
            const info = sqlStmt.run(args);
            const rowsAffected = info.changes;
            const lastInsertRowid = BigInt(info.lastInsertRowid);
            return { columns: [], rows: [], rowsAffected, lastInsertRowid };
        }
    } catch (e) {
        if (e instanceof Database.SqliteError) {
            throw new LibsqlError(e.message, e.code, e);
        }
        throw e;
    }
}

function rowFromSql(sqlRow: Array<unknown>, columns: Array<string>): Row {
    const row = {};
    // make sure that the "length" property is not enumerable
    Object.defineProperty(row, "length", { value: sqlRow.length });
    for (let i = 0; i < sqlRow.length; ++i) {
        const value = valueFromSql(sqlRow[i]);
        Object.defineProperty(row, i, { value });

        const column = columns[i];
        if (!Object.hasOwn(row, column)) {
            Object.defineProperty(row, column, { value, enumerable: true });
        }
    }
    return row as Row;
}

function valueFromSql(sqlValue: unknown): Value {
    if (sqlValue instanceof Buffer) {
        return sqlValue.buffer;
    }
    return sqlValue as Value;
}

function valueToSql(value: InValue): unknown {
    if (typeof value === "bigint") {
        return ""+value;
    } else if (typeof value === "boolean") {
        return value ? 1 : 0;
    } else if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    } else if (value instanceof Date) {
        return value.valueOf();
    } else if (value === undefined) {
        throw new TypeError("undefined cannot be passed as argument to the database");
    } else {
        return value;
    }
}
