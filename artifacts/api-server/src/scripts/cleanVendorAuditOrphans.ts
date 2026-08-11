/**
 * cleanVendorAuditOrphans.ts
 *
 * Admin script: counts and optionally deletes vendor_audit_log rows whose
 * vendor_id no longer exists in the vendor_id table.
 *
 * Usage:
 *   # Dry-run (default) — prints count and a sample of affected vendor IDs:
 *   npx tsx src/scripts/cleanVendorAuditOrphans.ts
 *
 *   # Actually delete the orphaned rows:
 *   npx tsx src/scripts/cleanVendorAuditOrphans.ts --confirm
 *
 * Exit codes:
 *   0  — success (including dry-run with 0 or >0 orphans)
 *   1  — deletion failed or an unexpected error occurred
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";

const CONFIRM = process.argv.includes("--confirm");
const SAMPLE_LIMIT = 20;

async function main(): Promise<void> {
  // ── 1. Count orphans ────────────────────────────────────────────────────────
  const countResult = await db.execute<{ orphan_count: string }>(sql`
    SELECT COUNT(*) AS orphan_count
    FROM vendor_audit_log val
    WHERE NOT EXISTS (
      SELECT 1 FROM vendor_id v WHERE v.id = val.vendor_id
    )
  `);

  const orphanCount = Number(countResult.rows[0]?.orphan_count ?? 0);

  if (orphanCount === 0) {
    logger.info(
      { orphanCount, dryRun: !CONFIRM },
      "cleanVendorAuditOrphans: no orphaned vendor_audit_log rows found — nothing to do ✓",
    );
    process.exit(0);
  }

  // ── 2. Fetch a sample of affected vendor IDs ────────────────────────────────
  const sampleResult = await db.execute<{ vendor_id: string }>(sql`
    SELECT DISTINCT val.vendor_id
    FROM vendor_audit_log val
    WHERE NOT EXISTS (
      SELECT 1 FROM vendor_id v WHERE v.id = val.vendor_id
    )
    LIMIT ${SAMPLE_LIMIT}
  `);

  const sampleIds = sampleResult.rows.map((r) => r.vendor_id);
  const sampleTruncated = orphanCount > SAMPLE_LIMIT;

  logger.info(
    {
      orphanCount,
      sampleVendorIds: sampleIds,
      sampleTruncated,
      dryRun: !CONFIRM,
    },
    `cleanVendorAuditOrphans: found ${orphanCount} orphaned vendor_audit_log row(s). ` +
      `Sample of affected vendor_id values (up to ${SAMPLE_LIMIT}): [${sampleIds.join(", ")}]` +
      (sampleTruncated ? " …(truncated)" : "") +
      (!CONFIRM ? " — re-run with --confirm to delete." : ""),
  );

  if (!CONFIRM) {
    // Dry-run complete — exit cleanly.
    process.exit(0);
  }

  // ── 3. Delete orphaned rows ─────────────────────────────────────────────────
  logger.info(
    { orphanCount },
    "cleanVendorAuditOrphans: --confirm flag set — deleting orphaned rows…",
  );

  try {
    const deleteResult = await db.execute<{ deleted_count: string }>(sql`
      WITH deleted AS (
        DELETE FROM vendor_audit_log
        WHERE NOT EXISTS (
          SELECT 1 FROM vendor_id v WHERE v.id = vendor_audit_log.vendor_id
        )
        RETURNING 1
      )
      SELECT COUNT(*) AS deleted_count FROM deleted
    `);

    const deletedCount = Number(deleteResult.rows[0]?.deleted_count ?? 0);

    logger.info(
      { deletedCount, requestedCount: orphanCount, success: true },
      `cleanVendorAuditOrphans: deleted ${deletedCount} orphaned vendor_audit_log row(s) ✓`,
    );

    process.exit(0);
  } catch (err) {
    logger.error(
      { err, requestedCount: orphanCount, success: false },
      "cleanVendorAuditOrphans: deletion failed — no rows were removed",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error({ err }, "cleanVendorAuditOrphans: unexpected error");
  process.exit(1);
});
