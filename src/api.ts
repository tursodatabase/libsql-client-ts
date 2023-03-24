export interface Config {
    url: string | URL;
    authToken?: string;
    transactions?: boolean;
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
    | ArrayBuffer

export type InValue =
    | Value
    | bigint
    | boolean
    | Uint8Array
    | Date

export type InStatement = { sql: string, args: InArgs } | string;
export type InArgs = Array<InValue> | Record<string, InValue>;

export class LibsqlError extends Error {
    code: ErrorCode | undefined;
    
    constructor(message: string, code: ErrorCode | undefined, cause?: Error) {
        if (code !== undefined) {
            message = `${code}: ${message}`;
        }
        super(message, { cause });
        this.code = code;
    }
}

export type ErrorCode =
    | "NOT_IMPLEMENTED"
    | "URL_SCHEME_NOT_SUPPORTED"
    | "URL_PARAM_NOT_SUPPORTED"
    | "URL_PARAM_INVALID_VALUE"
    | "SERVER_ERROR"
    | "TRANSACTION_CLOSED"
    | "CLIENT_CLOSED"
    | "TRANSACTIONS_DISABLED"
    | "TRANSACTIONS_NOT_SUPPORTED"
    | string;
