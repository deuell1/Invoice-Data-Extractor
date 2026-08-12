/**
 * smoke_cleanup_orphan_testdata.mjs
 *
 * One-shot cleanup: deletes orphaned vendor_audit_log rows that were created by
 * warnVendorAuditOrphans.test.ts (actor = 'orphan-test-setup') and were never
 * removed because the subprocess was killed before its after() hook ran.
 *
 * These rows accumulate on every smoke-test run because the before() hook
 * deliberately bypasses ON DELETE CASCADE to manufacture the orphaned state.
 * This script is invoked by smoke_test.mjs immediately before Suite 13 to
 * ensure the baseline orphan count reflects only real production issues, not
 * accumulated test residue.
 *
 * Safe to run multiple times (idempotent).
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const result = await db.execute(sql`
  DELETE FROM vendor_audit_log
  WHERE actor = 'orphan-test-setup'
    AND vendor_id NOT IN (SELECT id FROM vendor_id)
`);

const count = result.rowCount ?? result.rows?.length ?? 0;
console.log(`Cleaned up ${count} orphaned vendor_audit_log row(s) from prior test runs.`);

process.exit(0);
