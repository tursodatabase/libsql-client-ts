import { Base64 } from "js-base64";
import { ResultSet, Row, Value, TransactionMode, LibsqlError, type InStatement, type InValue } from "./api.js";
import type { ExpandedConfig } from "./config.js";

export const supportedUrlLink = "https://github.com/libsql/libsql-client-ts#supported-urls";

type TransformFunction = (v: InValue) => any;
type ParseStatementReturn<T extends TransformFunction> =
    | {
          sql: string;
          args: [];
      }
    | {
          sql: string;
          args: ReturnType<T>[] | { [k: string]: ReturnType<T> };
      };

export const parseStatement = <T extends TransformFunction>(
    stmt: InStatement,
    transformValues: T,
    transformKeys = (v: string) => v
): ParseStatementReturn<T> =>
    typeof stmt === "string"
        ? { sql: stmt, args: [] }
        : {
              sql: stmt.sql,
              args: Array.isArray(stmt.args)
                  ? stmt.args.map(transformValues)
                  : Object.fromEntries(Object.entries(stmt.args).map(([k, v]) => [transformKeys(k), transformValues(v)])),
          };

export function validateFileConfig(config: ExpandedConfig) {
    if (config.scheme !== "file") {
        throw new LibsqlError(
            `URL scheme ${JSON.stringify(config.scheme + ":")} is not supported by the local sqlite3 client. ` +
                `For more information, please read ${supportedUrlLink}`,
            "URL_SCHEME_NOT_SUPPORTED"
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
                "URL_INVALID"
            );
        }

        if (authority.port !== undefined) {
            throw new LibsqlError("File URL cannot have a port", "URL_INVALID");
        }
        if (authority.userinfo !== undefined) {
            throw new LibsqlError("File URL cannot have username and password", "URL_INVALID");
        }
    }
}
export function transactionModeToBegin(mode: TransactionMode): string {
    if (mode === "write") {
        return "BEGIN IMMEDIATE";
    } else if (mode === "read") {
        return "BEGIN TRANSACTION READONLY";
    } else if (mode === "deferred") {
        return "BEGIN DEFERRED";
    } else {
        throw RangeError('Unknown transaction mode, supported values are "write", "read" and "deferred"');
    }
}

export class ResultSetImpl implements ResultSet {
    columns: Array<string>;
    rows: Array<Row>;
    rowsAffected: number;
    lastInsertRowid: bigint | undefined;

    constructor(columns: Array<string>, rows: Array<Row>, rowsAffected: number, lastInsertRowid: bigint | undefined) {
        this.columns = columns;
        this.rows = rows;
        this.rowsAffected = rowsAffected;
        this.lastInsertRowid = lastInsertRowid;
    }

    toJSON(): any {
        return {
            columns: this.columns,
            rows: this.rows.map(rowToJson),
            rowsAffected: this.rowsAffected,
            lastInsertRowid: this.lastInsertRowid !== undefined ? "" + this.lastInsertRowid : null,
        };
    }
}

function rowToJson(row: Row): unknown {
    return Array.prototype.map.call(row, valueToJson);
}

function valueToJson(value: Value): unknown {
    if (typeof value === "bigint") {
        return "" + value;
    } else if (value instanceof ArrayBuffer) {
        return Base64.fromUint8Array(new Uint8Array(value));
    } else {
        return value;
    }
}
