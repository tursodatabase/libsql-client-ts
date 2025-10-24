/**
 * Test suite for config-based ATTACH DATABASE API + explicit methods
 *
 * Validates that databases attached via config.attach and client.attach()
 * persist across connection recycling (e.g., after transaction()).
 *
 * @see https://github.com/tursodatabase/libsql-client-ts/issues/XXX
 */

import { expect } from "@jest/globals";
import { createClient } from "../sqlite3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Test context
let tmpDir: string;

function getTempDbPath(name: string): string {
    return path.join(tmpDir, name);
}

beforeAll(() => {
    tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "libsql-attach-config-test-"),
    );
});

afterAll(() => {
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ============================================================================
// Config-Based Attachment Tests
// ============================================================================

/**
 * Test 1: Basic Config-Based ATTACH
 */
test("Config-based ATTACH works on client creation", async () => {
    const mainPath = getTempDbPath("test-config-main.db");
    const attachedPath = getTempDbPath("test-config-attached.db");

    // Setup: Create attached database
    const attachedClient = createClient({ url: `file:${attachedPath}` });
    await attachedClient.execute(
        "CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT)",
    );
    await attachedClient.execute(
        "INSERT INTO test_data (id, value) VALUES (1, 'hello')",
    );
    attachedClient.close();

    // Test: Create client with ATTACH config
    const mainClient = createClient({
        url: `file:${mainPath}`,
        attach: [{ alias: "attached", path: attachedPath }],
    });

    // Verify: Can query attached database immediately
    const rows = await mainClient.execute("SELECT * FROM attached.test_data");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ id: 1, value: "hello" });

    mainClient.close();
});

/**
 * Test 2: Config ATTACH Persists After transaction()
 *
 * Core bug fix validation: ATTACH must survive connection recycling.
 */
test("Config ATTACH persists after transaction (FIX VALIDATION)", async () => {
    const mainPath = getTempDbPath("test-persist-main.db");
    const attachedPath = getTempDbPath("test-persist-attached.db");

    // Setup: Create main database
    const mainClient = createClient({
        url: `file:${mainPath}`,
        attach: [{ alias: "attached", path: attachedPath }],
    });

    await mainClient.execute(
        "CREATE TABLE main_table (id INTEGER PRIMARY KEY)",
    );

    // Setup: Create attached database
    const attachedSetup = createClient({ url: `file:${attachedPath}` });
    await attachedSetup.execute(
        "CREATE TABLE attached_table (id INTEGER PRIMARY KEY, data TEXT)",
    );
    await attachedSetup.execute(
        "INSERT INTO attached_table (id, data) VALUES (42, 'test')",
    );
    attachedSetup.close();

    // Verify: ATTACH works BEFORE transaction
    const beforeTx = await mainClient.execute(
        "SELECT * FROM attached.attached_table",
    );
    expect(beforeTx.rows).toHaveLength(1);
    expect(beforeTx.rows[0]).toMatchObject({ id: 42, data: "test" });

    // Action: Create transaction (triggers connection recycling)
    const tx = await mainClient.transaction();
    await tx.execute("INSERT INTO main_table (id) VALUES (1)");
    await tx.commit();

    // Verify: ATTACH still works AFTER transaction (FIX!)
    const afterTx = await mainClient.execute(
        "SELECT * FROM attached.attached_table",
    );
    expect(afterTx.rows).toHaveLength(1);
    expect(afterTx.rows[0]).toMatchObject({ id: 42, data: "test" });

    mainClient.close();
});

/**
 * Test 3: Multiple Config ATTACH Statements
 */
test("Multiple config ATTACH statements work", async () => {
    const mainPath = getTempDbPath("test-multiple-main.db");

    // Setup: Create three attached databases
    const configs = [];
    for (let i = 1; i <= 3; i++) {
        const attachedPath = getTempDbPath(`test-multiple-attached${i}.db`);

        const attachedClient = createClient({ url: `file:${attachedPath}` });
        await attachedClient.execute(`CREATE TABLE data${i} (value INTEGER)`);
        await attachedClient.execute(
            `INSERT INTO data${i} (value) VALUES (${i * 100})`,
        );
        attachedClient.close();

        configs.push({ alias: `db${i}`, path: attachedPath });
    }

    // Test: Create client with multiple attachments
    const mainClient = createClient({
        url: `file:${mainPath}`,
        attach: configs,
    });

    // Transaction (triggers connection recycling)
    const tx = await mainClient.transaction();
    await tx.execute("SELECT 1");
    await tx.commit();

    // Verify: All attachments persist
    const r1 = await mainClient.execute("SELECT * FROM db1.data1");
    const r2 = await mainClient.execute("SELECT * FROM db2.data2");
    const r3 = await mainClient.execute("SELECT * FROM db3.data3");

    expect(r1.rows[0]).toMatchObject({ value: 100 });
    expect(r2.rows[0]).toMatchObject({ value: 200 });
    expect(r3.rows[0]).toMatchObject({ value: 300 });

    mainClient.close();
});

