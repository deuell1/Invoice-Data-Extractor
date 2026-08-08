---
name: Invoice removal / cleanup model
description: Conventions for voiding/removing/hard-deleting invoices and source documents and keeping them out of active views.
---

# Removal model (invoice-capture)

Invoices have a soft-removed terminal state `VOIDED` (an `invoiceStatusEnum`
value). Source documents have no removed enum value (their enum is
processing-only) — they use a `removedAt` timestamp marker instead. Both tables
carry `removedAt / removedBy / removalReason / removalNote`.

**Rule: VOIDED is excluded by default everywhere it would pollute active work.**
Any new query over invoices that feeds a queue, KPI/stat, export, or duplicate
check must exclude `VOIDED` unless the caller explicitly opts in
(`includeRemoved=true` or an explicit `status=VOIDED` filter). Source-doc
payloads expose a separate `removedCount`; active counts exclude voided children.

**Why:** the whole point of the cleanup feature is that bad uploads / test data
stop affecting metrics and worklists. A new code path that forgets the filter
silently re-pollutes those surfaces.

**Hard delete vs void:**
- Void/remove is always allowed (any status, incl. POSTED).
- Hard delete is blocked for POSTED invoices and for source docs with any POSTED
  child. It requires explicit `confirm`.

**How to apply / safety invariants:**
- Multi-step remove/delete (and invoice hard delete) must run inside
  `db.transaction(...)` (node-postgres driver supports it) so a mid-operation
  failure can't leave a source flagged-removed with only some children voided,
  or audit rows deleted while invoices remain.
- A stored object file is deleted only when **no** `invoice_capture` and **no**
  `source_documents` row still references that `fileObjectPath` (cross-table
  guard — see `deleteFileIfUnreferenced` in routes/invoices.ts and the inline
  guard in `deleteSourceDocument`). File deletion is best-effort and happens
  after the DB transaction commits.

**Lesson — hard deletes and FK dependents:** every code path that hard-deletes an invoice (direct delete AND source-document cascade) must clear all FK-dependent rows in the same transaction; when a new invoice-linked table is added, all delete paths must be updated together or cleanup regresses to 500s. Unknown FK failures should surface as clean conflicts, never raw DB errors. VOIDED invoices still hold their vendor FK, so "no active references" is not "no references" — referenced vendors are deactivated, never deleted.
