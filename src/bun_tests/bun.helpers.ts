import { expect } from "bun:test";

import { LibsqlError } from "../bun";

export const withPattern = (...patterns: Array<string | RegExp>) =>
    new RegExp(
        patterns
            .map((pattern) =>
                typeof pattern === "string"
                    ? `(?=.*${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`
                    : `(?=.*${pattern.source})`
            )
            .join("")
    );

export const expectLibSqlError = async (f: () => any, pattern?: string | RegExp) => {
    try {
        await f();
    } catch (e: any) {
        expect(e).toBeInstanceOf(LibsqlError);
        expect(e.code.length).toBeGreaterThan(0);
        if (pattern !== undefined) {
            expect(e.message).toMatch(pattern);
        }
    }
};

export const expectBunSqliteError = async (f: () => any, pattern?: string | RegExp) => {
    try {
        await f();
    } catch (e: any) {
        expect(e).toBeInstanceOf(LibsqlError);
        expect(e.code.length).toBeGreaterThan(0);
        if (pattern !== undefined) {
            expect(e.message).toMatch(withPattern("BUN_SQLITE ERROR", pattern));
        }
    }
};
