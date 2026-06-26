---
name: AP file-import semantics & admin-only enforcement
description: Non-obvious policy constraints for the Invoice Capture file-import pipeline (correction = update-only; vendor import admin-only under a no-auth pilot).
---

# AP file-import semantics

Rules the import pipeline (`artifacts/api-server/src/services/importService.ts`,
`routes/imports.ts`) must keep satisfying:

- **`INVOICE_CORRECTION` updates existing invoices in place; it never creates
  them.** Match by `vendorId + invoiceNumber` (excluding VOIDED), apply only the
  provided non-empty fields, and **reject** any row with no matching existing
  invoice.
  **Why:** a "correction" that inserts new invoices silently duplicates AP
  documents and pollutes the approval queue — the whole point is to amend an
  existing record. An earlier build did the opposite (inserted new, rejected
  matches); do not regress to that.

- **Vendor master import is admin-only, enforced via a required recorded actor.**
  `POST /imports` with `importType=VENDOR_MASTER` returns HTTP 403 unless a
  non-empty `uploadedBy` actor is supplied; the UI also disables commit until one
  is entered.
  **Why:** the project is an internal pilot with **no auth system** (actor/owner
  are free-text, like the existing `editorRole`). A self-asserted, recorded actor
  is the strongest honest enforcement available; do not invent a fake role/auth
  gate, but do not drop the requirement either.

- **Never auto-create vendors from extraction.** Vendors only enter via the
  admin vendor-master import.

**How to apply:** when touching import validation/commit or adding new import
types, preserve these semantics and keep the forbidden-terms rule (no "ERP
Posted/Synced/Sent to ERP" in UI; use Export Ready/Exported/Failed/Blocked).
