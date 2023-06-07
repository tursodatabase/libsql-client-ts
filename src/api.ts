/** Configuration object for {@link createClient}. */
export interface Config {
    /** The database URL.
     *
     * The client supports `libsql:`, `http:`/`https:`, `ws:`/`wss:` and `file:` URL. For more infomation,
     * please refer to the project README:
     *
     * https://github.com/libsql/libsql-client-ts#supported-urls
     */
    url: string;

    /** Authentication token for the database. */
    authToken?: string;

    /** Enables or disables TLS for `libsql:` URLs.
     *
     * By default, `libsql:` URLs use TLS. You can set this option to `false` to disable TLS.
     */
    tls?: boolean;
}

/** Client object for a remote or local database.
 *
 * After you are done with the client, you **should** close it by calling {@link close}.
 */
export interface Client {
    /** Execute a single SQL statement.
     *
     * Every statement executed with this method is executed in its own logical database connection. If you
     * want to execute a group of statements in a transaction, use the {@link batch} or the {@link
     * transaction} methods.
     *
     * ```javascript
     * // execute a statement without arguments
     * const rs = await client.execute("SELECT * FROM books");
     *
     * // execute a statement with positional arguments
     * const rs = await client.execute({
     *     sql: "SELECT * FROM books WHERE author = ?",
     *     args: ["Jane Austen"],
     * });
     *
     * // execute a statement with named arguments
     * const rs = await client.execute({
     *     sql: "SELECT * FROM books WHERE published_at > $year",
     *     args: {year: 1719},
     * });
     * ```
     */
    execute(stmt: InStatement): Promise<ResultSet>;

    /** Execute a batch of SQL statements in a transaction.
     *
     * The batch is executed in its own logical database connection and the statements are wrapped in a
     * transaction. This ensures that the batch is applied atomically: either all or no changes are applied.
     * 
     * If any of the statements in the batch fails with an error, the batch is aborted, the transaction is
     * rolled back and the returned promise is rejected.
     *
     * This method provides non-interactive transactions. If you need interactive transactions, please use the
     * {@link transaction} method.
     *
     * ```javascript
     * const rss = await client.batch([
     *     // batch statement without arguments
     *     "DELETE FROM books WHERE name LIKE '%Crusoe'",
     *
     *     // batch statement with positional arguments
     *     {
     *         sql: "INSERT INTO books (name, author, published_at) VALUES (?, ?, ?)",
     *         args: ["First Impressions", "Jane Austen", 1813],
     *     },
     *
     *     // batch statement with named arguments
     *     {
     *         sql: "UPDATE books SET name = $new WHERE name = $old",
     *         args: {old: "First Impressions", new: "Pride and Prejudice"},
     *     },
     * ]);
     * ```
     */
    batch(stmts: Array<InStatement>): Promise<Array<ResultSet>>;

    /** Starts an interactive transaction.
     *
     * Interactive transactions allow you to interleave execution of SQL statements with your application
     * logic. They can be used if the {@link batch} method is too restrictive, but please note that
     * interactive transactions have higher latency.
     *
     * You **must** make sure that the returned {@link Transaction} object is closed, by calling {@link
     * Transaction.close}, {@link Transaction.commit} or {@link Transaction.rollback}. The best practice is
     * to call {@link Transaction.close} in a `finally` block, as follows:
     *
     * ```javascript
     * const transaction = client.transaction();
     * try {
     *     // do some operations with the transaction here
     *     ...
     *
     *     // if all went well, commit the transaction
     *     await transaction.commit();
     * } finally {
     *     // make sure to close the transaction, even if an exception was thrown
     *     transaction.close();
     * }
     * ```
     */
    transaction(): Promise<Transaction>;

    /** Close the client and release resources.
     *
     * This method closes the client (aborting any operations that are currently in progress) and releases any
     * resources associated with the client (such as a WebSocket connection).
     */
    close(): void;

    /** Is the client closed?
     *
     * This is set to `true` after a call to {@link close} or if the client encounters an unrecoverable
     * error.
     */
    closed: boolean;
}

