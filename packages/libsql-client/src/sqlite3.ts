import Database from "libsql";
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
    InArgs,
    Replicated,
} from "@libsql/core/api";
import { LibsqlError, LibsqlBatchError } from "@libsql/core/api";
import type { ExpandedConfig } from "@libsql/core/config";
import { expandConfig, isInMemoryConfig } from "@libsql/core/config";
import {
    supportedUrlLink,
    transactionModeToBegin,
    ResultSetImpl,
} from "@libsql/core/util";

export * from "@libsql/core/api";

export function createClient(config: Config): Client {
    return _createClient(expandConfig(config, true));
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
            throw new LibsqlError(
                "File URL cannot have username and password",
                "URL_INVALID",
            );
        }
    }

    let isInMemory = isInMemoryConfig(config);
    if (isInMemory && config.syncUrl) {
        throw new LibsqlError(
            `Embedded replica must use file for local db but URI with in-memory mode were provided instead: ${config.path}`,
            "URL_INVALID",
        );
    }

    let path = config.path;
    if (isInMemory) {
        // note: we should prepend file scheme in order for SQLite3 to recognize :memory: connection query parameters
        path = `${config.scheme}:${config.path}`;
    }

    // An in-memory database exists only on the connection that opened it, so a
    // second connection would be a second, empty database rather than another
    // way into the same one. Each connection to an embedded replica carries
    // its own sync state. Both are therefore single-connection databases.
    const maxConnections =
        isInMemory || config.syncUrl ? 1 : Math.max(1, config.concurrency);

    const options = {
        authToken: config.authToken,
        encryptionKey: config.encryptionKey,
        remoteEncryptionKey: config.remoteEncryptionKey,
        syncUrl: config.syncUrl,
        syncPeriod: config.syncInterval,
        readYourWrites: config.readYourWrites,
        offline: config.offline,
        timeout: config.timeout,
    };

    const pool = new ConnectionPool(path, options, maxConnections);

    // fail fast if the database cannot be opened at all
    const db = pool.acquireSync();
    try {
        executeStmt(
            db,
            "SELECT 1 AS checkThatTheDatabaseCanBeOpened",
            config.intMode,
        );
    } catch (e) {
        pool.close();
        throw e;
    }
    pool.release(db);

    return new Sqlite3Client(pool, config.intMode);
}

/**
 * A client owns a small pool of connections to one database, in the same way
 * that a remote client owns a set of hrana streams: every client operation
 * borrows one for the duration of the call, and a transaction borrows one for
 * its lifetime and gives it back on commit, rollback or close. Nothing is
 * shared between an open transaction and the rest of the client.
 *
 * @private
 */