/**
 * Test 4: Read-Only Mode via URI Parameter
 *
 * CRITICAL: Tests file: URI with ?mode=ro parameter.
 */
test("Read-only ATTACH via mode=ro URI parameter", async () => {
    const mainPath = getTempDbPath("test-readonly-main.db");
    const sharedPath = getTempDbPath("test-readonly-shared.db");

    // Setup: Create shared database with writer
    const writerClient = createClient({ url: `file:${sharedPath}` });
    await writerClient.execute(
        "CREATE TABLE shared_data (id INTEGER PRIMARY KEY, value TEXT)",
    );
    await writerClient.execute(
        "INSERT INTO shared_data (id, value) VALUES (1, 'initial')",
    );

    // Test: Attach in read-only mode
    const readerClient = createClient({
        url: `file:${mainPath}`,
        attach: [{ alias: "shared", path: `file:${sharedPath}?mode=ro` }],
    });

    // Verify: Can read from attached database
    const readResult = await readerClient.execute(
        "SELECT * FROM shared.shared_data",
    );
    expect(readResult.rows).toHaveLength(1);
    expect(readResult.rows[0]).toMatchObject({ id: 1, value: "initial" });

    // Verify: Writer can still write (no lock conflict)
    await writerClient.execute(
        "INSERT INTO shared_data (id, value) VALUES (2, 'concurrent')",
    );

    // Verify: Reader sees updated data
    const tx = await readerClient.transaction();
    await tx.commit();

    const updatedRead = await readerClient.execute(
        "SELECT COUNT(*) as count FROM shared.shared_data",
    );
    expect(updatedRead.rows[0]).toMatchObject({ count: 2 });

    // Verify: Reader cannot write to read-only attached database
    await expect(
        readerClient.execute(
            "INSERT INTO shared.shared_data (id, value) VALUES (3, 'fail')",
        ),
    ).rejects.toThrow(
        /readonly database|attempt to write a readonly database/i,
    );

    writerClient.close();
    readerClient.close();
});

/**
 * Test 5: Cross-Database JOIN
 */
test("Cross-database JOIN works with config ATTACH", async () => {
    const warehousePath = getTempDbPath("test-join-warehouse.db");
    const analyticsPath = getTempDbPath("test-join-analytics.db");

    const warehouseClient = createClient({
        url: `file:${warehousePath}`,
        attach: [{ alias: "analytics", path: analyticsPath }],
    });

    await warehouseClient.execute(`
    CREATE TABLE orders (
      order_id INTEGER PRIMARY KEY,
      customer_id INTEGER,
      total REAL
    )
  `);
    await warehouseClient.execute(
        "INSERT INTO orders (order_id, customer_id, total) VALUES (1, 100, 50.00)",
    );

    const analyticsSetup = createClient({ url: `file:${analyticsPath}` });
    await analyticsSetup.execute(`
    CREATE TABLE customer_metrics (
      customer_id INTEGER PRIMARY KEY,
      lifetime_value REAL
    )
  `);
    await analyticsSetup.execute(
        "INSERT INTO customer_metrics (customer_id, lifetime_value) VALUES (100, 500.00)",
    );
    analyticsSetup.close();

    const tx = await warehouseClient.transaction();
    await tx.execute(
        "INSERT INTO orders (order_id, customer_id, total) VALUES (2, 100, 75.00)",
    );
    await tx.commit();

    const result = await warehouseClient.execute(`
    SELECT
      o.order_id,
      o.total,
      m.lifetime_value
    FROM orders o
    JOIN analytics.customer_metrics m ON o.customer_id = m.customer_id
    WHERE o.order_id = 1
  `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
        order_id: 1,
        total: 50.0,
        lifetime_value: 500.0,
    });

    warehouseClient.close();
});

/**
 * Test 6: Config ATTACH with Non-Existent Database
 */
