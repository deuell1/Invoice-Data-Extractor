/**
 * smoke_cleanup.mjs
 *
 * Exported cleanup logic for the AP Pipeline Smoke Test.
 *
 * Extracting this as a module means:
 *   1. smoke_test.mjs imports and calls runCleanup() with the live api() helper.
 *   2. smoke_cleanup_exit.test.mjs imports runCleanup() and injects a mock api,
 *      so tests exercise the REAL cleanup code — any regression in this file
 *      will break both production runs and the test suite simultaneously.
 *
 * API
 * ───
 *   runCleanup({ api, createdInvoiceIds, createdVendorIds,
 *                createdSourceDocIds, createdExportBatchIds,
 *                orphanedObjectPaths })
 *     → Promise<{ failed: number, failures: string[] }>
 *
 * Parameters
 * ──────────
 *   api                  — async (method, path, body?) → { status, ok, json, headers }
 *   createdInvoiceIds    — invoice IDs to void then delete
 *   createdVendorIds     — vendor IDs to delete
 *   createdSourceDocIds  — source-document IDs to delete
 *   createdExportBatchIds — export-batch IDs to delete
 *   orphanedObjectPaths  — raw /objects/... paths uploaded but never linked to a source doc
 *
 * Return value
 * ────────────
 *   failed   — number of cleanup steps that returned an unexpected HTTP status
 *              or threw an error (caller should add to its own failed counter)
 *   failures — human-readable failure messages (caller should merge into its list)
 */

export async function runCleanup({
  api,
  createdInvoiceIds     = [],
  createdVendorIds      = [],
  createdSourceDocIds   = [],
  createdExportBatchIds = [],
  orphanedObjectPaths   = [],
}) {
  let failed = 0;
  const failures = [];

  console.log("\n── Cleanup: removing smoke-test data ──────────────────────");

  if (
    createdInvoiceIds.length     === 0 &&
    createdVendorIds.length      === 0 &&
    createdSourceDocIds.length   === 0 &&
    createdExportBatchIds.length === 0 &&
    orphanedObjectPaths.length   === 0
  ) {
    console.log("  (nothing to clean up)");
    console.log("── Cleanup complete ────────────────────────────────────────");
    return { failed, failures };
  }

  // Step 1: void all invoices first (handles POSTED/APPROVED that cannot be
  // hard-deleted directly).
  //
  // Retry once on "fetch failed" (ECONNREFUSED): after a long-running spawnSync
  // (e.g. Suite 15/16 vitest subprocesses) the underlying HTTP connection pool
  // may have stale connections that fail on the first attempt but succeed after
  // a short pause.
  for (const id of createdInvoiceIds) {
    let lastErr = null;
    let succeeded = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        // Brief pause before retry to let the connection pool recover.
        await new Promise((r) => setTimeout(r, 800));
      }
      try {
        const { status } = await api("POST", `/invoices/${id}/void`, {
          reason: "Smoke-test cleanup — automated removal after run",
        });
        if (status === 200 || status === 404) {
          // 200 = voided, 404 = already gone — both are fine
          succeeded = true;
          break;
        } else {
          const msg = `cleanup: void invoice ${id} returned unexpected status ${status} (expected 200 or 404 — voucher/approval state may be blocking void)`;
          console.error(`  ✗ FAIL: ${msg}`);
          failed++;
          failures.push(msg);
          succeeded = true; // don't retry non-network errors
          break;
        }
      } catch (err) {
        lastErr = err;
        // Only retry on network-level errors (fetch failed / ECONNREFUSED).
        if (!err.message?.includes("fetch failed") && !err.message?.includes("ECONNREFUSED")) {
          break;
        }
        console.warn(`  ⚠ void invoice ${id} attempt ${attempt + 1} threw "${err.message}" — ${attempt < 1 ? "retrying…" : "giving up"}`);
      }
    }
    if (!succeeded && lastErr) {
      const msg = `cleanup: void invoice ${id} threw unexpectedly: ${lastErr.message}`;
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
      failures.push(msg);
    }
  }

  // Step 2: hard-delete all invoices (now that they're VOIDED or never POSTED).
  for (const id of createdInvoiceIds) {
    try {
      const { status } = await api("DELETE", `/invoices/${id}`, {
        confirm: true,
      });
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted invoice ${id}`);
      } else {
        const msg = `cleanup: delete invoice ${id} returned unexpected status ${status} (expected 200 or 404 — possible FK constraint gap)`;
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
        failures.push(msg);
      }
    } catch (err) {
      const msg = `cleanup: delete invoice ${id} threw unexpectedly: ${err.message}`;
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
      failures.push(msg);
    }
  }

  // Step 3: hard-delete source documents (invoices are gone so the cascade is safe).
  for (const id of createdSourceDocIds) {
    try {
      const { status } = await api("DELETE", `/source-documents/${id}`, { confirm: true });
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted source document ${id}`);
      } else {
        const msg = `cleanup: delete source document ${id} returned unexpected status ${status} (expected 200 or 404 — possible FK constraint gap)`;
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
        failures.push(msg);
      }
    } catch (err) {
      const msg = `cleanup: delete source document ${id} threw unexpectedly: ${err.message}`;
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
      failures.push(msg);
    }
  }

  // Step 4: delete any object paths that were uploaded but never linked to a
  // source document (orphan uploads from runs that failed mid-way through
  // Stage 1c of Suite 4).  Source-doc-linked blobs are already cleaned up by
  // Step 3, so this only fires when that step was skipped.
  for (const objPath of orphanedObjectPaths) {
    try {
      // objPath is already the /objects/... form; strip the leading /objects/
      // to match the wildcard route DELETE /storage/objects/*path.
      const routePath = objPath.replace(/^\/objects\//, "");
      const { status } = await api("DELETE", `/storage/objects/${routePath}`, undefined);
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted orphaned object ${objPath}`);
      } else {
        const msg = `cleanup: delete orphaned object ${objPath} returned unexpected status ${status} (expected 200 or 404 — missing deletion route or storage error)`;
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
        failures.push(msg);
      }
    } catch (err) {
      const msg = `cleanup: delete orphaned object ${objPath} threw unexpectedly: ${err.message}`;
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
      failures.push(msg);
    }
  }

  // Step 5: delete export batches created during this run.
  for (const id of createdExportBatchIds) {
    try {
      const { status } = await api("DELETE", `/exports/${id}`, undefined);
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted export batch ${id}`);
      } else {
        const msg = `cleanup: delete export batch ${id} returned unexpected status ${status} (expected 200 or 404 — possible missing deletion route)`;
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
        failures.push(msg);
      }
    } catch (err) {
      const msg = `cleanup: delete export batch ${id} threw unexpectedly: ${err.message}`;
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
      failures.push(msg);
    }
  }

  // Step 6: delete all vendors (invoices are gone so the FK check passes).
  for (const id of createdVendorIds) {
    try {
      const { status } = await api("DELETE", `/vendors/${id}`, { confirm: true });
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted vendor ${id}`);
      } else {
        const msg = `cleanup: delete vendor ${id} returned unexpected status ${status} (expected 200 or 404 — possible FK constraint gap)`;
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
        failures.push(msg);
      }
    } catch (err) {
      const msg = `cleanup: delete vendor ${id} threw unexpectedly: ${err.message}`;
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
      failures.push(msg);
    }
  }

  console.log("── Cleanup complete ────────────────────────────────────────");
  return { failed, failures };
}
