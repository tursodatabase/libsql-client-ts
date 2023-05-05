export class Lru<K, V> {
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

    deleteLru(): V | undefined {
        for (const [key, value] of this.#cache.entries()) {
            this.#cache.delete(key);
            return value;
        }
        return undefined;
    }

    clear(): void {
        this.#cache.clear();
    }

    get size(): number {
        return this.#cache.size;
    }
}
