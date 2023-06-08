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

export type BatchArgs = {
    mode: TransactionMode,
    stmts: Array<InStatement>,
};

export function extractBatchArgs(arg1: unknown, arg2: unknown): BatchArgs {
    if (arg2 === undefined) {
        return {
            mode: "write",
            stmts: arg1 as Array<InStatement>,
        };
    } else {
        return {
            mode: arg1 as TransactionMode,
            stmts: arg2 as Array<InStatement>,
        };
    }
}
