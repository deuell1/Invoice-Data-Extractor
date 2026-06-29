---
name: Vendor cleanup utility
description: Safe imported-vendor cleanup design (preview/commit, modes, blocking rules, import stamping)
---
Imported-vendor cleanup for Invoice Capture.

**Import stamping (critical):** `/vendors/import` must stamp every inserted vendor with
`importBatchId` (the batch's `batchId`) and `lastImportedAt: new Date()` and must also
create an `import_batch` record with `importType = "VENDOR_MASTER"`. These are the ONLY
fields `loadImportedVendors()` uses to detect imported vendors. Without them, preview
always returns 0 and cleanup is blind.

- "Imported" vendor = `importBatchId IS NOT NULL OR lastImportedAt IS NOT NULL`.
- Blocking references: `invoice_capture.vendorId` (FK) and `po_header.vendorCode` (by code). A vendor with either ref is referenced and must NEVER be deleted.
- Modes: DELETE_SAFE (delete unreferenced imported only), DELETE_AND_DEACTIVATE (delete unreferenced + deactivate referenced), FULL_RESET (delete all imported; blocked 409 if ANY imported vendor is referenced).
- Deactivation sets a fixed note and is reversible; deletes are transactional with audit-log rows per vendor + a vendor_cleanup_log run row.
- import_batch.cleanupStatus: ACTIVE → PARTIALLY_CLEANED (some deleted but some remain) / FULLY_CLEANED (total=0 remaining) / RETAINED (remaining vendors all retained-by-reference, nothing deleted this run).
- Commit requires actor + reason + confirm=true; default body is a no-op preview.
- batchId format: `VND-{randomUUID()}`.

**Why:** referenced vendors carry live AP history; deleting them would orphan invoices/POs. Deactivate-instead-of-delete preserves referential integrity while still clearing test/pilot data.
**How to apply:** any new cleanup entry point must re-run the reference check server-side; never trust client-selected vendor IDs for deletion. Any new import route (CSV upload variant etc.) must also stamp importBatchId + lastImportedAt.
