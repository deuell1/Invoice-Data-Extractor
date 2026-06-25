---
name: Duplicate guard consistency (Invoice Capture)
description: Duplicate-invoice detection must be enforced identically across every state-changing entry point, not just one.
---

Duplicate detection (same controlled vendor + invoice number) must run and block at **every** entry point that can create or advance an invoice: create, manual-edit (PATCH), submit/validation, approve, and voucher/posting — plus the read-only check-duplicate endpoint must use the same status scope.

**Why:** Fixing only one gate leaves bypasses. A duplicate blocked at approval could still be posted via the voucher endpoint (which didn't re-validate), and an exception-override reason could push a duplicate to APPROVED. check-duplicate scanning only APPROVED/POSTED disagreed with create/patch/validation, which scan all active statuses.

**How to apply:**
- Exclude only `VOIDED`; check across all other active statuses (use `ne(status,'VOIDED')`, not `inArray(['APPROVED','POSTED'])`).
- Duplicate is a HARD block — place the `duplicateCheck === "FAIL"` guard at approval *before* the exception-override branch; it must never be overridable.
- Re-check at the voucher/posting endpoint too — an invoice can become a duplicate after approval when another invoice is created later.
- Resolve the controlled vendor from `vendorRawName` for detection only via `resolveVendorIdForDuplicate` (>=0.85 match). NEVER persist an OCR/AI-derived vendorId; assignment stays in `applyVendorMatch`.
- Keep the user-facing message in the single `DUPLICATE_MESSAGE` constant shared by routes and validation to prevent wording drift.
