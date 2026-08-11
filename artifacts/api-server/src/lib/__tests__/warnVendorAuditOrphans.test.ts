/**
 * Unit test for warnVendorAuditOrphans (fkCoverageCheck.ts)
 *
 * Verifies two properties of the startup orphan-warning logic:
 *
 *   1. WARN path (real DB): when vendor_audit_log contains rows whose vendor_id
 *      no longer exists in vendor_id, warnVendorAuditOrphans() emits logger.warn
 *      with orphanCount ≥ 1.
 *
 *      The test manufactures an additional orphaned row by inserting a vendor +
 *      audit row, then deleting the vendor WITHOUT triggering ON DELETE CASCADE
 *      (using SET session_replication_role = replica).  This guarantees the WARN
 *      path is reachable regardless of any pre-existing DB state.
 *
 *   2. INFO path (mocked DB): when the query returns zero orphans,
 *      warnVendorAuditOrphans() emits logger.info and must NOT call logger.warn.
 *
 *      The INFO path is tested with a mocked db.execute so it does not depend on
 *      global DB state.  Pre-existing orphaned rows in the environment would
 *      otherwise always trigger the WARN branch, making a clean INFO assertion
 *      impossible against a live DB.
 *
 * Run directly:
 *   node --test --import tsx/esm \
 *     artifacts/api-server/src/lib/__tests__/warnVendorAuditOrphans.test.ts
 *
 * Also invoked by smoke_test.mjs Suite 16.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { db } from "@workspace/db";
import { vendorIdTable, vendorAuditLogTable } from "@workspace/db";
import { logger } from "../logger.js";
import { warnVendorAuditOrphans } from "../fkCoverageCheck.js";

// ─── Spy helpers ──────────────────────────────────────────────────────────────

type LogCall = { bindings: Record<string, unknown>; msg: string };

/**
 * Temporarily replace logger[level] with a recording stub.
 * Returns the recorded calls and a `restore` function.
 */
function spyLogger(level: "warn" | "info") {
  const calls: LogCall[] = [];
  // Cast through `unknown` first so TypeScript accepts the dynamic property
  // access on a Pino logger (which lacks an index signature).
  const loggerAsUnknown = logger as unknown as Record<string, unknown>;
  const original = loggerAsUnknown[level];

  loggerAsUnknown[level] = (objOrMsg: unknown, msg?: string) => {
    if (typeof objOrMsg === "string") {
      calls.push({ bindings: {}, msg: objOrMsg });
    } else {
      calls.push({ bindings: objOrMsg as Record<string, unknown>, msg: msg ?? "" });
    }
  };

  return {
    calls,
    restore: () => {
      loggerAsUnknown[level] = original;
    },
  };
}

// ─── Test data tracking ───────────────────────────────────────────────────────

const TEST_VENDOR_CODE = `ORPHAN-TEST-${Date.now()}`;
let testVendorId: number | null = null;
let testAuditRowId: number | null = null;

// ─── Setup: insert vendor + audit row, then delete vendor bypassing CASCADE ───

before(async () => {
  // 1. Insert a minimal vendor row.
  const [vendor] = await db
    .insert(vendorIdTable)
    .values({
      vendorCode: TEST_VENDOR_CODE,
      vendorName: `Orphan Test Vendor ${Date.now()}`,
      isActive: true,
    })
    .returning({ id: vendorIdTable.id });

  assert.ok(vendor?.id, "SETUP: vendor was inserted");
  testVendorId = vendor.id;

  // 2. Insert an audit row referencing the vendor (FK satisfied at this point).
  const [auditRow] = await db
    .insert(vendorAuditLogTable)
    .values({
      vendorId: testVendorId,
      action: "VENDOR_CREATED",
      actor: "orphan-test-setup",
    })
    .returning({ id: vendorAuditLogTable.id });

  assert.ok(auditRow?.id, "SETUP: audit row was inserted");
  testAuditRowId = auditRow.id;

  // 3. Delete the vendor WITHOUT triggering ON DELETE CASCADE.
  //    session_replication_role = replica disables all constraint and trigger
  //    processing for the current session, so the audit row survives the delete.
  await db.execute(sql`SET session_replication_role = replica`);
  try {
    await db.execute(sql`DELETE FROM vendor_id WHERE id = ${testVendorId}`);
  } finally {
    await db.execute(sql`RESET session_replication_role`);
  }
  testVendorId = null; // vendor row is gone; orphaned audit row remains
});

