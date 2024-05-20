import type * as hrana from "@libsql/hrana-client";

export class SqlCache {
    #owner: hrana.SqlOwner;
    #sqls: Lru<string, hrana.Sql>;
    capacity: number;

    constructor(owner: hrana.SqlOwner, capacity: number) {
        this.#owner = owner;
        this.#sqls = new Lru();
        this.capacity = capacity;
    }

    // Replaces SQL strings with cached `hrana.Sql` objects in the statements in `hranaStmts`. After this
    // function returns, we guarantee that all `hranaStmts` refer to valid (not closed) `hrana.Sql` objects,
    // but _we may invalidate any other `hrana.Sql` objects_ (by closing them, thus removing them from the
    // server).
    //
    // In practice, this means that after calling this function, you can use the statements only up to the
    // first `await`, because concurrent code may also use the cache and invalidate those statements.
    apply(hranaStmts: Array<hrana.Stmt>): void {
        if (this.capacity <= 0) {
            return;
        }

        const usedSqlObjs: Set<hrana.Sql> = new Set();

        for (const hranaStmt of hranaStmts) {
            if (typeof hranaStmt.sql !== "string") {
                continue;
            }
            const sqlText = hranaStmt.sql;

            let sqlObj = this.#sqls.get(sqlText);
            if (sqlObj === undefined) {
                while (this.#sqls.size + 1 > this.capacity) {
                    const [evictSqlText, evictSqlObj] = this.#sqls.peekLru()!;
                    if (usedSqlObjs.has(evictSqlObj)) {
                        // The SQL object that we are trying to evict is already in use in this batch, so we
                        // must not evict and close it.
                        break;
                    }
                    evictSqlObj.close();
                    this.#sqls.delete(evictSqlText);
                }

                if (this.#sqls.size + 1 <= this.capacity) {
                    sqlObj = this.#owner.storeSql(sqlText);
                    this.#sqls.set(sqlText, sqlObj);
                }
            }

            if (sqlObj !== undefined) {
                hranaStmt.sql = sqlObj;
                usedSqlObjs.add(sqlObj);
            }
        }
    }
}

class Lru<K, V> {
    // This maps keys to the cache values. The entries are ordered by their last use (entires that were used
    // most recently are at the end).
    #cache: Map<K, V>;

    constructor() {
        this.#cache = new Map();
    }

    get(key: K): V | undefined {
        const value = this.#cache.get(key);
        if (value !== undefined) {
            // move the entry to the back of the Map
            this.#cache.delete(key);
            this.#cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        this.#cache.set(key, value);
    }

    peekLru(): [K, V] | undefined {
        for (const entry of this.#cache.entries()) {
            return entry;
        }
        return undefined;
    }

    delete(key: K): void {
        this.#cache.delete(key);
    }

    get size(): number {
        return this.#cache.size;
    }
}