test("Config ATTACH with non-existent database logs warning", async () => {
    const mainPath = getTempDbPath("test-missing-main.db");
    const missingPath = getTempDbPath("test-missing-DOES-NOT-EXIST.db");

    if (fs.existsSync(missingPath)) {
        fs.unlinkSync(missingPath);
    }

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const mainClient = createClient({
        url: `file:${mainPath}`,
        attach: [{ alias: "missing", path: missingPath }],
    });

    await mainClient.execute("CREATE TABLE test (id INTEGER)");
    const rows = await mainClient.execute("SELECT * FROM test");
    expect(rows.rows).toHaveLength(0);

    expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to attach database 'missing'"),
    );

    warnSpy.mockRestore();
    mainClient.close();
});

// ============================================================================
// Explicit attach() Method Tests
// ============================================================================

/**
 * Test 7: Explicit attach() Method Works and Persists
 *
 * CRITICAL: Tests runtime attachment for databases created after client init.
 */
test("Explicit attach() method works and persists", async () => {
    const mainPath = getTempDbPath("test-explicit-main.db");
    const laterPath = getTempDbPath("test-explicit-later.db");

    // Create client WITHOUT attachment
    const mainClient = createClient({ url: `file:${mainPath}` });

    // Create database that "appears later"
    const laterClient = createClient({ url: `file:${laterPath}` });
    await laterClient.execute(
        "CREATE TABLE late_data (id INTEGER, value TEXT)",
    );
    await laterClient.execute("INSERT INTO late_data VALUES (1, 'late')");
    laterClient.close();

    // Attach explicitly after client creation
    await mainClient.attach("later", laterPath);

    // Verify attachment works
    const rows1 = await mainClient.execute("SELECT * FROM later.late_data");
    expect(rows1.rows[0]).toMatchObject({ id: 1, value: "late" });

    // Transaction (triggers connection recycling)
    const tx = await mainClient.transaction();
    await tx.commit();

    // Verify attachment PERSISTS after transaction
    const rows2 = await mainClient.execute("SELECT * FROM later.late_data");
    expect(rows2.rows[0]).toMatchObject({ id: 1, value: "late" });

    mainClient.close();
});

/**
 * Test 8: Explicit attach() with Read-Only Mode
 */
test("Explicit attach() with mode=ro works", async () => {
    const mainPath = getTempDbPath("test-explicit-ro-main.db");
    const sharedPath = getTempDbPath("test-explicit-ro-shared.db");

    const writerClient = createClient({ url: `file:${sharedPath}` });
    await writerClient.execute("CREATE TABLE shared (id INTEGER, data TEXT)");
    await writerClient.execute("INSERT INTO shared VALUES (1, 'data')");

    const readerClient = createClient({ url: `file:${mainPath}` });

    // Explicit attach in read-only mode
    await readerClient.attach("shared", `file:${sharedPath}?mode=ro`);

    // Can read
    const rows = await readerClient.execute("SELECT * FROM shared.shared");
    expect(rows.rows[0]).toMatchObject({ id: 1, data: "data" });

    // Cannot write
    await expect(
        readerClient.execute("INSERT INTO shared.shared VALUES (2, 'fail')"),
    ).rejects.toThrow(/readonly/i);

    writerClient.close();
    readerClient.close();
});

/**
 * Test 9: Explicit detach() Method Works
 */
test("Explicit detach() method works", async () => {
    const mainPath = getTempDbPath("test-detach-main.db");
    const attachedPath = getTempDbPath("test-detach-attached.db");

    const mainClient = createClient({ url: `file:${mainPath}` });

    const attachedClient = createClient({ url: `file:${attachedPath}` });
    await attachedClient.execute("CREATE TABLE data (id INTEGER)");
    attachedClient.close();

    // Attach then detach
    await mainClient.attach("temp", attachedPath);
    const rows1 = await mainClient.execute("SELECT * FROM temp.data");
    expect(rows1.rows).toHaveLength(0);

    await mainClient.detach("temp");

    // Verify detached
    await expect(mainClient.execute("SELECT * FROM temp.data")).rejects.toThrow(
        /no such table/i,
    );

    // Transaction (should NOT re-attach)
    const tx = await mainClient.transaction();
    await tx.commit();

    await expect(mainClient.execute("SELECT * FROM temp.data")).rejects.toThrow(
        /no such table/i,
    );

    mainClient.close();
});

/**
 * Test 10: attach() with Duplicate Alias Throws Error
 */
test("attach() with duplicate alias throws error", async () => {
    const mainPath = getTempDbPath("test-duplicate-main.db");
    const path1 = getTempDbPath("test-duplicate-1.db");
    const path2 = getTempDbPath("test-duplicate-2.db");

    const client = createClient({ url: `file:${mainPath}` });

    for (const path of [path1, path2]) {
        const c = createClient({ url: `file:${path}` });
        await c.execute("CREATE TABLE data (id INTEGER)");
        c.close();
    }

    // First attach succeeds
    await client.attach("db", path1);

    // Second attach with same alias fails
    await expect(client.attach("db", path2)).rejects.toThrow(
        /already attached/i,
    );

    client.close();
});

