---
name: Extraction failure routing
description: Why a failed extraction must flip invoice status, not just extractionStatus.
---

# Extraction failure routing

When automatic extraction fails, set `extractionStatus = "FAILED"` **and** route the
invoice `status` to `EXCEPTION` (with `exceptionReason` prefixed `Extraction Failed: `).

**Why:** `extractionStatus` and the workflow `status` are independent columns. Setting
only `extractionStatus = "FAILED"` leaves `status` at `PENDING_EXTRACTION`, so failed
invoices silently sit pending forever and never appear in any actionable queue.

**How to apply:** Guard the status flip — never downgrade an invoice already `APPROVED`
or `POSTED`. Persist safe error info in `extractionError` (user-facing message) and
`extractionErrorDetail` (JSON: invoiceId, documentId, attempt, fileType, category,
summary, timestamp). Never log/persist raw provider error messages — they may echo
auth headers/credentials; log only category/status/requestId.
