# Phase 1 UAT Exit Report — Invoice Data Extractor (Invoice Capture MVP)

**Date:** June 26, 2026
**Scope:** Phase 1 exit-gate validation only. No Phase 2 features were built or tested.
**Test environment:** Development environment, API at `http://localhost:8080/api`, seeded PostgreSQL (14 baseline invoices, 568 vendors).
**Test method:** Live API-driven UAT (create → exercise → clean up), with all test rows removed and the database verified back to its baseline after each scenario. Static review of routes/services for paths that cannot be safely driven live.

---

## 1. Executive Summary

| Item | Result |
|---|---|
| **Overall verdict** | **CONDITIONAL PASS** |
| Functional areas validated | 16 |
| Functional areas PASS | 15 |
| Functional areas OPEN (cannot certify in this environment) | 1 (Edge browser runtime) |
| Test scenarios executed | 27 |
| Scenarios PASS | 27 |
| Scenarios FAIL | 0 |
| Extraction accuracy | **Not measured — labeled test pack required** (see §4) |
| Defects found | 1 (Medium) — **fixed this cycle** |
| Critical / High defects open | 0 |
| Medium / Low defects open | 0 functional; 5 documented risks (see §6) |

**Recommendation:** Proceed to a **controlled Phase 1 pilot** subject to two exit conditions:
1. Run the labeled extraction test pack and confirm accuracy meets the agreed threshold (currently unmeasured — this is the single hard gap).
2. Perform a one-time manual confirmation of inline PDF rendering in Microsoft Edge (headers are correct; the browser could not be driven from this environment).

No critical or high-severity defects were found. The one Medium defect identified (vendor autocomplete could not reach the full vendor list) was fixed and re-verified during this cycle.

---

## 2. Feature Checklist (16 areas)

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | Document upload & storage | PASS | Files stored via server-proxied object storage; private by default. |
| 2 | Extraction pipeline (run, status, retry) | PASS | Async extraction; status transitions observed; re-validation on completion. |
| 3 | Field extraction & population | PASS (accuracy unmeasured) | 9/10 real-batch invoices fully populated; see §4. |
| 4 | Extraction review / manual edit | PASS | Field edits persist and are audited (`FIELD_UPDATED`). |
| 5 | Vendor matching (auto) | PASS | Threshold 0.85; high-confidence auto-assign, low-confidence routed to review. |
| 6 | Vendor autocomplete (name/code/alias) | PASS | Searches name, code, and aliases; full list now loaded (defect D-01 fixed). |
| 7 | Validation engine | PASS | Amount, vendor, duplicate, tie-out, due-date/terms checks enforced. |
| 8 | Duplicate detection guard | PASS | Exact-block + fuzzy-warn; voided peers ignored; see §3 / D2. |
| 9 | Exception queue & resolution | PASS | Exceptions surfaced; vendor edit modal loads full vendor list. |
| 10 | Approval workflow | PASS | No-vendor approval blocked (422, non-overridable). |
| 11 | Voucher assignment & posting | PASS | `V-12345` accepted; voucher moves invoice to POSTED. |
| 12 | Posted-invoice immutability | PASS | Status change and hard-delete both blocked on POSTED (422). |
| 13 | Void / soft-removal | PASS | Requires reason; excluded from lists, KPIs, export, duplicate checks. |
| 14 | CSV export | PASS | 31 columns incl. all required; voided excluded; CSV-injection protection. |
| 15 | KPI / stats dashboard | PASS | Stats match DB ground truth exactly; voided excluded. |
| 16 | Inline document viewer (Edge) | **OPEN** | Storage headers correct (inline, nosniff, CSP, no X-Frame-Options); Edge browser runtime could not be driven here — needs manual confirm. |

---

## 3. Test Results Table

| ID | Scenario | Expected | Result | Status |
|---|---|---|---|---|
| D2-A | Exact duplicate: same resolved vendor + same invoice number | 409 with exact duplicate message | 409, exact message | PASS |
| D2-B1 | Unresolvable vendor name, new number | 201, vendorId null, no false duplicate | 201, vendorId null | PASS |
| D2-B2 | Same number + similar (not identical) names | `duplicate_check=WARNING`, vendor not auto-assigned | WARNING, no auto-assign | PASS |
| D2-C | Void active peer, then re-create | 201 (voided peer ignored); active dup still 409 | 201 then 409 | PASS |
| D2-D | Duplicate blocked, independent clean invoice | Dup 409; clean invoice `duplicate_check=PASS` | 409 + independent PASS | PASS |
| AP-1 | Approve invoice with no vendor | 422, non-overridable even with reason | 422 ("Low Vendor Match Confidence") | PASS |
| AP-2 | Voucher before approval | 422 | 422 | PASS |
| AP-3 | Approve valid invoice | 200 → APPROVED | 200, APPROVED | PASS |
| AP-4 | Assign voucher `V-12345` | 200 → POSTED, voucherId set | 200, POSTED, `V-12345` | PASS |
| AP-5 | Approve blocked when due date/terms missing | 422 | 422 (due date underivable) | PASS |
| IM-1 | Status change on POSTED (id4 seed) | 422 | 422 | PASS |
| IM-2 | Status change on POSTED (fresh) | 422 | 422 | PASS |
| IM-3 | Hard-delete POSTED + confirm:true (id4) | 422 (posted cannot be deleted) | 422 | PASS |
| IM-4 | Hard-delete POSTED + confirm:true (fresh) | 422 | 422 | PASS |
| IM-5 | Hard-delete without confirm | 422 (must confirm) | 422 | PASS |
| EX-1 | CSV export column set | 31 cols incl. all required | 31 cols, all present | PASS |
| EX-2 | CSV posted-only count | 1 row (id4) | 1 row | PASS |
| EX-3 | Voided excluded from export | excluded | excluded | PASS |
| EX-4 | Export disposition | attachment | attachment | PASS |
| EX-5 | CSV-injection protection | leading `=+-@` neutralized | code-verified | PASS |
| KPI-1 | Stats vs DB ground truth | exact match | exact match | PASS |
| KPI-2 | Voided excluded from KPIs | excluded | excluded | PASS |
| VN-1 | Vendor search by name | returns vendor | returns vendor | PASS |
| VN-2 | Combobox search by code | matches client-side | matches (full list loaded) | PASS |
| VN-3 | Combobox search by alias | matches client-side | matches (full list loaded) | PASS |
| ST-1 | Edge storage headers (inline) | inline, nosniff, CSP, no XFO | all present | PASS |
| ST-2 | Edge storage headers (download=1) | attachment | attachment | PASS |
| TD-1 | Teardown | DB restored to 14-row baseline | restored, stats match | PASS |

