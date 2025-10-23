/**
 * Test suite for ATTACH DATABASE persistence across connection recycling
 *
 * These tests validate that ATTACH DATABASE statements persist when transaction()
 * creates new connections. This is a regression test for the bug where ATTACH
 * statements were lost after transaction() nulled the connection reference.
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
    // Create temporary directory for test databases
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "libsql-attach-test-"));
});

afterAll(() => {
    // Clean up temporary directory
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

/**
 * Test 1: Bug Reproduction
 *
 * This test PROVES the bug exists by showing ATTACH is lost after transaction().
 *
 * Expected behavior WITHOUT fix: Test fails with "no such table: attached.attached_table"
 * Expected behavior WITH fix: Test passes - query succeeds after transaction
 */
test("ATTACH persists after transaction (FIX VALIDATION)", async () => {
    const mainPath = getTempDbPath("test-main.db");
    const attachedPath = getTempDbPath("test-attached.db");

    // Setup: Create main database
    const mainClient = createClient({ url: `file:${mainPath}` });
    await mainClient.execute(
        "CREATE TABLE main_table (id INTEGER PRIMARY KEY, value TEXT)",
    );

    // Setup: Create attached database
    const attachedClient = createClient({ url: `file:${attachedPath}` });
    await attachedClient.execute(
        "CREATE TABLE attached_table (id INTEGER PRIMARY KEY, value TEXT)",
    );
    await attachedClient.execute(
        "INSERT INTO attached_table (id, value) VALUES (42, 'test data')",
    );
    attachedClient.close();

    // Step 1: ATTACH database
    await mainClient.execute(`ATTACH DATABASE '${attachedPath}' AS attached`);

    // Step 2: Verify ATTACH works BEFORE transaction
    const rowsBefore = await mainClient.execute(
        "SELECT * FROM attached.attached_table",
    );
    expect(rowsBefore.rows).toHaveLength(1);
    expect(rowsBefore.rows[0]).toMatchObject({ id: 42, value: "test data" });

    // Step 3: Create transaction (triggers connection recycling)
    const tx = await mainClient.transaction();
    await tx.execute(
        "INSERT INTO main_table (id, value) VALUES (1, 'transaction data')",
    );
    await tx.commit();

    // Step 4: Query attached DB AFTER transaction
    // BUG: Without fix, this throws "no such table: attached.attached_table"
    // FIX: With fix, this succeeds because ATTACH was re-applied
    const rowsAfter = await mainClient.execute(
        "SELECT * FROM attached.attached_table",
    );
    expect(rowsAfter.rows).toHaveLength(1);
    expect(rowsAfter.rows[0]).toMatchObject({ id: 42, value: "test data" });

    // Step 5: Verify main table still accessible
    const mainRows = await mainClient.execute("SELECT * FROM main_table");
    expect(mainRows.rows).toHaveLength(1);

    mainClient.close();
});

/**
 * Test 2: Multiple Transactions
 *
 * Verifies ATTACH persists across multiple transaction cycles
 */
test("ATTACH persists across multiple transactions", async () => {
    const mainPath = getTempDbPath("test-multi-main.db");
    const attachedPath = getTempDbPath("test-multi-attached.db");

    const mainClient = createClient({ url: `file:${mainPath}` });
    await mainClient.execute("CREATE TABLE main_table (id INTEGER)");

    const attachedClient = createClient({ url: `file:${attachedPath}` });
    await attachedClient.execute("CREATE TABLE attached_table (id INTEGER)");
    await attachedClient.execute(
        "INSERT INTO attached_table (id) VALUES (100)",
    );
    attachedClient.close();

    // ATTACH database
    await mainClient.execute(`ATTACH DATABASE '${attachedPath}' AS attached`);

    // First transaction
    const tx1 = await mainClient.transaction();
    await tx1.execute("INSERT INTO main_table (id) VALUES (1)");
    await tx1.commit();

    // Query should work after first transaction
    const rows1 = await mainClient.execute(
        "SELECT * FROM attached.attached_table",
    );
    expect(rows1.rows[0]).toMatchObject({ id: 100 });

    // Second transaction
    const tx2 = await mainClient.transaction();
    await tx2.execute("INSERT INTO main_table (id) VALUES (2)");
    await tx2.commit();

    // Query should still work after second transaction
    const rows2 = await mainClient.execute(
        "SELECT * FROM attached.attached_table",
    );
    expect(rows2.rows[0]).toMatchObject({ id: 100 });

    mainClient.close();
});