/** Interactive transaction.
 *
 * A transaction groups multiple SQL statements together, so that they are applied atomically: either all
 * changes are applied, or none are. Other SQL statements on the database (including statements executed on
 * the same {@link Client} object outside of this transaction) will not see any changes from the transaction
 * until the transaction is committed by calling {@link commit}. You can also use {@link rollback} to abort
 * the transaction and roll back the changes.
 *
 * You **must** make sure that the {@link Transaction} object is closed, by calling {@link close}, {@link
 * commit} or {@link rollback}. The best practice is to call {@link close} in a `finally` block, as follows:
 *
 * ```javascript
 * const transaction = client.transaction();
 * try {
 *     // do some operations with the transaction here
 *     ...
 *
 *     // if all went well, commit the transaction
 *     await transaction.commit();
 * } finally {
 *     // make sure to close the transaction, even if an exception was thrown
 *     transaction.close();
 * }
 * ```
 */
export interface Transaction {
    /** Executes an SQL statement in the transaction.
     *
     * If the statement makes any changes to the database, these changes won't be visible to statements
     * outside of this transaction until you call {@link rollback}.
     */
    execute(stmt: InStatement): Promise<ResultSet>;

    /** Rolls back any changes from this transaction.
     *
     * This method closes the transaction and undoes any changes done by the previous SQL statements on this
     * transaction. You cannot call this method after calling {@link commit}, though.
     */
    rollback(): Promise<void>;

    /** Commits changes from this transaction to the database.
     *
     * This method closes the transaction and applies all changes done by the previous SQL statement on this
     * transaction. Once the returned promise is resolved successfully, the database guarantees that the
     * changes were applied.
     */
    commit(): Promise<void>;

    /** Closes the transaction.
     *
     * This method closes the transaction and releases any resources associated with the transaction. If the
     * transaction is already closed (perhaps by a previous call to {@link commit} or {@link rollback}), then
     * this method does nothing.
     *
     * If the transaction wasn't already committed by calling {@link commit}, the transaction is rolled
     * back.
     */
    close(): void;

    /** Is the transaction closed?
     *
     * This is set to `true` after a call to {@link close}, {@link commit} or {@link rollback}, or if we
     * encounter an unrecoverable error.
     */
    closed: boolean;
}

/** Result of executing an SQL statement.
 *
 * ```javascript
 * const rs = await client.execute("SELECT name, title FROM books");
 * console.log(`Found ${rs.rows.length} books`);
 * for (const row in rs.rows) {
 *     console.log(`Book ${row[0]} by ${row[1]}`);
 * }
 *
 * const rs = await client.execute("DELETE FROM books WHERE author = 'Jane Austen'");
 * console.log(`Deleted ${rs.rowsAffected} books`);
 * ```
 */
export interface ResultSet {
    /** Names of columns.
     *
     * Names of columns can be defined using the `AS` keyword in SQL:
     *
     * ```sql
     * SELECT author AS author, COUNT(*) AS count FROM books GROUP BY author
     * ```
     */
    columns: Array<string>;

    /** Rows produced by the statement. */
    rows: Array<Row>;

    /** Number of rows that were affected by an UPDATE, INSERT or DELETE operation.
     *
     * This value is not specified for other SQL statements.
     */
    rowsAffected: number;

    /** ROWID of the last inserted row.
     *
     * This value is not specified if the SQL statement was not an INSERT or if the table was not a ROWID
     * table.
     */
    lastInsertRowid: bigint | undefined;
}

/** Row returned from an SQL statement.
 *
 * The row object can be used as an `Array` or as an object:
 *
 * ```javascript
 * const rs = await client.execute("SELECT name, title FROM books");
 * for (const row in rs.rows) {
 *     // Get the value from column `name`
 *     console.log(row.name);
 *     // Get the value from second column (`title`)
 *     console.log(row[1]);
 * }
 * ```
 */
export interface Row {
    /** Number of columns in this row.
     *
     * All rows in one {@link ResultSet} have the same number and names of columns.
     */
    length: number;

    /** Columns can be accessed like an array by numeric indexes. */
    [index: number]: Value;

    /** Columns can be accessed like an object by column names. */
    [name: string]: Value;
}

export type Value =
    | null
    | string
    | number
    | bigint
    | ArrayBuffer

export type InValue =
    | Value
    | boolean
    | Uint8Array
    | Date

export type InStatement = { sql: string, args: InArgs } | string;
export type InArgs = Array<InValue> | Record<string, InValue>;

/** Error thrown by the client. */
export class LibsqlError extends Error {
    /** Machine-readable error code. */
    code: string;
    
    constructor(message: string, code: string, cause?: Error) {
        if (code !== undefined) {
            message = `${code}: ${message}`;
        }
        super(message, { cause });
        this.code = code;
        this.name = "LibsqlError";
    }
}
