# Phase 1 UAT Defect Remediation — Completion Report

**Date:** June 25, 2026
**Scope:** Fix three Phase 1 UAT defects (D2 intake duplicate guard, D4 list-level Export CSV, Edge inline rendering) without rebuilding the app or adding Phase 2 features. All existing workflows preserved.

---

## 1. D2 — Duplicate guard now resolves vendor from `vendorRawName`
The intake guard no longer requires an explicit `vendorId`. A new `resolveVendorIdForDuplicate()` helper resolves the controlled `vendorId` from `vendorRawName` via `findBestVendorMatch` (only when the score meets the 0.85 vendor-match threshold: `matched`/`inactive`/`on_hold`). The resolved id is used **for detection only and is never persisted** — vendor assignment remains exclusively in `applyVendorMatch`, so OCR/AI never writes a `vendorId`.
- **Verified:** `POST /invoices` with only `vendorRawName="Acme Office Supplies Inc."` + existing number `ACME-2025-4411` → **409** "Duplicate invoice detected for this vendor and invoice number." A unique-number control created normally and resolved `vendorId:1` through the controlled lookup.

## 2. D2 — Detection runs at every entry point, ignores VOIDED, across active statuses
Duplicate detection now fires at create, manual-edit (PATCH), check-duplicate, and submit/validation. All paths use `isDuplicate()`/validation logic that excludes `VOIDED` and checks across all other active statuses (not just APPROVED/POSTED). The `check-duplicate` endpoint's exact and fuzzy steps were aligned to `ne(status,'VOIDED')` for consistency.
- **Verified:** `check-duplicate` on an exception-status duplicate returned `isDuplicate:true, matchedIds:[…], matchType:"exact"`, matching active non-VOIDED records.

## 3. D2 — Approval, posting, and export are hard-blocked on duplicates
Duplicate is now a **non-overridable hard block**: `POST /invoices/:id/approve` returns 409 with the canonical message when `duplicateCheck === "FAIL"`, *before* the exception-override branch — a documented reason can no longer push a duplicate to APPROVED. `PATCH /invoices/:id/voucher` re-checks for duplicates before posting (catches invoices that became duplicates after approval). Because export only includes APPROVED/POSTED (and excludes voided), blocking those transitions closes the export path too.
- **Verified:** approve of an EXCEPTION duplicate *with* an override reason → **409** (status unchanged); voucher/post of an APPROVED duplicate → **409** (status unchanged). The exact spec message is shared via a single `DUPLICATE_MESSAGE` constant to prevent drift.

## 4. D4 — Visible list-level "Export CSV" button with loading/error states
A list-level **Export CSV** control (dropdown: Approved / Posted, default **Approved**) was added to the invoice-list toolbar near the search field. It shows a spinner + "Exporting…" while in flight, downloads via blob fetch from the export endpoint, and surfaces success/error via toast. Voided invoices remain excluded and the server-side CSV formula-injection neutralization is unchanged.
- **Verified:** button renders in the UI; export endpoint returns `text/csv` (attachment) with the 31-column header and **0 VOIDED** rows; no regression in row counts.

## 5. Edge — Inline PDF/JPG/PNG and multi-invoice rendering confirmed
The storage proxy already serves preview-friendly headers for Microsoft Edge; this was verified against a real uploaded object (not seed placeholders). It overrides `Content-Type` from the `?name=` hint, sets `Content-Disposition: inline`, omits `X-Frame-Options`, sets `X-Content-Type-Options: nosniff` and a preview CSP, and falls back to `attachment` when `download=1`.
- **Verified:** PDF → `application/pdf` inline; PNG name hint → `image/png` inline; `download=1` → `attachment`. No code change required.

## 6. Quality gates and review
Both packages typecheck clean (`@workspace/api-server`, `@workspace/invoice-capture`). The API workflow was restarted and runtime probes pass. An architect code review initially flagged the approval/posting override gap and check-duplicate scope inconsistency; both were fixed and the **re-review returned PASS** — duplicate hard-blocking is now consistent across create/patch/approve/voucher/check-duplicate/validation, with vendorId never persisted from OCR and no new security regressions (CSV/header injection protections intact).

## 7. Scope discipline
No app rebuild and no Phase 2 features were introduced. Changes are confined to duplicate-resolution helpers and entry-point guards in the API, the Export CSV control in the web UI, and verification of the existing Edge-safe proxy. All three configured workflows remain intact. All test data created during verification was removed and the dataset restored to baseline.
