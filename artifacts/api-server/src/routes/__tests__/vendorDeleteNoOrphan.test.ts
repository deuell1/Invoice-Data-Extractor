/**
 * Regression test: DELETE /vendors/:id must not orphan vendor_audit_log rows.
 *
 * Background
 * ──────────
 * The live database does NOT have an ON DELETE CASCADE foreign key from
 * vendor_audit_log.vendor_id → vendor_id.id.  The \d vendor_audit_log output
 * confirms there is no FK constraint at all, only the primary key index.
 * This means the route's explicit DELETE on vendor_audit_log (inside its
 * transaction) is the ONLY mechanism that prevents orphaned audit rows.
 *
 * What this test does
 * ───────────────────
 * 1. Asserts the FK constraint is absent (confirming CASCADE is not active).
 * 2. Creates a vendor + additional audit row via the DB.
 * 3. Calls DELETE /vendors/:id through the real Express app (supertest).
 * 4. Asserts vendor_audit_log has zero rows for that vendor_id.
 * 5. Asserts GET /vendors/orphaned-audit-count shows the same value as before
 *    (no new orphans were created).
 *
 * Without the explicit audit-log DELETE in the route's transaction, step 4
 * would fail — because there is no CASCADE fallback in this database.
 *
 * Run directly:
 *   node --test --import tsx/esm \
 *     src/routes/__tests__/vendorDeleteNoOrphan.test.ts
 *
 * Also invoked by smoke_test.mjs Suite 17.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import request from "supertest";

import app from "../../app.js";
import { db, pool } from "@workspace/db";
import { vendorIdTable, vendorAuditLogTable } from "@workspace/db";

// ─── Test data tracking ───────────────────────────────────────────────────────

const TEST_VENDOR_CODE = `DEL-ORPHAN-TEST-${Date.now()}`;
let testVendorId: number | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Count vendor_audit_log rows whose vendor_id has no matching vendor row. */
async function countOrphanedAuditRows(): Promise<number> {
  const result = await db.execute<{ orphan_count: string }>(sql`
    SELECT count(*) AS orphan_count
    FROM vendor_audit_log
    WHERE vendor_id NOT IN (SELECT id FROM vendor_id)
  `);
  return Number(result.rows[0]?.orphan_count ?? 0);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

before(async () => {
  const [vendor] = await db
    .insert(vendorIdTable)
    .values({
      vendorCode: TEST_VENDOR_CODE,
      vendorName: `Vendor Delete No-Orphan Test ${Date.now()}`,
      isActive: true,
    })
    .returning({ id: vendorIdTable.id });

  assert.ok(vendor?.id, "SETUP: test vendor was inserted");
  testVendorId = vendor.id;

  // Insert an extra audit row so there is more than the VENDOR_CREATED row.
  await db.insert(vendorAuditLogTable).values({
    vendorId: testVendorId,
    action: "VENDOR_FIELD_UPDATED",
    actor: "orphan-regression-test",
    fieldName: "notes",
    newValue: "regression test row",
  });
});

// ─── Teardown: remove any surviving rows (best-effort) ───────────────────────

after(async () => {
  if (testVendorId !== null) {
    try {
      await db
        .delete(vendorAuditLogTable)
        .where(eq(vendorAuditLogTable.vendorId, testVendorId));
      await db
        .delete(vendorIdTable)
        .where(eq(vendorIdTable.id, testVendorId));
    } catch {
      // best-effort
    }
    testVendorId = null;
  }
  // Close the pool so the process can exit immediately.  Without this,
  // idleTimeoutMillis (30 s) keeps connections alive and the subprocess
  // outlives the smoke suite's spawnSync deadline, producing a SIGTERM kill.
  await pool.end();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DELETE /vendors/:id — explicit audit-log delete (no orphan regression)", () => {
  it(
    "confirms the live DB has no ON DELETE CASCADE on vendor_audit_log.vendor_id, " +
      "so the route's explicit audit-log DELETE is the only cleanup mechanism",
    async () => {
      // Query the information_schema to check whether a CASCADE FK exists.
      // If this assertion fails, the DB schema has changed and the test should
      // be re-evaluated — CASCADE may now be active.
      const fkResult = await db.execute<{
        constraint_name: string;
        delete_rule: string;
      }>(sql`
        SELECT tc.constraint_name, rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.table_name     = 'vendor_audit_log'
          AND tc.constraint_type = 'FOREIGN KEY'
      `);

      const cascadeConstraints = fkResult.rows.filter(
        (r) => r.delete_rule === "CASCADE",
      );

      assert.strictEqual(
        cascadeConstraints.length,
        0,
        `Expected 0 CASCADE FK constraints on vendor_audit_log (found ${cascadeConstraints.length}: ` +
          `${cascadeConstraints.map((r) => r.constraint_name).join(", ")}). ` +
          `If CASCADE is now active, this test is redundant but still valid.`,
      );
    },
  );

  it(
    "leaves zero new orphaned audit rows after DELETE /vendors/:id " +
      "— proving the route explicitly deletes audit rows (no CASCADE fallback in this DB)",
    async () => {
      assert.ok(testVendorId !== null, "pre-condition: testVendorId is set");
      const id = testVendorId!;

      // Verify audit rows exist for this vendor before deletion.
      const auditBefore = await db
        .select({ id: vendorAuditLogTable.id })
        .from(vendorAuditLogTable)
        .where(eq(vendorAuditLogTable.vendorId, id));
      assert.ok(
        auditBefore.length >= 1,
        `pre-condition: at least 1 audit row exists for vendor ${id} (got ${auditBefore.length})`,
      );

      // Record global orphan count before delete.
      const orphansBefore = await countOrphanedAuditRows();

      // Call DELETE /vendors/:id through the real Express app.
      const res = await (request(app) as any)
        .delete(`/api/vendors/${id}`)
        .set("Authorization", `Bearer ${process.env.SMOKE_TEST_API_KEY ?? ""}`)
        .send({ confirm: true });

      assert.ok(
        res.status === 200,
        `DELETE /vendors/:id returned unexpected status ${res.status}: ${JSON.stringify(res.body)}`,
      );
      assert.strictEqual(
        res.body.deleted,
        true,
        `expected deleted=true, got ${JSON.stringify(res.body)}`,
      );

      // Mark testVendorId null so teardown skips re-deleting it.
      testVendorId = null;

      // Verify no new orphaned rows were created.
      // Because there is no ON DELETE CASCADE in this DB (verified above),
      // the orphan count staying the same proves the route explicitly deleted
      // the audit rows — not the database engine.
      const orphansAfter = await countOrphanedAuditRows();
      assert.strictEqual(
        orphansAfter,
        orphansBefore,
        `Orphaned audit rows must not increase after DELETE /vendors/:id ` +
          `(before=${orphansBefore}, after=${orphansAfter}). ` +
          `Since this DB has no ON DELETE CASCADE, an increase would mean the route ` +
          `failed to explicitly delete vendor_audit_log rows before removing the vendor.`,
      );

      // Also verify the vendor's audit rows are completely gone.
      const auditAfter = await db
        .select({ id: vendorAuditLogTable.id })
        .from(vendorAuditLogTable)
        .where(eq(vendorAuditLogTable.vendorId, id));
      assert.strictEqual(
        auditAfter.length,
        0,
        `Expected 0 audit rows for deleted vendor ${id}, found ${auditAfter.length}. ` +
          `The route must explicitly DELETE vendor_audit_log rows inside its transaction.`,
      );
    },
  );
});
