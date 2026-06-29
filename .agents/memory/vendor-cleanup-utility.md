---
name: Vendor cleanup utility
description: Safe imported-vendor cleanup design (preview/commit, modes, blocking rules)
---
Imported-vendor cleanup for Invoice Capture.

- "Imported" vendor = `importBatchId IS NOT NULL OR lastImportedAt IS NOT NULL`.
- Blocking references: `invoice_capture.vendorId` (FK) and `po_header.vendorCode` (by code). A vendor with either ref is referenced and must NEVER be deleted.
- Modes: DELETE_SAFE (delete unreferenced imported only), DELETE_AND_DEACTIVATE (delete unreferenced + deactivate referenced), FULL_RESET (delete all imported; blocked 409 if ANY imported vendor is referenced).
- Deactivation sets a fixed note and is reversible; deletes are transactional with audit-log rows per vendor + a vendor_cleanup_log run row.
- import_batch.cleanupStatus reflects ACTIVE / PARTIALLY_CLEANED / FULLY_CLEANED based on remaining imported vendors.
- Commit requires actor + reason + confirm=true; default body is a no-op preview.

**Why:** referenced vendors carry live AP history; deleting them would orphan invoices/POs. Deactivate-instead-of-delete preserves referential integrity while still clearing test/pilot data.
**How to apply:** any new cleanup entry point must re-run the reference check server-side; never trust client-selected vendor IDs for deletion.