/**
 * Test 3: Multiple ATTACH Statements
 *
 * Verifies tracking works with multiple attached databases
 */
test("Multiple ATTACH statements persist", async () => {
    const mainPath = getTempDbPath("test-multiple-main.db");

    const mainClient = createClient({ url: `file:${mainPath}` });

    // Create and attach three databases
    const attachedPaths: string[] = [];
    for (let i = 1; i <= 3; i++) {
        const attachedPath = getTempDbPath(`test-multiple-attached${i}.db`);
        attachedPaths.push(attachedPath);

        const attachedClient = createClient({ url: `file:${attachedPath}` });
        await attachedClient.execute(`CREATE TABLE data${i} (value INTEGER)`);
        await attachedClient.execute(
            `INSERT INTO data${i} (value) VALUES (${i * 100})`,
        );
        attachedClient.close();

        await mainClient.execute(`ATTACH DATABASE '${attachedPath}' AS db${i}`);
    }

    // Transaction (triggers connection recycling)
    const tx = await mainClient.transaction();
    await tx.execute("SELECT 1");
    await tx.commit();

    // All three ATTACH statements should persist
    const r1 = await mainClient.execute("SELECT * FROM db1.data1");
    const r2 = await mainClient.execute("SELECT * FROM db2.data2");
    const r3 = await mainClient.execute("SELECT * FROM db3.data3");

    expect(r1.rows[0]).toMatchObject({ value: 100 });
    expect(r2.rows[0]).toMatchObject({ value: 200 });
    expect(r3.rows[0]).toMatchObject({ value: 300 });

    mainClient.close();
});

/**
 * Test 4: DETACH Tracking
 *
 * Verifies DETACH removes tracking (doesn't re-attach)
 */
test("DETACH removes ATTACH from tracking", async () => {
    const mainPath = getTempDbPath("test-detach-main.db");
    const attachedPath = getTempDbPath("test-detach-attached.db");

    const mainClient = createClient({ url: `file:${mainPath}` });

    const attachedClient = createClient({ url: `file:${attachedPath}` });
    await attachedClient.execute("CREATE TABLE data (id INTEGER)");
    attachedClient.close();

    // ATTACH then DETACH
    await mainClient.execute(`ATTACH DATABASE '${attachedPath}' AS attached`);
    await mainClient.execute("DETACH DATABASE attached");

    // Transaction (triggers connection recycling)
    const tx = await mainClient.transaction();
    await tx.commit();

    // Attached DB should NOT be re-attached
    await expect(
        mainClient.execute("SELECT * FROM attached.data"),
    ).rejects.toThrow(/no such table/i);

    mainClient.close();
});

/**
 * Test 5: Case Insensitivity
 *
 * Verifies regex handles different SQL casing
 */
test("ATTACH tracking is case-insensitive", async () => {
    const mainPath = getTempDbPath("test-case-main.db");
    const attachedPath = getTempDbPath("test-case-attached.db");

    const mainClient = createClient({ url: `file:${mainPath}` });

    const attachedClient = createClient({ url: `file:${attachedPath}` });
    await attachedClient.execute("CREATE TABLE data (id INTEGER)");
    await attachedClient.execute("INSERT INTO data (id) VALUES (99)");
    attachedClient.close();

    // Test lowercase ATTACH
    await mainClient.execute(`attach database '${attachedPath}' as attached`);

    const tx = await mainClient.transaction();
    await tx.commit();

    // Should work regardless of original casing
    const rows = await mainClient.execute("SELECT * FROM attached.data");
    expect(rows.rows[0]).toMatchObject({ id: 99 });

    mainClient.close();
});

/**
 * Test 6: Quote Styles
 *
 * Verifies both single and double quotes work
 */