export class ConnectionPool {
    #path: string;
    #options: Database.Options;
    #maxConnections: number;
    #idle: Array<Database.Database>;
    #borrowed: Set<Database.Database>;
    // the subset of `#borrowed` held by an open transaction
    #heldByTransaction: Set<Database.Database>;
    #waiters: Array<{
        resolve: (db: Database.Database) => void;
        reject: (e: unknown) => void;
    }>;
    #closed: boolean;

    constructor(
        path: string,
        options: Database.Options,
        maxConnections: number,
    ) {
        this.#path = path;
        this.#options = options;
        this.#maxConnections = maxConnections;
        this.#idle = [];
        this.#borrowed = new Set();
        this.#heldByTransaction = new Set();
        this.#waiters = [];
        this.#closed = false;
    }

    // Borrows a connection, opening one if the pool is below its limit and
    // waiting for a release if it is not.
    //
    // Every borrow but a transaction's is a short synchronous call that
    // returns the connection before the caller sees it again, so waiting for
    // one is safe. A transaction holds its connection until the caller commits
    // or rolls back, so if transactions hold every connection there is nothing
    // to wait for - the caller has to act first. Say so instead of hanging.
    acquire(forTransaction: boolean = false): Promise<Database.Database> {
        if (!this.#closed && this.#atLimit()) {
            if (this.#heldByTransaction.size >= this.#maxConnections) {
                return Promise.reject(
                    new LibsqlError(
                        this.#maxConnections === 1
                            ? "This client has a single connection, which an open transaction is holding. " +
                              "In-memory databases and embedded replicas cannot have more than one. " +
                              "Commit or roll back the transaction before using the client again."
                            : `All ${this.#maxConnections} of this client's connections are held by open transactions. ` +
                              "Commit or roll back one before using the client again, or raise `concurrency`.",
                        "TRANSACTION_ACTIVE",
                    ),
                );
            }
            return new Promise((resolve, reject) =>
                this.#waiters.push({
                    resolve: (db) => {
                        if (forTransaction) {
                            this.#heldByTransaction.add(db);
                        }
                        resolve(db);
                    },
                    reject,
                }),
            );
        }
        try {
            return Promise.resolve(this.acquireSync(forTransaction));
        } catch (e) {
            return Promise.reject(e);
        }
    }

    // Borrows a connection without waiting. Only valid when the pool cannot be
    // at its limit yet, which is why it is used for the initial probe.
    acquireSync(forTransaction: boolean = false): Database.Database {
        this.#checkNotClosed();
        const idle = this.#idle.pop();
        const db = idle ?? new Database(this.#path, this.#options);
        this.#borrowed.add(db);
        if (forTransaction) {
            this.#heldByTransaction.add(db);
        }
        return db;
    }

    // Returns a borrowed connection to the pool, handing it straight to a
    // waiter if there is one.
    release(db: Database.Database): void {
        this.#borrowed.delete(db);
        this.#heldByTransaction.delete(db);

        // A connection must never go back into the pool mid-transaction, or
        // the next borrower would silently inherit it.
        if (db.open && db.inTransaction) {
            try {
                db.prepare("ROLLBACK").run();
            } catch {
                // the connection is unusable; drop it rather than reuse it
                closeQuietly(db);
                return;
            }
        }

        if (this.#closed || !db.open) {
            closeQuietly(db);
            return;
        }

        const waiter = this.#waiters.shift();
        if (waiter !== undefined) {
            this.#borrowed.add(db);
            waiter.resolve(db);
        } else {
            this.#idle.push(db);
        }
    }

    close(): void {
        this.#closed = true;
        for (const db of this.#idle) {
            closeQuietly(db);
        }
        this.#idle = [];
        for (const db of this.#borrowed) {
            closeQuietly(db);
        }
        this.#borrowed.clear();
        this.#heldByTransaction.clear();

        // Anything still queued will never be served now. Reject it: dropping
        // the callbacks would leave those operations pending forever.
        const waiters = this.#waiters;
        this.#waiters = [];
        for (const waiter of waiters) {
            waiter.reject(
                new LibsqlError("The client is closed", "CLIENT_CLOSED"),
            );
        }
    }

    reopen(): void {
        this.close();
        this.#closed = false;
    }

    #atLimit(): boolean {
        return (
            this.#idle.length === 0 &&
            this.#borrowed.size >= this.#maxConnections
        );
    }

    #checkNotClosed(): void {
        if (this.#closed) {
            throw new LibsqlError("The client is closed", "CLIENT_CLOSED");
        }
    }
}

function closeQuietly(db: Database.Database): void {
    try {
        if (db.open) {
            db.close();
        }
    } catch {
        // nothing useful to do while tearing down
    }
}

export class Sqlite3Client implements Client {
    #pool: ConnectionPool;
    #intMode: IntMode;
    closed: boolean;
    protocol: "file";

    /** @private */
    constructor(pool: ConnectionPool, intMode: IntMode) {
        this.#pool = pool;
        this.#intMode = intMode;
        this.closed = false;
        this.protocol = "file";
    }

