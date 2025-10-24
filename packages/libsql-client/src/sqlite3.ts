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
import { LibsqlError } from "@libsql/core/api";
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

    const options = {
        authToken: config.authToken,
        encryptionKey: config.encryptionKey,
        syncUrl: config.syncUrl,
        syncPeriod: config.syncInterval,
        readYourWrites: config.readYourWrites,
        offline: config.offline,
    };

    const db = new Database(path, options);

    executeStmt(
        db,
        "SELECT 1 AS checkThatTheDatabaseCanBeOpened",
        config.intMode,
    );

    return new Sqlite3Client(path, options, db, config.intMode, config.attach);
}

export class Sqlite3Client implements Client {
    #path: string;
    #options: Database.Options;
    #db: Database.Database | null;
    #intMode: IntMode;
    #attachConfig: import("@libsql/core/api").AttachConfig[];
    closed: boolean;
    protocol: "file";

    /** @private */
    constructor(
        path: string,
        options: Database.Options,
        db: Database.Database,
        intMode: IntMode,
        attachConfig?: import("@libsql/core/api").AttachConfig[],
    ) {
        this.#path = path;
        this.#options = options;
        this.#db = db;
        this.#intMode = intMode;
        this.#attachConfig = attachConfig || [];
        this.closed = false;
        this.protocol = "file";

        // Apply initial attachments to the initial connection
        this.#applyAttachments(db);
    }

    /**
     * Apply configured ATTACH statements to a database connection.
     * Called on initial connection and after connection recycling.
     */
    #applyAttachments(db: Database.Database): void {
        for (const { alias, path } of this.#attachConfig) {
            try {
                // Use native prepare/run to avoid recursion through execute()
                const attachSql = `ATTACH DATABASE '${path}' AS ${alias}`;
                const stmt = db.prepare(attachSql);
                stmt.run();
            } catch (err) {
                // Log but don't throw - attached database might not exist yet
                // This allows graceful degradation during setup
                console.warn(
                    `Failed to attach database '${alias}' from '${path}': ${err}`,
                );
            }
        }
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
        return executeStmt(this.#getDb(), stmt, this.#intMode);
    }