/**
 * Test 11: Config + Explicit attach() Both Persist
 */
test("Config and explicit attachments both persist", async () => {
    const mainPath = getTempDbPath("test-both-main.db");
    const configPath = getTempDbPath("test-both-config.db");
    const explicitPath = getTempDbPath("test-both-explicit.db");

    // Setup config database
    const configSetup = createClient({ url: `file:${configPath}` });
    await configSetup.execute("CREATE TABLE config_data (id INTEGER)");
    await configSetup.execute("INSERT INTO config_data VALUES (1)");
    configSetup.close();

    // Setup explicit database
    const explicitSetup = createClient({ url: `file:${explicitPath}` });
    await explicitSetup.execute("CREATE TABLE explicit_data (id INTEGER)");
    await explicitSetup.execute("INSERT INTO explicit_data VALUES (2)");
    explicitSetup.close();

    // Create client with config attachment
    const mainClient = createClient({
        url: `file:${mainPath}`,
        attach: [{ alias: "config_db", path: configPath }],
    });

    // Add explicit attachment
    await mainClient.attach("explicit_db", explicitPath);

    // Both work before transaction
    const r1 = await mainClient.execute("SELECT * FROM config_db.config_data");
    const r2 = await mainClient.execute(
        "SELECT * FROM explicit_db.explicit_data",
    );
    expect(r1.rows[0]).toMatchObject({ id: 1 });
    expect(r2.rows[0]).toMatchObject({ id: 2 });

    // Transaction
    const tx = await mainClient.transaction();
    await tx.commit();

    // Both still work after transaction
    const r3 = await mainClient.execute("SELECT * FROM config_db.config_data");
    const r4 = await mainClient.execute(
        "SELECT * FROM explicit_db.explicit_data",
    );
    expect(r3.rows[0]).toMatchObject({ id: 1 });
    expect(r4.rows[0]).toMatchObject({ id: 2 });

    mainClient.close();
});

/**
 * Test 12: Multiple Transactions with Config + Explicit
 */
test("Config and explicit attachments persist across multiple transactions", async () => {
    const mainPath = getTempDbPath("test-multi-tx-main.db");
    const configPath = getTempDbPath("test-multi-tx-config.db");
    const explicitPath = getTempDbPath("test-multi-tx-explicit.db");

    const configSetup = createClient({ url: `file:${configPath}` });
    await configSetup.execute("CREATE TABLE data (id INTEGER)");
    await configSetup.execute("INSERT INTO data VALUES (100)");
    configSetup.close();

    const explicitSetup = createClient({ url: `file:${explicitPath}` });
    await explicitSetup.execute("CREATE TABLE data (id INTEGER)");
    await explicitSetup.execute("INSERT INTO data VALUES (200)");
    explicitSetup.close();

    const mainClient = createClient({
        url: `file:${mainPath}`,
        attach: [{ alias: "config_db", path: configPath }],
    });

    await mainClient.attach("explicit_db", explicitPath);

    // Multiple transactions
    for (let i = 0; i < 3; i++) {
        const tx = await mainClient.transaction();
        await tx.commit();

        // Both still work after each transaction
        const r1 = await mainClient.execute("SELECT * FROM config_db.data");
        const r2 = await mainClient.execute("SELECT * FROM explicit_db.data");
        expect(r1.rows[0]).toMatchObject({ id: 100 });
        expect(r2.rows[0]).toMatchObject({ id: 200 });
    }

    mainClient.close();
});

/**
 * Test 13: Empty attach Config Array
 */
test("Empty attach config array works", async () => {
    const mainPath = getTempDbPath("test-empty-attach-main.db");

    const mainClient = createClient({
        url: `file:${mainPath}`,
        attach: [],
    });

    await mainClient.execute("CREATE TABLE test (id INTEGER)");
    const rows = await mainClient.execute("SELECT * FROM test");
    expect(rows.rows).toHaveLength(0);

    mainClient.close();
});

/**
 * Test 14: Omitted attach Config (Backward Compatible)
 */
test("Omitting attach config works (backward compatible)", async () => {
    const mainPath = getTempDbPath("test-no-attach-main.db");

    const mainClient = createClient({ url: `file:${mainPath}` });

    await mainClient.execute("CREATE TABLE test (id INTEGER)");
    const rows = await mainClient.execute("SELECT * FROM test");
    expect(rows.rows).toHaveLength(0);

    mainClient.close();
});
