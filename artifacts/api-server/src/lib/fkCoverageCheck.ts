/**
 * FK Coverage Check — startup guard
 *
 * Queries PostgreSQL's information_schema to enumerate every table that holds a
 * foreign-key constraint referencing invoice_capture(id) or vendor_id(id), then
 * verifies that the corresponding hard-delete transaction in routes/invoices.ts
 * and routes/vendors.ts explicitly handles every one of those tables.
 *
 * If a future feature adds a new table with an FK to either of those parent
 * tables, the server will refuse to start with a clear, actionable error message
 * rather than silently returning 409s during smoke-test cleanup.
 *
 * HOW TO UPDATE WHEN YOU ADD A NEW FK
 * ─────────────────────────────────────────────────────────────────────────────
 * invoice_capture child tables (DELETE /invoices/:id):
 *   1. Add `await tx.delete(myNewTable).where(eq(myNewTable.invoiceId, id))` to
 *      the delete transaction in routes/invoices.ts.
 *   2. Add the Postgres table name to INVOICE_FK_COVERED below.
 *
 * vendor_id child tables (DELETE /vendors/:id):
 *   1. Either add ON DELETE CASCADE to the FK (preferred — DB handles cleanup
 *      automatically), delete the rows explicitly in the transaction, OR add a
 *      pre-check that blocks deletion while any rows in the new table still
 *      reference the vendor.
 *   2. Add the Postgres table name to VENDOR_FK_COVERED below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Postgres table names whose FK columns (→ invoice_capture.id) are explicitly
 * deleted inside the DELETE /invoices/:id transaction in routes/invoices.ts.
 */
const INVOICE_FK_COVERED = new Set([
  "invoice_audit_log",
  "exception_event",
]);

/**
 * Postgres table names whose FK columns (→ vendor_id.id) are explicitly handled
 * by DELETE /vendors/:id — either deleted in the transaction or pre-checked so
 * the delete is blocked while referencing rows exist.
 *
 * invoice_capture: the route refuses to delete a vendor that still has
 * active (non-VOIDED) invoices and deactivates instead of deleting when
 * voided-only invoices remain, so no FK violation can occur.
 *
 * vendor_audit_log: FK is ON DELETE CASCADE — the DB removes audit rows
 * automatically when the vendor row is deleted; no explicit delete needed.
 */
const VENDOR_FK_COVERED = new Set([
  "invoice_capture",
  "vendor_audit_log",
]);

type FkRow = {
  referencing_table: string;
  referenced_table: string;
};

/**
 * Assert that every FK constraint referencing invoice_capture(id) or
 * vendor_id(id) is explicitly handled in the respective hard-delete
 * transaction.  Throws (crashing the process) if a gap is found.
 */
export async function assertFkCoverage(): Promise<void> {
  // Let any DB or catalog-query error propagate: if we cannot enumerate FK
  // constraints we cannot guarantee coverage, so the server must not start.
  const result = await db.execute<FkRow>(sql`
    SELECT
      tc.table_name  AS referencing_table,
      ccu.table_name AS referenced_table
    FROM information_schema.table_constraints       tc
    JOIN information_schema.referential_constraints rc
      ON  tc.constraint_name   = rc.constraint_name
      AND tc.constraint_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON  rc.unique_constraint_name   = ccu.constraint_name
      AND rc.unique_constraint_schema = ccu.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema     = 'public'
      AND ccu.table_name      IN ('invoice_capture', 'vendor_id')
    ORDER BY ccu.table_name, tc.table_name
  `);
  const rows: FkRow[] = result.rows;

  const invoiceFkTables = new Set<string>();
  const vendorFkTables = new Set<string>();

  for (const row of rows) {
    if (row.referenced_table === "invoice_capture") {
      invoiceFkTables.add(row.referencing_table);
    } else if (row.referenced_table === "vendor_id") {
      vendorFkTables.add(row.referencing_table);
    }
  }

  const invoiceUncovered = [...invoiceFkTables].filter((t) => !INVOICE_FK_COVERED.has(t));
  const vendorUncovered  = [...vendorFkTables].filter((t)  => !VENDOR_FK_COVERED.has(t));

  if (invoiceUncovered.length === 0 && vendorUncovered.length === 0) {
    logger.info(
      {
        invoiceFkTables: [...invoiceFkTables],
        vendorFkTables:  [...vendorFkTables],
      },
      "fkCoverageCheck: all FK references are covered by their delete transactions ✓",
    );
    return;
  }

  // Build a human-readable error that tells the developer exactly what to fix.
  const lines: string[] = [
    "════════════════════════════════════════════════════════════════════",
    "STARTUP BLOCKED: FK coverage gap in hard-delete transactions",
    "════════════════════════════════════════════════════════════════════",
  ];

  if (invoiceUncovered.length > 0) {
    lines.push(
      "",
      "Tables with FK constraints (→ invoice_capture.id) NOT covered by",
      "DELETE /invoices/:id in artifacts/api-server/src/routes/invoices.ts:",
      ...invoiceUncovered.map((t) => `  • ${t}`),
      "",
      "Fix:",
      "  1. Add  await tx.delete(<table>).where(eq(<table>.invoiceId, invoiceId))",
      "     inside the db.transaction() block in the DELETE /invoices/:id handler.",
      `  2. Add '${invoiceUncovered.join("', '")}' to INVOICE_FK_COVERED in`,
      "     artifacts/api-server/src/lib/fkCoverageCheck.ts.",
    );
  }

  if (vendorUncovered.length > 0) {
    lines.push(
      "",
      "Tables with FK constraints (→ vendor_id.id) NOT covered by",
      "DELETE /vendors/:id in artifacts/api-server/src/routes/vendors.ts:",
      ...vendorUncovered.map((t) => `  • ${t}`),
      "",
      "Fix:",
      "  1. Either delete the rows inside the db.transaction() block, OR add a",
      "     pre-check that blocks deletion while any rows reference the vendor.",
      `  2. Add '${vendorUncovered.join("', '")}' to VENDOR_FK_COVERED in`,
      "     artifacts/api-server/src/lib/fkCoverageCheck.ts.",
    );
  }

  lines.push("════════════════════════════════════════════════════════════════════");

  throw new Error(lines.join("\n"));
}

/**
 * Check for orphaned vendor_audit_log rows — rows whose vendor_id no longer
 * has a matching row in vendor_id (possible if a vendor was deleted out-of-band
 * via raw SQL, bypassing the ON DELETE CASCADE).
 *
 * This is a warning-only check: it logs a structured WARN with the orphan
 * count but does NOT crash the server. Crashing would be too disruptive for
 * an operational issue that does not affect correctness of live traffic.
 */
export async function warnVendorAuditOrphans(): Promise<void> {
  const result = await db.execute<{ orphan_count: string }>(sql`
    SELECT COUNT(*) AS orphan_count
    FROM vendor_audit_log val
    WHERE NOT EXISTS (
      SELECT 1 FROM vendor_id v WHERE v.id = val.vendor_id
    )
  `);

  const orphanCount = Number(result.rows[0]?.orphan_count ?? 0);

  if (orphanCount > 0) {
    logger.warn(
      { orphanCount },
      `vendorAuditOrphanCheck: ${orphanCount} orphaned row(s) found in vendor_audit_log — ` +
        "a vendor was likely deleted out-of-band via raw SQL, bypassing ON DELETE CASCADE. " +
        "Run the smoke test (Suite 13) for details.",
    );
  } else {
    logger.info("vendorAuditOrphanCheck: no orphaned vendor_audit_log rows ✓");
  }
}
