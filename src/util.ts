import { TransactionMode, InStatement, LibsqlError } from "./api.js";

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
