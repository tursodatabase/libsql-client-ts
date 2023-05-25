export interface Config {
    url: string;
    authToken?: string;
    tls?: boolean;
}

export interface Client {
    execute(stmt: InStatement): Promise<ResultSet>;
    batch(stmts: Array<InStatement>): Promise<Array<ResultSet>>;
    transaction(): Promise<Transaction>;
    close(): void;
    closed: boolean;
}

export interface Transaction {
    execute(stmt: InStatement): Promise<ResultSet>;
    rollback(): Promise<void>;
    commit(): Promise<void>;
    close(): void;
    closed: boolean;
}

export interface ResultSet {
    columns: Array<string>;
    rows: Array<Row>;
    rowsAffected: number;
    lastInsertRowid: bigint | undefined;
}

export interface Row {
    length: number;
    [index: number]: Value;
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

export class LibsqlError extends Error {
    code: ErrorCode;
    
    constructor(message: string, code: ErrorCode, cause?: Error) {
        if (code !== undefined) {
            message = `${code}: ${message}`;
        }
        super(message, { cause });
        this.code = code;
        this.name = "LibsqlError";
    }
}

export type ErrorCode = string;
