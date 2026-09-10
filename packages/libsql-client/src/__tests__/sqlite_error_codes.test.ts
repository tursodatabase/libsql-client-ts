import { expect } from "@jest/globals";

import { mapToBaseCode, mapToRawCode } from "../sqlite_error_codes.js";

describe("mapToBaseCode()", () => {
    test("maps a primary result code", () => {
        expect(mapToBaseCode(1)).toBe("SQLITE_ERROR");
        expect(mapToBaseCode(19)).toBe("SQLITE_CONSTRAINT");
    });

    test("strips the extended bits", () => {
        // SQLITE_CONSTRAINT_PRIMARYKEY = 19 | (6 << 8) = 1555
        expect(mapToBaseCode(1555)).toBe("SQLITE_CONSTRAINT");
    });

    test("falls back for unknown or missing codes", () => {
        expect(mapToBaseCode(undefined)).toBe("SQLITE_UNKNOWN");
        expect(mapToBaseCode(99)).toBe("SQLITE_UNKNOWN_99");
    });
});

describe("mapToRawCode()", () => {
    test("maps a base SQLITE_* code back to its number", () => {
        expect(mapToRawCode("SQLITE_ERROR")).toBe(1);
        expect(mapToRawCode("SQLITE_CONSTRAINT")).toBe(19);
        expect(mapToRawCode("SQLITE_BUSY")).toBe(5);
    });

    test("resolves an extended code to its base number", () => {
        expect(mapToRawCode("SQLITE_CONSTRAINT_PRIMARYKEY")).toBe(19);
        expect(mapToRawCode("SQLITE_CONSTRAINT_UNIQUE")).toBe(19);
        expect(mapToRawCode("SQLITE_IOERR_WRITE")).toBe(10);
    });

    test("returns undefined for non-SQLite and missing codes", () => {
        expect(mapToRawCode(undefined)).toBeUndefined();
        expect(mapToRawCode("HRANA_PROTO_ERROR")).toBeUndefined();
        expect(mapToRawCode("SERVER_ERROR")).toBeUndefined();
        expect(mapToRawCode("SQLITE_NOT_A_REAL_CODE")).toBeUndefined();
    });

    test("round-trips with mapToBaseCode", () => {
        for (const raw of [1, 5, 10, 19, 25, 28]) {
            expect(mapToRawCode(mapToBaseCode(raw))).toBe(raw);
        }
    });
});
