// SQLite primary result codes. See https://www.sqlite.org/rescode.html
// Extended codes are (base | (extended << 8)), so base = rawCode & 0xFF.
export const sqliteErrorCodes: Record<number, string> = {
    1: "SQLITE_ERROR",
    2: "SQLITE_INTERNAL",
    3: "SQLITE_PERM",
    4: "SQLITE_ABORT",
    5: "SQLITE_BUSY",
    6: "SQLITE_LOCKED",
    7: "SQLITE_NOMEM",
    8: "SQLITE_READONLY",
    9: "SQLITE_INTERRUPT",
    10: "SQLITE_IOERR",
    11: "SQLITE_CORRUPT",
    12: "SQLITE_NOTFOUND",
    13: "SQLITE_FULL",
    14: "SQLITE_CANTOPEN",
    15: "SQLITE_PROTOCOL",
    16: "SQLITE_EMPTY",
    17: "SQLITE_SCHEMA",
    18: "SQLITE_TOOBIG",
    19: "SQLITE_CONSTRAINT",
    20: "SQLITE_MISMATCH",
    21: "SQLITE_MISUSE",
    22: "SQLITE_NOLFS",
    23: "SQLITE_AUTH",
    24: "SQLITE_FORMAT",
    25: "SQLITE_RANGE",
    26: "SQLITE_NOTADB",
    27: "SQLITE_NOTICE",
    28: "SQLITE_WARNING",
};

const rawCodeByName: Record<string, number> = Object.fromEntries(
    Object.entries(sqliteErrorCodes).map(([raw, name]) => [name, Number(raw)]),
);

// Map a SQLite raw numeric error code to its base error code string.
export function mapToBaseCode(rawCode: number | undefined): string {
    if (rawCode === undefined) {
        return "SQLITE_UNKNOWN";
    }
    const baseCode = rawCode & 0xff;
    return (
        sqliteErrorCodes[baseCode] ?? `SQLITE_UNKNOWN_${baseCode.toString()}`
    );
}

// Map a SQLite error code string back to its base raw numeric code. Accepts
// extended names (e.g. "SQLITE_CONSTRAINT_PRIMARYKEY") and resolves them to the
// base code (19). Returns undefined for anything not recognised, including the
// client's own non-SQLite codes (e.g. "HRANA_PROTO_ERROR").
export function mapToRawCode(code: string | undefined): number | undefined {
    if (code === undefined) {
        return undefined;
    }
    let name = code;
    while (name.length > "SQLITE_".length) {
        const rawCode = rawCodeByName[name];
        if (rawCode !== undefined) {
            return rawCode;
        }
        const lastUnderscore = name.lastIndexOf("_");
        if (lastUnderscore <= "SQLITE".length) {
            break;
        }
        name = name.slice(0, lastUnderscore);
    }
    return undefined;
}
