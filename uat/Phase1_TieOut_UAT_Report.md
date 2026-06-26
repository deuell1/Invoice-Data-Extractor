# Phase 1 Tie-Out — Focused UAT Report

**Product:** Invoice Data Extractor (Invoice Capture MVP)
**Scope:** Phase 1 header tie-out hardening only (no Phase 2 features)
**Environment:** Development API (`/api`) + dev web preview
**Execution date:** 2026-06-26
**Method:** Live API exercised with disposable test invoices (created → tested → hard-deleted); review-screen display verified by screenshot; regression verified by endpoint spot-checks. All test data removed and database confirmed back to baseline.

---

## 1. Executive Summary

| Metric | Result |
|---|---|
| **Overall tie-out UAT verdict** | **PASS** |
| Test cases executed | 17 (TO-01 → TO-17) |
| Passed | 17 |
| Failed | 0 |
| Critical defects open | 0 |
| High defects open | 0 (1 High found **and fixed** during UAT — see DEF-01) |
| **Phase 2 recommendation** | **Ready for Phase 2** |

The tie-out engine computes the expected total correctly across PASS / WARNING / FAIL / SKIPPED, subtracts discounts exactly once (regardless of sign), adds positive and negative other-charges correctly, and produces a clear plain-language explanation. A material mismatch (FAIL) is a hard block on approval that **cannot** be exception-overridden; WARNING and SKIPPED remain approvable. Manual amount edits persist, re-run validation, refresh the tie-out result, and are written to the audit trail. CSV export includes all ten required amount/tie-out columns. KPI/queue counts move correctly and no new Phase 2 dashboards were added.

One real defect was discovered from the running logs at the start of UAT (`GET /api/source-documents/:id` returned HTTP 500 once tie-out fields were populated) and was fixed as a true Phase 1 tie-out defect, then re-verified. See the Defect Log.

**Baseline integrity:** Pre-UAT and post-UAT stats are identical — `total 14, pendingExtraction 0, exception 5, pendingApproval 4, approved 4, posted 1, needsReview 1, totalApprovedAmount $26,978.76`. All 6 temporary invoices were hard-deleted (cleanup 6/6, 0 failures).

---

## 2. Tie-Out Test Results Table

| Test ID | Scenario | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|
| TO-01 | Subtotal + tax = total | Expected 107.50, diff 0.00, **PASS** | Expected 107.50, diff 0.00, **PASS** | PASS | Explanation shows full formula |
| TO-02 | Subtotal + tax + freight = total | Expected 119.50, diff 0.00, **PASS** | Expected 119.50, diff 0.00, **PASS** | PASS | Freight added |
| TO-03 | Subtotal + tax + freight − discount = total | Expected 209.00, diff 0.00, **PASS**, discount once | Expected 209.00, diff 0.00, **PASS** | PASS | Discount subtracted exactly once |
| TO-04 | Subtotal + other charges = total | Expected 318.25, diff 0.00, **PASS** | Expected 318.25, diff 0.00, **PASS** | PASS | Other charges added |
| TO-05 | Minor rounding diff (0.03) | Expected 107.50, diff 0.03, **WARNING**, not blocked | Expected 107.50, diff 0.03, **WARNING**, status PENDING_APPROVAL | PASS | Warning visible, not blocked |
| TO-06 | Material mismatch (7.50) | Expected 107.50, diff 7.50, **FAIL**, EXCEPTION, approve blocked | diff 7.50, **FAIL**, EXCEPTION, **approve HTTP 422** | PASS | 422 error states expected, total & difference; override attempt rejected |
| TO-07 | Missing subtotal, total present | **SKIPPED**, expected/diff null, not false FAIL, routed to review | **SKIPPED**, expected/diff null, status PENDING_APPROVAL (review) | PASS | Explanation: "subtotal is missing" |
| TO-08 | Missing total amount | **SKIPPED**, explanation mentions total, EXCEPTION, approve blocked | **SKIPPED**, amountCheck FAIL, EXCEPTION, **approve HTTP 422** | PASS | Explanation: "invoice total is missing"; blocked on missing total |
| TO-09 | Discount as negative (−25) | Treated as reduction, expected 209.00, **PASS** | Expected 209.00, diff 0.00, **PASS** | PASS | Magnitude used; not added |
| TO-10 | Discount/credit in parentheses `(25.00)` | Parsed as a discount reduction, **PASS** when total matches | Verified by inspection of extraction `toNum` (parentheses → negative; magnitude then reduces total); runtime equivalent proven by TO-09/TO-12 | PASS* | *Live extraction of a parenthesized PDF is an OPEN manual step (see Remaining Risks) |
| TO-11 | Other charges / surcharge | Expected 515.75, diff 0.00, **PASS** | Expected 515.75, diff 0.00, **PASS** | PASS | Surcharge added |
| TO-12 | Negative other charge / credit (−10) | Expected 490.00, diff 0.00, **PASS** | Expected 490.00, diff 0.00, **PASS** | PASS | Negative other charge reduces expected |
| TO-13 | Manual edit refreshes tie-out (FAIL→PASS) | Save persists, validation reruns, status FAIL→PASS, audit logs edit, approvable | tieOut FAIL→**PASS**, audit FIELD_UPDATED present, **approve HTTP 200**, final APPROVED | PASS | Edit-then-reconcile flow works end to end |
| TO-14 | Review screen display | Header Tie-Out panel shows all amounts + Expected + Difference + Status + Explanation; statuses visually distinct; AP-readable | Panel shows Subtotal/Tax/Freight/Discount/Other/Total inputs, FAIL badge (red), Expected $7148.75, Difference −$3550.00, plain-language explanation; PASS=green / FAIL=red badges distinct | PASS | Verified by screenshot (inv 38 FAIL, inv 39 PASS) |
| TO-15 | CSV export includes tie-out fields | Header has Subtotal, TaxAmount, FreightAmount, DiscountAmount, OtherChargesAmount, TotalAmount, TieOutExpectedTotal, TieOutDifference, TieOutStatus, TieOutExplanation | All 10 columns present; approved test invoice row exported | PASS | Injection protection & voided-exclusion unchanged (see TO-17) |
| TO-16 | KPI / queue impact | FAIL → exception count; WARNING → needs-review count; counts update; no new dashboards | exception 6→7, needsReview 4→5 during test; reverted on cleanup | PASS | Existing dashboard only |
| TO-17 | Regression | Core Phase 1 workflows still work | list, stats, vendor autocomplete, CSV export, source-documents all HTTP 200; create/patch/submit/approve/void/delete exercised during runs | PASS | Source-documents fixed (was 500 — DEF-01) |