// ─── Teardown: remove any surviving test rows ─────────────────────────────────

after(async () => {
  if (testAuditRowId !== null) {
    try {
      await db
        .delete(vendorAuditLogTable)
        .where(sql`${vendorAuditLogTable.id} = ${testAuditRowId}`);
    } catch {
      // best-effort
    }
    testAuditRowId = null;
  }
  // If setup failed before the raw delete, clean up the vendor too.
  if (testVendorId !== null) {
    try {
      await db.execute(sql`SET session_replication_role = replica`);
      await db.execute(sql`DELETE FROM vendor_id WHERE vendor_code = ${TEST_VENDOR_CODE}`);
    } catch {
      // best-effort
    } finally {
      await db.execute(sql`RESET session_replication_role`);
    }
    testVendorId = null;
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("warnVendorAuditOrphans", () => {
  /**
   * Test 1 — WARN path (real DB)
   *
   * The before() hook already manufactured an orphaned audit row, so the real
   * query will return orphan_count ≥ 1.  Confirm that logger.warn is called with
   * the correct shape.
   */
  it("1. emits logger.warn with orphanCount ≥ 1 when orphaned rows exist (real DB)", async () => {
    const warnSpy = spyLogger("warn");
    try {
      await warnVendorAuditOrphans();
    } finally {
      warnSpy.restore();
    }

    assert.ok(
      warnSpy.calls.length >= 1,
      `logger.warn must be called at least once (got ${warnSpy.calls.length} calls)`,
    );

    const call = warnSpy.calls[0];
    assert.ok(
      typeof call.bindings.orphanCount === "number" && call.bindings.orphanCount >= 1,
      `logger.warn bindings must have orphanCount ≥ 1 (got ${JSON.stringify(call.bindings)})`,
    );
    assert.ok(
      call.msg.includes("orphaned"),
      `warn message must mention "orphaned" (got "${call.msg}")`,
    );
  });

  /**
   * Test 2 — INFO path (mocked db.execute)
   *
   * Pre-existing orphaned rows in the DB make it impossible to observe the INFO
   * branch with a real query.  We replace db.execute with a stub that returns
   * orphan_count = "0" for the duration of this test so we can assert the
   * branching logic without depending on DB state.
   *
   * The stub is scope-local: db.execute is restored immediately after the call
   * so no other test is affected.
   */
  it("2. emits logger.info (not logger.warn) when query returns zero orphans (mocked DB)", async () => {
    // Install a stub that returns orphan_count = "0".
    const originalExecute = db.execute.bind(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).execute = async (_query: unknown) => ({
      rows: [{ orphan_count: "0" }],
    });

    const infoSpy = spyLogger("info");
    const warnSpy = spyLogger("warn");
    try {
      await warnVendorAuditOrphans();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).execute = originalExecute;
      infoSpy.restore();
      warnSpy.restore();
    }

    // logger.warn must NOT be called when orphanCount === 0.
    assert.strictEqual(
      warnSpy.calls.length,
      0,
      `logger.warn must NOT be called when orphanCount=0 (got ${warnSpy.calls.length} warn call(s): ${JSON.stringify(warnSpy.calls)})`,
    );

    // logger.info must be called with a "no orphaned … ✓" confirmation.
    assert.ok(
      infoSpy.calls.length >= 1,
      `logger.info must be called at least once when orphanCount=0 (got ${infoSpy.calls.length})`,
    );
    const infoCall = infoSpy.calls.find(
      (c) =>
        c.msg.includes("no orphaned") ||
        c.msg.includes("orphaned vendor_audit_log rows ✓"),
    );
    assert.ok(
      infoCall !== undefined,
      `logger.info must emit a "no orphaned" confirmation (calls: ${JSON.stringify(infoSpy.calls.map((c) => c.msg))})`,
    );
  });
});