    async execute(
        stmtOrSql: InStatement | string,
        args?: InArgs,
    ): Promise<ResultSet> {
        let stmt: InStatement;

        if (typeof stmtOrSql === "string") {
            stmt = {
                sql: stmtOrSql,
                args: args || [],
            };
        } else {
            stmt = stmtOrSql;
        }

        this.#checkNotClosed();
        const db = await this.#pool.acquire();
        try {
            this.#checkUsable(db);
            return executeStmt(db, stmt, this.#intMode);
        } finally {
            this.#pool.release(db);
        }
    }

    async batch(
        stmts: Array<InStatement | [string, InArgs?]>,
        mode: TransactionMode = "deferred",
    ): Promise<Array<ResultSet>> {
        this.#checkNotClosed();
        const db = await this.#pool.acquire();
        try {
            this.#checkUsable(db);
            executeStmt(db, transactionModeToBegin(mode), this.#intMode);
            const resultSets = [];
            for (let i = 0; i < stmts.length; i++) {
                try {
                    if (!db.inTransaction) {
                        throw new LibsqlBatchError(
                            "The transaction has been rolled back",
                            i,
                            "TRANSACTION_CLOSED",
                        );
                    }
                    const stmt = stmts[i];
                    const normalizedStmt: InStatement = Array.isArray(stmt)
                        ? { sql: stmt[0], args: stmt[1] || [] }
                        : stmt;
                    resultSets.push(
                        executeStmt(db, normalizedStmt, this.#intMode),
                    );
                } catch (e) {
                    if (e instanceof LibsqlBatchError) {
                        throw e;
                    }
                    if (e instanceof LibsqlError) {
                        throw new LibsqlBatchError(
                            e.message,
                            i,
                            e.code,
                            e.extendedCode,
                            e.rawCode,
                            e.cause instanceof Error ? e.cause : undefined,
                        );
                    }
                    throw e;
                }
            }
            executeStmt(db, "COMMIT", this.#intMode);
            return resultSets;
        } finally {
            // `release` rolls back anything still open before reuse
            this.#pool.release(db);
        }
    }

    async migrate(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        this.#checkNotClosed();
        const db = await this.#pool.acquire();
        try {
            this.#checkUsable(db);
            executeStmt(db, "PRAGMA foreign_keys=off", this.#intMode);
            executeStmt(db, transactionModeToBegin("deferred"), this.#intMode);
            const resultSets = [];
            for (let i = 0; i < stmts.length; i++) {
                try {
                    if (!db.inTransaction) {
                        throw new LibsqlBatchError(
                            "The transaction has been rolled back",
                            i,
                            "TRANSACTION_CLOSED",
                        );
                    }
                    resultSets.push(executeStmt(db, stmts[i], this.#intMode));
                } catch (e) {
                    if (e instanceof LibsqlBatchError) {
                        throw e;
                    }
                    if (e instanceof LibsqlError) {
                        throw new LibsqlBatchError(
                            e.message,
                            i,
                            e.code,
                            e.extendedCode,
                            e.rawCode,
                            e.cause instanceof Error ? e.cause : undefined,
                        );
                    }
                    throw e;
                }
            }
            executeStmt(db, "COMMIT", this.#intMode);
            return resultSets;
        } finally {
            if (db.inTransaction) {
                executeStmt(db, "ROLLBACK", this.#intMode);
            }
            executeStmt(db, "PRAGMA foreign_keys=on", this.#intMode);
            this.#pool.release(db);
        }
    }

    async transaction(mode: TransactionMode = "write"): Promise<Transaction> {
        this.#checkNotClosed();
        const db = await this.#pool.acquire(true);
        try {
            this.#checkUsable(db);
            executeStmt(db, transactionModeToBegin(mode), this.#intMode);
        } catch (e) {
            this.#pool.release(db);
            throw e;
        }
        // The transaction owns this connection until it settles, exactly as an
        // `HttpTransaction` owns its stream.
        return new Sqlite3Transaction(db, this.#intMode, (used) =>
            this.#pool.release(used),
        );
    }

    async executeMultiple(sql: string): Promise<void> {
        this.#checkNotClosed();
        const db = await this.#pool.acquire();
        try {
            this.#checkUsable(db);
            return executeMultiple(db, sql);
        } finally {
            // `release` rolls back a transaction `sql` left open
            this.#pool.release(db);
        }
    }

    async sync(): Promise<Replicated> {
        this.#checkNotClosed();
        const db = await this.#pool.acquire();
        try {
            this.#checkUsable(db);
            const rep = await db.sync();
            return {
                frames_synced: rep.frames_synced,
                frame_no: rep.frame_no,
            } as Replicated;
        } finally {
            this.#pool.release(db);
        }
    }

    async reconnect(): Promise<void> {
        this.#pool.reopen();
        this.closed = false;
    }

    close(): void {
        this.closed = true;
        this.#pool.close();
    }

    #checkNotClosed(): void {
        if (this.closed) {
            throw new LibsqlError("The client is closed", "CLIENT_CLOSED");
        }
    }

    // `close()` and `reconnect()` are synchronous and can land between a
    // borrow and the work it was borrowed for, closing the connection under an
    // operation that is already holding one. Without this the operation
    // reaches libsql with a closed handle and fails with a raw TypeError.
    #checkUsable(db: Database.Database): void {
        this.#checkNotClosed();
        if (!db.open) {
            throw new LibsqlError(
                "The connection was closed while this operation was in flight",
                "CLIENT_CLOSED",
            );
        }
    }
}

export class Sqlite3Transaction implements Transaction {
    // null once the connection has been returned to the pool
    #database: Database.Database | null;
    #intMode: IntMode;
    #release: (db: Database.Database) => void;

    /** @private */
    constructor(
        database: Database.Database,
        intMode: IntMode,
        release: (db: Database.Database) => void,
    ) {
        this.#database = database;
        this.#intMode = intMode;
        this.#release = release;
    }

    // Returns the connection to the pool. Idempotent, so every exit path can
    // call it without checking whether another already did.
    #settle(): void {
        const db = this.#database;
        if (db === null) {
            return;
        }
        this.#database = null;
        this.#release(db);
    }

    #getDatabase(): Database.Database {
        this.#checkNotClosed();
        return this.#database!;
    }

    async execute(stmt: InStatement): Promise<ResultSet>;
    async execute(sql: string, args?: InArgs): Promise<ResultSet>;

    async execute(
        stmtOrSql: InStatement | string,
        args?: InArgs,
    ): Promise<ResultSet> {
        let stmt: InStatement;

        if (typeof stmtOrSql === "string") {
            stmt = {
                sql: stmtOrSql,
                args: args || [],
            };
        } else {
            stmt = stmtOrSql;
        }

        return executeStmt(this.#getDatabase(), stmt, this.#intMode);
    }

    async batch(
        stmts: Array<InStatement | [string, InArgs?]>,
    ): Promise<Array<ResultSet>> {
        const resultSets = [];
        for (let i = 0; i < stmts.length; i++) {
            try {
                const db = this.#getDatabase();
                const stmt = stmts[i];
                const normalizedStmt: InStatement = Array.isArray(stmt)
                    ? { sql: stmt[0], args: stmt[1] || [] }
                    : stmt;
                resultSets.push(executeStmt(db, normalizedStmt, this.#intMode));
            } catch (e) {
                if (e instanceof LibsqlBatchError) {
                    throw e;
                }
                if (e instanceof LibsqlError) {
                    throw new LibsqlBatchError(
                        e.message,
                        i,
                        e.code,
                        e.extendedCode,
                        e.rawCode,
                        e.cause instanceof Error ? e.cause : undefined,
                    );
                }
                throw e;
            }
        }
        return resultSets;
    }

    async executeMultiple(sql: string): Promise<void> {
        return executeMultiple(this.#getDatabase(), sql);
    }

    async rollback(): Promise<void> {
        const db = this.#database;
        if (db === null || !db.open) {
            this.#settle();
            return;
        }
        try {
            this.#checkNotClosed();
            executeStmt(db, "ROLLBACK", this.#intMode);
        } finally {
            this.#settle();
        }
    }

    async commit(): Promise<void> {
        try {
            executeStmt(this.#getDatabase(), "COMMIT", this.#intMode);
        } finally {
            this.#settle();
        }
    }

    close(): void {
        const db = this.#database;
        if (db === null) {
            return;
        }
        try {
            // `client.close()` may have closed this connection already, and
            // reading `inTransaction` on a closed database aborts the process.
            if (db.open && db.inTransaction) {
                executeStmt(db, "ROLLBACK", this.#intMode);
            }
        } finally {
            this.#settle();
        }
    }

    get closed(): boolean {
        const db = this.#database;
        if (db === null || !db.open) {
            return true;
        }
        return !db.inTransaction;
    }

    #checkNotClosed(): void {
        if (this.closed) {
            throw new LibsqlError(
                "The transaction is closed",
                "TRANSACTION_CLOSED",
            );
        }
    }
}

function executeStmt(
    db: Database.Database,
    stmt: InStatement,
    intMode: IntMode,
): ResultSet {
    let sql: string;
    let args: Array<unknown> | Record<string, unknown>;
    if (typeof stmt === "string") {
        sql = stmt;
        args = [];
    } else {
        sql = stmt.sql;
        if (Array.isArray(stmt.args)) {
            args = stmt.args.map((value) => valueToSql(value, intMode));
        } else {
            args = {};
            for (const name in stmt.args) {
                const argName =
                    name[0] === "@" || name[0] === "$" || name[0] === ":"
                        ? name.substring(1)
                        : name;
                args[argName] = valueToSql(stmt.args[name], intMode);
            }
        }
    }

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
            const columns = Array.from(
                sqlStmt.columns().map((col) => col.name),
            );
            const columnTypes = Array.from(
                sqlStmt.columns().map((col) => col.type ?? ""),
            );
            const rows = sqlStmt.all(args).map((sqlRow) => {
                return rowFromSql(sqlRow as Array<unknown>, columns, intMode);
            });
            // TODO: can we get this info from better-sqlite3?
            const rowsAffected = 0;
            const lastInsertRowid = undefined;
            return new ResultSetImpl(
                columns,
                columnTypes,
                rows,
                rowsAffected,
                lastInsertRowid,
            );
        } else {
            const info = sqlStmt.run(args);
            const rowsAffected = info.changes;
            const lastInsertRowid = BigInt(info.lastInsertRowid);
            return new ResultSetImpl([], [], [], rowsAffected, lastInsertRowid);
        }
    } catch (e) {
        throw mapSqliteError(e);
    }
}

function rowFromSql(
    sqlRow: Array<unknown>,
    columns: Array<string>,
    intMode: IntMode,
): Row {
    const row = {};
    // make sure that the "length" property is not enumerable
    Object.defineProperty(row, "length", { value: sqlRow.length });
    for (let i = 0; i < sqlRow.length; ++i) {
        const value = valueFromSql(sqlRow[i], intMode);
        Object.defineProperty(row, i, { value });

        const column = columns[i];
        if (!Object.hasOwn(row, column)) {
            Object.defineProperty(row, column, {
                value,
                enumerable: true,
                configurable: true,
                writable: true,
            });
        }
    }
    return row as Row;
}

function valueFromSql(sqlValue: unknown, intMode: IntMode): Value {
    if (typeof sqlValue === "bigint") {
        if (intMode === "number") {
            if (sqlValue < minSafeBigint || sqlValue > maxSafeBigint) {
                throw new RangeError(
                    "Received integer which cannot be safely represented as a JavaScript number",
                );
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
        return sqlValue.buffer;
    }
    return sqlValue as Value;
}

const minSafeBigint = -9007199254740991n;
const maxSafeBigint = 9007199254740991n;

function valueToSql(value: InValue, intMode: IntMode): unknown {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new RangeError(
                "Only finite numbers (not Infinity or NaN) can be passed as arguments",
            );
        }
        return value;
    } else if (typeof value === "bigint") {
        if (value < minInteger || value > maxInteger) {
            throw new RangeError(
                "bigint is too large to be represented as a 64-bit integer and passed as argument",
            );
        }
        return value;
    } else if (typeof value === "boolean") {
        switch (intMode) {
            case "bigint":
                return value ? 1n : 0n;
            case "string":
                return value ? "1" : "0";
            default:
                return value ? 1 : 0;
        }
    } else if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    } else if (value instanceof Date) {
        return value.valueOf();
    } else if (value === undefined) {
        throw new TypeError(
            "undefined cannot be passed as argument to the database",
        );
    } else {
        return value;
    }
}

const minInteger = -9223372036854775808n;
const maxInteger = 9223372036854775807n;

function executeMultiple(db: Database.Database, sql: string): void {
    try {
        db.exec(sql);
    } catch (e) {
        throw mapSqliteError(e);
    }
}

function mapSqliteError(e: unknown): unknown {
    if (e instanceof Database.SqliteError) {
        const extendedCode = e.code;
        const code = mapToBaseCode(e.rawCode);
        return new LibsqlError(e.message, code, extendedCode, e.rawCode, e);
    }
    return e;
}

// Map SQLite raw error code to base error code string.
// Extended error codes are (base | (extended << 8)), so base = rawCode & 0xFF
function mapToBaseCode(rawCode: number | undefined): string {
    if (rawCode === undefined) {
        return "SQLITE_UNKNOWN";
    }
    const baseCode = rawCode & 0xff;
    return (
        sqliteErrorCodes[baseCode] ?? `SQLITE_UNKNOWN_${baseCode.toString()}`
    );
}

const sqliteErrorCodes: Record<number, string> = {
    1: "SQLITE_ERROR",
    2: "SQLITE_INTERNAL",
    3: "SQLITE_PERM",
    4: "SQLITE_ABORT",
    5: "SQLITE_BUSY",
    6: "SQLITE_LOCKED",
    7: "SQLITE_NOMEM",
    8: "SQLITE_READONLY",
    9: "SQLITE_INTERRUPT",
    10: "SQLITE_IOERR",
    11: "SQLITE_CORRUPT",
    12: "SQLITE_NOTFOUND",
    13: "SQLITE_FULL",
    14: "SQLITE_CANTOPEN",
    15: "SQLITE_PROTOCOL",
    16: "SQLITE_EMPTY",
    17: "SQLITE_SCHEMA",
    18: "SQLITE_TOOBIG",
    19: "SQLITE_CONSTRAINT",
    20: "SQLITE_MISMATCH",
    21: "SQLITE_MISUSE",
    22: "SQLITE_NOLFS",
    23: "SQLITE_AUTH",
    24: "SQLITE_FORMAT",
    25: "SQLITE_RANGE",
    26: "SQLITE_NOTADB",
    27: "SQLITE_NOTICE",
    28: "SQLITE_WARNING",
};
