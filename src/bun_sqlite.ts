// @ts-ignore bun:sqlite is not typed when building
import { Database, SQLQueryBindings } from "bun:sqlite";
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
import {
    transactionModeToBegin,
    ResultSetImpl,
    validateFileConfig,
    parseStatement,
    minSafeBigint,
    maxSafeBigint,
    minInteger,
    maxInteger,
} from "./util.js";

export * from "./api.js";

type ConstructorParameters<T> = T extends new (...args: infer P) => any ? P : never;
type DatabaseOptions = ConstructorParameters<typeof Database>[1];

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
}

/** @private */
export function _createClient(config: ExpandedConfig): Client {
    const isBun = !!(globalThis as any).Bun || !!(globalThis as any).process?.versions?.bun;
    if (!isBun) throw new LibsqlError("Bun is not available", "BUN_NOT_AVAILABLE");
    // bigint handling https://github.com/oven-sh/bun/issues/1536
    if (config.intMode !== "number") throw intModeNotImplemented(config.intMode);
    validateFileConfig(config);

    const path = config.path;
    const options = undefined; //@todo implement options
    const db = new Database(path);
    try {
        executeStmt(db, "SELECT 1 AS checkThatTheDatabaseCanBeOpened", config.intMode);
    } finally {
        db.close();
    }

    return new BunSqliteClient(path, options, config.intMode);
}

export class BunSqliteClient implements Client {
    #path: string;
    #options: DatabaseOptions;
    #intMode: IntMode;
    closed: boolean;
    protocol: "file";

    /** @private */
    constructor(path: string, options: DatabaseOptions, intMode: IntMode) {
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
            return new BunSqliteTransaction(db, this.#intMode);
        } catch (e) {
            db.close();
            throw e;
        }
    }

    async executeMultiple(sql: string): Promise<void> {
        throw executeMultipleNotImplemented();
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

export class BunSqliteTransaction implements Transaction {
    #database: Database;
    #intMode: IntMode;
    #closed: boolean;

    /** @private */
    constructor(database: Database, intMode: IntMode) {
        this.#database = database;
        this.#intMode = intMode;
        this.#closed = false;
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
        throw executeMultipleNotImplemented();
    }

    async rollback(): Promise<void> {
        if (this.#closed) {
            return;
        }
        this.#checkNotClosed();
        executeStmt(this.#database, "ROLLBACK", this.#intMode);
        this.close();
    }

    async commit(): Promise<void> {
        this.#checkNotClosed();
        executeStmt(this.#database, "COMMIT", this.#intMode);
        this.close();
    }

    close(): void {
        this.#database.close();
        this.#closed = true;
    }

    get closed(): boolean {
        return this.#closed;
    }

    #checkNotClosed(): void {
        if (this.#closed || !this.#database.inTransaction) {
            throw new LibsqlError("The transaction is closed", "TRANSACTION_CLOSED");
        }
    }
}

function executeStmt(db: Database, stmt: InStatement, intMode: IntMode): ResultSet {
    const { sql, args } = parseStatement(stmt, valueToSql);
    try {
        const sqlStmt = db.prepare(sql);
        const data = sqlStmt.all(args as SQLQueryBindings) as Record<string, Value>[];
        sqlStmt.finalize();
        if (Array.isArray(data) && data.length > 0) {
            const columns = sqlStmt.columnNames;
            const rows = convertSqlResultToRows(data, intMode);
            //@note info about the last insert rowid is not available with bun:sqlite
            const rowsAffected = 0;
            const lastInsertRowid = undefined;
            return new ResultSetImpl(columns, rows, rowsAffected, lastInsertRowid);
        } else {
            const rowsAffected = typeof data === "number" ? data : 0;
            const lastInsertRowid = BigInt(0);
            return new ResultSetImpl([], [], rowsAffected, lastInsertRowid);
        }
    } catch (e) {
        throw mapSqliteError(e);
    }
}

function convertSqlResultToRows(results: Record<string, Value>[], intMode: IntMode): Row[] {
    return results.map((result) => {
        const entries = Object.entries(result);
        const row: Partial<Row> = {};

        //We use Object.defineProperty to make the properties non-enumerable
        entries.forEach(([name, v], index) => {
            const value = valueFromSql(v, intMode);
            Object.defineProperty(row, name, { value, enumerable: true, configurable: true });
            Object.defineProperty(row, index, { value, configurable: true });
        });

        Object.defineProperty(row, "length", { value: entries.length, configurable: true });

        return row as Row;
    });
}

function valueFromSql(sqlValue: unknown, intMode: IntMode): Value {
    // https://github.com/oven-sh/bun/issues/1536
    if (typeof sqlValue === "bigint") {
        if (intMode === "number") {
            if (sqlValue < minSafeBigint || sqlValue > maxSafeBigint) {
                throw new RangeError("Received integer which cannot be safely represented as a JavaScript number");
            }
            return Number(sqlValue);
        } else if (intMode === "bigint") {
            return sqlValue;
        } else if (intMode === "string") {
            return String(sqlValue);
        } else {
            throw new Error("Invalid value for IntMode");
        }
    } else if (ArrayBuffer.isView(sqlValue)) {
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
        return value;
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

const BUN_SQLITE_ERROR = "BUN_SQLITE ERROR" as const;

function mapSqliteError(e: unknown): unknown {
    if (e instanceof RangeError) {
        return e;
    }
    if (e instanceof Error) {
        return new LibsqlError(e.message, BUN_SQLITE_ERROR, e);
    }
    return e;
}

const executeMultipleNotImplemented = () =>
    new LibsqlError("bun:sqlite doesn't support executeMultiple. Use batch instead.", BUN_SQLITE_ERROR);

const intModeNotImplemented = (mode: string) =>
    new LibsqlError(`"${mode}" intMode is not supported by bun:sqlite. Only intMode "number" is supported.`, BUN_SQLITE_ERROR);