    async batch(
        stmts: Array<InStatement | [string, InArgs?]>,
        mode: TransactionMode = "deferred",
    ): Promise<Array<ResultSet>> {
        this.#checkNotClosed();
        const db = this.#getDb();
        try {
            executeStmt(db, transactionModeToBegin(mode), this.#intMode);
            const resultSets = stmts.map((stmt) => {
                if (!db.inTransaction) {
                    throw new LibsqlError(
                        "The transaction has been rolled back",
                        "TRANSACTION_CLOSED",
                    );
                }
                const normalizedStmt: InStatement = Array.isArray(stmt)
                    ? { sql: stmt[0], args: stmt[1] || [] }
                    : stmt;
                return executeStmt(db, normalizedStmt, this.#intMode);
            });
            executeStmt(db, "COMMIT", this.#intMode);
            return resultSets;
        } finally {
            if (db.inTransaction) {
                executeStmt(db, "ROLLBACK", this.#intMode);
            }
        }
    }

    async migrate(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
        this.#checkNotClosed();
        const db = this.#getDb();
        try {
            executeStmt(db, "PRAGMA foreign_keys=off", this.#intMode);
            executeStmt(db, transactionModeToBegin("deferred"), this.#intMode);
            const resultSets = stmts.map((stmt) => {
                if (!db.inTransaction) {
                    throw new LibsqlError(
                        "The transaction has been rolled back",
                        "TRANSACTION_CLOSED",
                    );
                }
                return executeStmt(db, stmt, this.#intMode);
            });
            executeStmt(db, "COMMIT", this.#intMode);
            return resultSets;
        } finally {
            if (db.inTransaction) {
                executeStmt(db, "ROLLBACK", this.#intMode);
            }
            executeStmt(db, "PRAGMA foreign_keys=on", this.#intMode);
        }
    }

    async transaction(mode: TransactionMode = "write"): Promise<Transaction> {
        const db = this.#getDb();
        executeStmt(db, transactionModeToBegin(mode), this.#intMode);
        this.#db = null; // A new connection will be lazily created on next use
        return new Sqlite3Transaction(db, this.#intMode);
    }

    async executeMultiple(sql: string): Promise<void> {
        this.#checkNotClosed();
        const db = this.#getDb();
        try {
            return executeMultiple(db, sql);
        } finally {
            if (db.inTransaction) {
                executeStmt(db, "ROLLBACK", this.#intMode);
            }
        }
    }

    async sync(): Promise<Replicated> {
        this.#checkNotClosed();
        const rep = await this.#getDb().sync();
        return {
            frames_synced: rep.frames_synced,
            frame_no: rep.frame_no,
        } as Replicated;
    }

    async reconnect(): Promise<void> {
        try {
            if (!this.closed && this.#db !== null) {
                this.#db.close();
            }
        } finally {
            this.#db = new Database(this.#path, this.#options);
            this.closed = false;

            // Re-apply attachments after reconnect
            this.#applyAttachments(this.#db);
        }
    }

    /**
     * Attach a database at runtime.
     *
     * The attachment persists across connection recycling (e.g., after transaction()).
     * Use this for databases that don't exist at client creation time.
     *
     * @param alias - Schema prefix for queries (e.g., 'obs' → 'obs.table_name')
     * @param path - Database path, supports file: URI with ?mode=ro
     *
     * @throws LibsqlError if alias is already attached or attachment fails
     *
     * @example
     * ```typescript
     * // Attach when database becomes available
     * await client.attach('obs', 'file:observability.db?mode=ro');
     *
     * // Query attached database
     * await client.execute('SELECT * FROM obs.mastra_traces');
     *
     * // Attachment persists after transaction
     * const tx = await client.transaction();
     * await tx.commit();
     * await client.execute('SELECT * FROM obs.mastra_traces');  // Still works ✅
     * ```
     */
    async attach(alias: string, path: string): Promise<void> {
        this.#checkNotClosed();

        // Check for duplicate alias
        if (this.#attachConfig.some((a) => a.alias === alias)) {
            throw new LibsqlError(
                `Database with alias '${alias}' is already attached`,
                "ATTACH_DUPLICATE",
            );
        }

        // Add to persistent config (will survive transaction())
        this.#attachConfig.push({ alias, path });

        // Apply to current connection
        const db = this.#getDb();
        try {
            const attachSql = `ATTACH DATABASE '${path}' AS ${alias}`;
            const stmt = db.prepare(attachSql);
            stmt.run();
        } catch (err) {
            // Rollback config change on failure
            this.#attachConfig = this.#attachConfig.filter(
                (a) => a.alias !== alias,
            );
            throw new LibsqlError(
                `Failed to attach database '${alias}' from '${path}': ${(err as Error).message}`,
                "ATTACH_FAILED",
                undefined,
                err as Error,
            );
        }
    }

    /**
     * Detach a previously attached database.
     *
     * The detachment persists across connection recycling. The database
     * will not be re-attached on subsequent connections.
     *
     * @param alias - Schema alias to detach
     *
     * @example
     * ```typescript
     * await client.detach('obs');
     *
     * // After detach, queries fail
     * await client.execute('SELECT * FROM obs.traces');  // Error: no such table
     * ```
     */
    async detach(alias: string): Promise<void> {
        this.#checkNotClosed();

        // Remove from persistent config (won't re-attach on reconnection)
        this.#attachConfig = this.#attachConfig.filter(
            (a) => a.alias !== alias,
        );

        // Detach from current connection
        const db = this.#getDb();
        try {
            const detachSql = `DETACH DATABASE ${alias}`;
            const stmt = db.prepare(detachSql);
            stmt.run();
        } catch (err) {
            // Ignore errors (already detached is fine)
            console.warn(`Failed to detach database '${alias}': ${err}`);
        }
    }

    close(): void {
        this.closed = true;
        if (this.#db !== null) {
            this.#db.close();
            this.#db = null;
        }
    }

    #checkNotClosed(): void {
        if (this.closed) {
            throw new LibsqlError("The client is closed", "CLIENT_CLOSED");
        }
    }

    // Lazily creates the database connection and returns it
    #getDb(): Database.Database {
        if (this.#db === null) {
            this.#db = new Database(this.#path, this.#options);

            // Re-apply all attachments (config + explicit) to new connection
            this.#applyAttachments(this.#db);
        }
        return this.#db;
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

        this.#checkNotClosed();
        return executeStmt(this.#database, stmt, this.#intMode);
    }

    async batch(
        stmts: Array<InStatement | [string, InArgs?]>,
    ): Promise<Array<ResultSet>> {
        return stmts.map((stmt) => {
            this.#checkNotClosed();
            const normalizedStmt: InStatement = Array.isArray(stmt)
                ? { sql: stmt[0], args: stmt[1] || [] }
                : stmt;
            return executeStmt(this.#database, normalizedStmt, this.#intMode);
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
    }

    async commit(): Promise<void> {
        this.#checkNotClosed();
        executeStmt(this.#database, "COMMIT", this.#intMode);
    }

    close(): void {
        if (this.#database.inTransaction) {
            executeStmt(this.#database, "ROLLBACK", this.#intMode);
        }
    }

    get closed(): boolean {
        return !this.#database.inTransaction;
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
        return new LibsqlError(e.message, e.code, e.rawCode, e);
    }
    return e;
}