test("ATTACH handles single and double quotes", async () => {
    const mainPath = getTempDbPath("test-quotes-main.db");

    const mainClient = createClient({ url: `file:${mainPath}` });

    // Test single quotes
    const db1Path = getTempDbPath("test-quotes-db1.db");
    const db1Client = createClient({ url: `file:${db1Path}` });
    await db1Client.execute("CREATE TABLE data (id INTEGER)");
    await db1Client.execute("INSERT INTO data (id) VALUES (1)");
    db1Client.close();

    await mainClient.execute(`ATTACH DATABASE '${db1Path}' AS db1`);

    // Test double quotes
    const db2Path = getTempDbPath("test-quotes-db2.db");
    const db2Client = createClient({ url: `file:${db2Path}` });
    await db2Client.execute("CREATE TABLE data (id INTEGER)");
    await db2Client.execute("INSERT INTO data (id) VALUES (2)");
    db2Client.close();

    await mainClient.execute(`ATTACH DATABASE "${db2Path}" AS db2`);

    const tx = await mainClient.transaction();
    await tx.commit();

    // Both should persist
    const r1 = await mainClient.execute("SELECT * FROM db1.data");
    const r2 = await mainClient.execute("SELECT * FROM db2.data");

    expect(r1.rows[0]).toMatchObject({ id: 1 });
    expect(r2.rows[0]).toMatchObject({ id: 2 });

    mainClient.close();
});

/**
 * Test 7: Cross-Database JOIN
 *
 * Verifies ATTACH enables cross-database queries
 */
test("Cross-database JOIN works after transaction", async () => {
    const warehousePath = getTempDbPath("test-join-warehouse.db");
    const analyticsPath = getTempDbPath("test-join-analytics.db");

    // Setup warehouse DB
    const warehouseClient = createClient({ url: `file:${warehousePath}` });
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

    // Setup analytics DB
    const analyticsClient = createClient({ url: `file:${analyticsPath}` });
    await analyticsClient.execute(`
        CREATE TABLE customer_metrics (
            customer_id INTEGER PRIMARY KEY,
            lifetime_value REAL
        )
    `);
    await analyticsClient.execute(
        "INSERT INTO customer_metrics (customer_id, lifetime_value) VALUES (100, 500.00)",
    );
    analyticsClient.close();

    // ATTACH analytics to warehouse
    await warehouseClient.execute(
        `ATTACH DATABASE '${analyticsPath}' AS analytics`,
    );

    // Transaction
    const tx = await warehouseClient.transaction();
    await tx.execute(
        "INSERT INTO orders (order_id, customer_id, total) VALUES (2, 100, 75.00)",
    );
    await tx.commit();

    // Cross-database JOIN should work
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
 * Test 8: DETACH with Optional DATABASE Keyword
 *
 * SQLite allows "DETACH schema" or "DETACH DATABASE schema"
 */
test("DETACH works with and without DATABASE keyword", async () => {
    const mainPath = getTempDbPath("test-detach-keyword-main.db");
    const attached1Path = getTempDbPath("test-detach-keyword-attached1.db");
    const attached2Path = getTempDbPath("test-detach-keyword-attached2.db");

    const mainClient = createClient({ url: `file:${mainPath}` });

    // Setup two attached databases
    const a1Client = createClient({ url: `file:${attached1Path}` });
    await a1Client.execute("CREATE TABLE data (id INTEGER)");
    a1Client.close();

    const a2Client = createClient({ url: `file:${attached2Path}` });
    await a2Client.execute("CREATE TABLE data (id INTEGER)");
    a2Client.close();

    // ATTACH both
    await mainClient.execute(`ATTACH DATABASE '${attached1Path}' AS db1`);
    await mainClient.execute(`ATTACH DATABASE '${attached2Path}' AS db2`);

    // DETACH with "DATABASE" keyword
    await mainClient.execute("DETACH DATABASE db1");

    // DETACH without "DATABASE" keyword
    await mainClient.execute("DETACH db2");

    // Transaction
    const tx = await mainClient.transaction();
    await tx.commit();

    // Both should be detached (not re-attached)
    await expect(mainClient.execute("SELECT * FROM db1.data")).rejects.toThrow(
        /no such table/i,
    );

    await expect(mainClient.execute("SELECT * FROM db2.data")).rejects.toThrow(
        /no such table/i,
    );

    mainClient.close();
});