---

## 4. Extraction Accuracy Scorecard

**Accuracy: Not measured — a labeled ground-truth test pack is required to certify extraction accuracy.**

No labeled test pack (documents with known correct field values) was available, so true field-level accuracy (precision/recall against ground truth) cannot be computed. The figures below are **self-reported model confidence and field-population coverage** from the real 10-invoice batch (source document #4, invoices 30–39). They indicate the pipeline is functioning but are **not** a substitute for measured accuracy.

| Metric (real 10-invoice batch) | Result |
|---|---|
| Invoices with vendor name populated | 10 / 10 |
| Invoices with invoice number populated | 10 / 10 |
| Invoices with invoice date populated | 10 / 10 |
| Invoices with due date or payment terms | 9 / 10 (id36 missing) |
| Invoices with total amount populated | 10 / 10 |
| Currency detected | 10 / 10 (USD) |
| Self-reported confidence range | 0.95 – 1.00 |

**Required to close:** supply a labeled test pack and re-run extraction to produce a measured per-field accuracy table (target threshold to be agreed with the business).

---

## 5. Defect Log

| ID | Severity | Area | Description | Status |
|---|---|---|---|---|
| D-01 | Medium | Vendor autocomplete | Combobox loaded only a capped window of vendors (500 on review, 100 on exception queue) out of 568, so vendors outside the window were unreachable by name, code, or alias — even though client-side ranking correctly searches all three fields. | **FIXED & VERIFIED** — vendor list now loads in full (limit raised to 1000); `limit=1000` confirmed to return all 568 vendors. |

No critical, high, or open defects.

---

## 6. Remaining Risks

| # | Risk | Severity | Mitigation / Note |
|---|---|---|---|
| R-1 | **Extraction accuracy uncertified** — no labeled test pack, so accuracy is unmeasured. | High (gate) | Run labeled test pack before/early in pilot; treat measured accuracy as a hard exit condition. |
| R-2 | **Edge inline rendering not driven** — headers are correct but the Edge browser runtime could not be exercised from this environment. | Medium | One-time manual confirmation of inline PDF view in Edge. |
| R-3 | **PO matching is presence-only** — `po_header` reference table is empty (0 rows); PO check cannot validate against real POs. | Medium | Acceptable for Phase 1 if PO matching is out of scope; confirm with business. |
| R-4 | **Fuzzy duplicates are non-blocking** (warning only, riskScore ~0.7). | Low | By design; reviewers must act on warnings. |
| R-5 | **Inactive / on-hold vendors untested** — all 568 seeded vendors are active and not on hold. | Low | Add inactive/on-hold fixtures to confirm they are excluded from auto-match. |
| R-6 | **No authentication layer** on the API. | Medium | Acceptable only for internal pilot; add auth before broader rollout. |

Additional minor observations (non-blocking): seed invoices id1–4 have null validation columns; server-side `/vendors` search matches `vendorName` only (the combobox compensates with client-side name/code/alias ranking over the full list).

---

## 7. Phase 1 Exit Decision

**Decision: CONDITIONAL PASS — approved for a controlled Phase 1 pilot.**

All 16 functional areas were validated; 15 PASS and 1 (Edge browser runtime) OPEN with correct underlying configuration. All 27 executed scenarios passed. No critical or high defects exist; the single Medium defect (D-01) was fixed and re-verified within this cycle. The database was returned to its exact baseline after testing.

Two conditions must be satisfied to convert this to a full Phase 1 pass:

1. **Measure extraction accuracy** using a labeled test pack and confirm it meets the agreed threshold (currently *Not measured*).
2. **Manually confirm inline PDF rendering in Microsoft Edge** (storage headers are already correct).

Until both are closed, the recommendation is a limited, supervised pilot rather than unrestricted rollout.

---

*Prepared by automated Phase 1 UAT execution against the live API. All test data created during this exercise was removed; final database state matches the 14-invoice baseline (6 EXCEPTION, 7 PENDING_APPROVAL, 1 POSTED) and the stats endpoint matches DB ground truth.*
