import Database from "better-sqlite3";
import { Buffer } from "node:buffer";

import type {
    Config,
    IntMode,
    Client,
    Transaction,
    TransactionMode,
    ResultSet,
    Row,
    Value,
    InValue,
    InStatement,
} from "./api.js";
import { LibsqlError } from "./api.js";
import { expandConfig, type ExpandedConfig } from "./config.js";
import { transactionModeToBegin, ResultSetImpl, validateFileConfig, parseStatement } from "./util.js";

export * from "./api.js";

const minInteger = -9223372036854775808n;
const maxInteger = 9223372036854775807n;
const minSafeBigint = -9007199254740991n;
const maxSafeBigint = 9007199254740991n;

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
}

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    validateFileConfig(config);

    const path = config.path;
    const options = {};

    const db = new Database(path, options);
    try {
        executeStmt(db, "SELECT 1 AS checkThatTheDatabaseCanBeOpened", config.intMode);
    } finally {
        db.close();
    }

    return new Sqlite3Client(path, options, config.intMode);
}

export class Sqlite3Client implements Client {
    #path: string;
    #options: Database.Options;
    #intMode: IntMode;
    closed: boolean;
    protocol: "file";

    /** @private */
    constructor(path: string, options: Database.Options, intMode: IntMode) {
        this.#path = path;
        this.#options = options;
        this.#intMode = intMode;
        this.closed = false;
        this.protocol = "file";
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        this.#checkNotClosed();
        const db = new Database(this.#path, this.#options);
        try {
            return executeStmt(db, stmt, this.#intMode);
        } finally {
            db.close();
        }
    }

    async batch(stmts: Array<InStatement>, mode: TransactionMode = "deferred"): Promise<Array<ResultSet>> {
        this.#checkNotClosed();
        const db = new Database(this.#path, this.#options);
        try {
            executeStmt(db, transactionModeToBegin(mode), this.#intMode);
            const resultSets = stmts.map((stmt) => {
                if (!db.inTransaction) {
                    throw new LibsqlError("The transaction has been rolled back", "TRANSACTION_CLOSED");
                }
                return executeStmt(db, stmt, this.#intMode);
            });
            executeStmt(db, "COMMIT", this.#intMode);
            return resultSets;
        } finally {
            db.close();
        }
    }

    async transaction(mode: TransactionMode = "write"): Promise<Transaction> {
        this.#checkNotClosed();
        const db = new Database(this.#path, this.#options);
        try {
            executeStmt(db, transactionModeToBegin(mode), this.#intMode);
            return new Sqlite3Transaction(db, this.#intMode);
        } catch (e) {
            db.close();
            throw e;
        }
    }

    async executeMultiple(sql: string): Promise<void> {
        this.#checkNotClosed();
        const db = new Database(this.#path, this.#options);
        try {
            return executeMultiple(db, sql);
        } finally {
            db.close();
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
    #database: Database.Database;
    #intMode: IntMode;

    /** @private */
    constructor(database: Database.Database, intMode: IntMode) {
        this.#database = database;
        this.#intMode = intMode;
    }

    async execute(stmt: InStatement): Promise<ResultSet> {
        this.#checkNotClosed();
        return executeStmt(this.#database, stmt, this.#intMode);
    }

    async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        return stmts.map((stmt) => {
            this.#checkNotClosed();
            return executeStmt(this.#database, stmt, this.#intMode);
        });
    }

    async executeMultiple(sql: string): Promise<void> {
        this.#checkNotClosed();
        return executeMultiple(this.#database, sql);
    }

    async rollback(): Promise<void> {
        if (!this.#database.open) {
            return;
        }
        this.#checkNotClosed();
        executeStmt(this.#database, "ROLLBACK", this.#intMode);
        this.#database.close();
    }

    async commit(): Promise<void> {
        this.#checkNotClosed();
        executeStmt(this.#database, "COMMIT", this.#intMode);
        this.#database.close();
    }

    close(): void {
        this.#database.close();
    }

    get closed(): boolean {
        return !this.#database.open;
    }

    #checkNotClosed(): void {
        if (!this.#database.open || !this.#database.inTransaction) {
            throw new LibsqlError("The transaction is closed", "TRANSACTION_CLOSED");
        }
    }
}

function executeStmt(db: Database.Database, stmt: InStatement, intMode: IntMode): ResultSet {
    const transformKeys = (name: string) => (name[0] === "@" || name[0] === "$" || name[0] === ":" ? name.substring(1) : name);
    const { sql, args } = parseStatement(stmt, valueToSql, transformKeys);

    try {
        const sqlStmt = db.prepare(sql);
        sqlStmt.safeIntegers(true);

        let returnsData = true;
        try {
            sqlStmt.raw(true);
        } catch {
            // raw() throws an exception if the statement does not return data
            returnsData = false;
        }

        if (returnsData) {
            const columns = Array.from(sqlStmt.columns().map((col) => col.name));
            const rows = sqlStmt.all(args).map((sqlRow) => {
                return rowFromSql(sqlRow as Array<unknown>, columns, intMode);
            });
            // TODO: can we get this info from better-sqlite3?
            const rowsAffected = 0;
            const lastInsertRowid = undefined;
            return new ResultSetImpl(columns, rows, rowsAffected, lastInsertRowid);
        } else {
            const info = sqlStmt.run(args);
            const rowsAffected = info.changes;
            const lastInsertRowid = BigInt(info.lastInsertRowid);
            return new ResultSetImpl([], [], rowsAffected, lastInsertRowid);
        }
    } catch (e) {
        throw mapSqliteError(e);
    }
}

function rowFromSql(sqlRow: Array<unknown>, columns: Array<string>, intMode: IntMode): Row {
    const row = {};
    // make sure that the "length" property is not enumerable
    Object.defineProperty(row, "length", { value: sqlRow.length });
    for (let i = 0; i < sqlRow.length; ++i) {
        const value = valueFromSql(sqlRow[i], intMode);
        Object.defineProperty(row, i, { value });

        const column = columns[i];
        if (!Object.hasOwn(row, column)) {
            Object.defineProperty(row, column, { value, enumerable: true });
        }
    }
    return row as Row;
}

function valueFromSql(sqlValue: unknown, intMode: IntMode): Value {
    if (typeof sqlValue === "bigint") {
        if (intMode === "number") {
            if (sqlValue < minSafeBigint || sqlValue > maxSafeBigint) {
                throw new RangeError("Received integer which cannot be safely represented as a JavaScript number");
            }
            return Number(sqlValue);
        } else if (intMode === "bigint") {
            return sqlValue;
        } else if (intMode === "string") {
            return "" + sqlValue;
        } else {
            throw new Error("Invalid value for IntMode");
        }
    } else if (sqlValue instanceof Buffer) {
        return sqlValue.buffer as Value;
    }
    return sqlValue as Value;
}

function valueToSql(value: InValue) {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new RangeError("Only finite numbers (not Infinity or NaN) can be passed as arguments");
        }
        return value;
    } else if (typeof value === "bigint") {
        if (value < minInteger || value > maxInteger) {
            throw new RangeError("bigint is too large to be represented as a 64-bit integer and passed as argument");
        }
        return value;
    } else if (typeof value === "boolean") {
        return value ? 1n : 0n;
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

function executeMultiple(db: Database.Database, sql: string): void {
    try {
        db.exec(sql);
    } catch (e) {
        throw mapSqliteError(e);
    }
}

function mapSqliteError(e: unknown): unknown {
    if (e instanceof Database.SqliteError) {
        return new LibsqlError(e.message, e.code, e);
    }
    return e;
}
