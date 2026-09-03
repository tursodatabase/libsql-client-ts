import { expect } from "@jest/globals";
import type { Sql, SqlOwner } from "@libsql/hrana-client";
import { Stmt } from "@libsql/hrana-client";

import { SqlCache } from "../sql_cache.js";

class FakeSqlOwner implements SqlOwner {
    readonly stored: string[] = [];

    storeSql(sql: string): Sql {
        this.stored.push(sql);
        return { _sqlId: this.stored.length } as unknown as Sql;
    }

    _closeSql(_sqlId: number): void {}
}

function stmt(sql: string): Stmt {
    return new Stmt(sql);
}

describe("SqlCache.apply() stored-SQL size limit", () => {
    test("caches a small statement", () => {
        const owner = new FakeSqlOwner();
        const cache = new SqlCache(owner, 100);
        const s = stmt("SELECT 1");

        cache.apply([s]);

        expect(owner.stored).toEqual(["SELECT 1"]);
        expect(typeof s.sql).not.toBe("string");
    });

    test("does not cache a statement that reaches the 5kb cap in UTF-8 bytes while staying under it in UTF-16 code units", () => {
        const owner = new FakeSqlOwner();
        const cache = new SqlCache(owner, 100);
        // "借" is 1 UTF-16 code unit but 3 UTF-8 bytes: under the cap by length, over it by bytes.
        const sql = `SELECT '${"借".repeat(2000)}'`;
        expect(sql.length).toBeLessThan(5000);
        expect(new TextEncoder().encode(sql).length).toBeGreaterThanOrEqual(
            5000,
        );
        const s = stmt(sql);

        cache.apply([s]);

        expect(owner.stored).toEqual([]);
        expect(s.sql).toBe(sql);
    });

    test("does not cache a statement over the cap in UTF-16 code units", () => {
        const owner = new FakeSqlOwner();
        const cache = new SqlCache(owner, 100);
        const sql = "x".repeat(5000);
        const s = stmt(sql);

        cache.apply([s]);

        expect(owner.stored).toEqual([]);
        expect(s.sql).toBe(sql);
    });
});