---

## 3. Defect Log

| Defect ID | Severity | Description | Steps to Reproduce | Expected Behavior | Actual Behavior | Status | Recommended Fix |
|---|---|---|---|---|---|---|---|
| DEF-01 | High | `GET /api/source-documents/:id` returned HTTP 500 once any child invoice had tie-out numeric fields populated, breaking the review screen's batch context / Prev–Next navigation for split documents. | `GET /api/source-documents/4` after invoices had `discountAmount`/`otherChargesAmount`/`tieOutExpectedTotal`/`tieOutDifference` set. | Endpoint returns 200 with serialized invoices. | 500 — `GetSourceDocumentResponse.parse` threw ZodError "Expected number, received string" because the source-document serializer never cast the four new tie-out numeric columns. | **Fixed & verified** (now HTTP 200) | Add `Number()` casts for `discountAmount`, `otherChargesAmount`, `tieOutExpectedTotal`, `tieOutDifference` in `serializeSourceInvoice` — done. |

No Critical, no open High, no Medium, no Low defects.

---

## 4. Regression Results

All core Phase 1 workflows remain functional after the tie-out changes:

| Area | Result |
|---|---|
| Upload / invoice creation | PASS (test invoices created via API) |
| Extraction (sync vendor-match path) | PASS |
| Vendor matching | PASS (controlled vendor assigned, validation green) |
| Vendor autocomplete / search | PASS (HTTP 200) |
| Duplicate detection | PASS (exercised via create/patch dedup guard) |
| Exception queue routing | PASS (FAIL/blocking → EXCEPTION) |
| Review screen save | PASS (PATCH persists + revalidates) |
| Approval workflow | PASS (submit → approve; blocks on FAIL/blocking) |
| VoucherID / posting path | Not re-posted in this run (1 POSTED baseline invoice intact); posting guard unchanged |
| Void / remove / delete | PASS (hard-delete cleanup 6/6; void route unchanged) |
| CSV export | PASS (10 tie-out columns; injection protection & voided-exclusion intact) |
| KPI dashboard | PASS (counts move and revert; no new dashboards) |

Baseline confirmed restored after cleanup (14 invoices, identical status distribution and approved total).

---

## 5. Remaining Risks

1. **Extraction accuracy (data risk, not tie-out logic).** Parenthesis/negative parsing logic (`toNum`) is correct by inspection and the reconciliation math is proven via API (TO-09/TO-12). However, **end-to-end extraction of a real parenthesized-discount PDF (TO-10) was not driven in this environment** and remains an OPEN manual step. *Manual step:* upload a PDF whose discount/credit is shown as `(25.00)`, run extraction, open the review screen, and confirm Discount Amount stores `25.00` (or `−25.00`) and the tie-out reconciles. A broader extraction-accuracy certification harness already exists under `uat/extraction-accuracy/`.
2. **Edge runtime confirmation.** The review-screen tie-out panel was verified in the standard preview browser. Microsoft Edge rendering of the panel/badges was not separately driven — run `uat/edge-rendering-checklist.md` in Edge as a one-time manual confirmation.
3. **Missing-total override behavior (pre-existing, out of tie-out scope).** A missing total routes to EXCEPTION and is blocked without a reason (TO-08 verified). The generic exception-override path (with a documented reason) is governed by existing Phase 1 amount rules rather than the tie-out hard block; if AP policy requires total to be strictly non-overridable, that is a separate amount-validation decision, not a tie-out defect.

---

## 6. Phase 2 Readiness Recommendation

**Ready for Phase 2.**

All 17 tie-out UAT cases pass with captured evidence, there are no open Critical or High defects (the single High found during UAT was fixed and re-verified), regression is clean, and the database was returned to baseline. The two remaining items (extraction-accuracy certification and Edge runtime confirmation) are data/environment inputs with documented manual steps and do not block Phase 2; they can proceed in parallel.
