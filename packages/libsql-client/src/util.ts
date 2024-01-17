import { Base64 } from "js-base64";
import { ResultSet, Row, Value, TransactionMode, InStatement, LibsqlError } from "./api.js";

export const supportedUrlLink = "https://github.com/libsql/libsql-client-ts#supported-urls";

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
    columnTypes: Array<string>;
    rows: Array<Row>;
    rowsAffected: number;
    lastInsertRowid: bigint | undefined;

    constructor(
        columns: Array<string>,
        columnTypes: Array<string>,
        rows: Array<Row>,
        rowsAffected: number,
        lastInsertRowid: bigint | undefined,
    ) {
        this.columns = columns;
        this.columnTypes = columnTypes;
        this.rows = rows;
        this.rowsAffected = rowsAffected;
        this.lastInsertRowid = lastInsertRowid;
    }

    toJSON(): any {
        return {
            "columns": this.columns,
            "columnTypes": this.columnTypes,
            "rows": this.rows.map(rowToJson),
            "rowsAffected": this.rowsAffected,
            "lastInsertRowid": this.lastInsertRowid !== undefined ? ""+this.lastInsertRowid : null,
        };
    }
}

function rowToJson(row: Row): unknown {
    return Array.prototype.map.call(row, valueToJson);
}

function valueToJson(value: Value): unknown {
    if (typeof value === "bigint") {
        return ""+value;
    } else if (value instanceof ArrayBuffer) {
        return Base64.fromUint8Array(new Uint8Array(value));
    } else {
        return value;
    }
}
