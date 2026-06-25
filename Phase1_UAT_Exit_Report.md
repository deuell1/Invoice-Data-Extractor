# Phase 1 UAT Exit Report — Invoice Data Extractor (Invoice Capture MVP)

**Report date:** June 25, 2026
**Scope:** Phase 1 acceptance validation (read-only test-and-report; defects fixed only where they block Phase 1 acceptance — none required)
**Environments tested:** API `http://localhost:8080/api`; Web app routes `/invoices`, `/invoices/:id`, `/exceptions`, `/approvals`
**Method:** Automated backend test harness (24 assertions), targeted API probes, live UI screenshots, and a Playwright interactive UI test. Dataset restored to baseline after every destructive probe.

---

## 1. Executive Summary

| Metric | Result |
|---|---|
| **Overall result** | **CONDITIONAL PASS** |
| Test cases executed | 13 (of 13) + 2 specialty suites (Vendor Autocomplete, Review Screen) |
| Passed | 11 cases fully + both specialty suites |
| Conditional pass | 2 cases (TC1 clean PDF, TC2 clean image — workflow verified, fresh end-to-end upload + accuracy-vs-ground-truth not certifiable in this environment) |
| Failed | 0 |
| Blocked | 0 (fresh-upload sub-steps limited by absence of a labeled test pack) |
| **Overall extraction accuracy** | **Not independently certifiable** — no controlled UAT test pack with ground-truth labels exists. System self-reported field confidence on sampled records was **0.95–1.00**, and on-screen values matched the rendered document on visual spot-check. The spec's ≥80% accuracy threshold therefore cannot be formally signed off. |
| **Critical defects** | **0** |
| **High defects** | **0** |
| Medium defects | 1 |
| Low defects | 3 |

**Verdict rationale.** Phase 1's *control and workflow* requirements were exercised and passed with concrete evidence across the areas tested: multi-invoice isolation, controlled vendor matching, exception routing, approval gating, VoucherID/Posted lifecycle, CSV export (including formula-injection safety), void/hard-delete cleanup, source-document cascade cleanup, KPI accuracy, audit logging, the review screen, vendor autocomplete, and Prev/Next navigation. The verdict is **Conditional** rather than a full Pass because three evidence items remain open (see "Evidence limitations" below): extraction accuracy cannot be certified against ground truth without a labeled UAT pack, a fresh end-to-end upload of a new PDF/image could not be performed, and two review-screen sub-checks (Edge inline rendering, per-invoice audit panel) were not directly exercised. No defect found rises to Critical or High severity.

### Evidence limitations (open gaps)

These are the specific items that prevent an unconditional Pass; all are environment/coverage limitations, not product failures:

1. **No labeled UAT test pack** — extraction accuracy cannot be measured against ground truth, so the spec's ≥80% header-field accuracy threshold cannot be formally certified.
2. **No source files for fresh upload** — TC1 (clean PDF) and TC2 (clean image) could not be run as true end-to-end new-file uploads; lifecycle/controls were verified on seeded/created records instead.
3. **Edge inline rendering not directly tested** — only Chromium was exercised (Edge is Chromium-based and the relevant headers are set, but Edge itself was not driven).
4. **Per-invoice audit panel not directly screenshotted** — backend audit logging per invoice is verified; the review-screen audit *panel* changing per invoice was not captured visually.

---

## 2. Feature Checklist

| # | Feature area | Status | Evidence |
|---|---|---|---|
| 1 | Upload (PDF/image) | ⚠️ Conditional | Upload endpoint validates required fields and creates records; lifecycle proven on seeded/created records. A fresh new-file upload could not be run (no source files available). |
| 2 | Source document handling | ✅ Pass | Source doc tracking, remove-with-reason (voids children), hard-delete cascade, POSTED-child block, file-safety flag all verified (TC10). |
| 3 | Multi-invoice detection | ✅ Pass | Source doc with 10 invoices → 10 records, sequences 1–10, page ranges 1–1…10–10, distinct vendors/invoice numbers (TC3/TC4). |
| 4 | Extraction (header fields) | ⚠️ Conditional | Header fields populate with per-field confidence; values match rendered document on spot-check. Accuracy-vs-ground-truth not certifiable (no labeled pack). Line items intentionally out of Phase 1 scope. |
| 5 | Vendor autocomplete | ✅ Pass | Live typing filters list ("fast", "van"); name/code/alias searchable; scrollable; selection persists controlled VendorID; re-validates. |
| 6 | Vendor matching (controlled) | ✅ Pass | Below-threshold match not auto-assigned → EXCEPTION; OCR never assigns VendorID directly; manual selection re-runs validation (TC5). |
| 7 | Validation rules | ✅ Pass | Vendor/Duplicate/Amount/Tie-out/PO checks render and gate workflow; negative total → EXCEPTION. |
| 8 | Review screen | ✅ Pass | Document viewer inline beside extracted data; per-field confidence; scoped re-run; data/validation change per invoice. |
| 9 | Exception queue | ✅ Pass | Exception routing for unknown/missing vendor, duplicate, low-confidence, negative total; queue surfaces records needing review. |
| 10 | Cleanup / remove / delete | ✅ Pass | Void requires reason; removed excluded from queues/export/KPI; "Show removed" toggle; hard-delete requires confirm; POSTED hard-delete blocked (TC9/TC10). |
| 11 | Approval | ✅ Pass | Voucher before approval blocked; direct status→APPROVED blocked; exception approval requires documented reason; POSTED immutable (TC11). |
| 12 | CSV export | ✅ Pass | One row per record; all required columns present; posted row included; voided excluded; formula-injection neutralized (TC12). |
| 13 | VoucherID posting | ✅ Pass | Voucher only on APPROVED/POSTED; `V-12345` format accepted; approve→voucher→POSTED; POSTED cannot be moved by general status change (TC11). |
| 14 | KPI dashboard | ✅ Pass | Counts reflect active invoices only; voided excluded; exception/needs-review/posted/approved counts accurate; exception rate shown (TC13). |

Legend: ✅ Pass · ⚠️ Conditional · ❌ Fail

---

## 3. Test Case Results

| TC | Description | Expected | Actual | Result | Defects | Notes |
|---|---|---|---|---|---|---|
| 1 | Clean single-invoice PDF | Upload→1 source doc→1 record→viewable→header extract→vendor match→validate→approve→export→voucher after approval→Posted | Approval/voucher/post/export lifecycle all verified on records; upload endpoint validates & creates. Fresh new-PDF upload + accuracy-vs-truth not run. | ⚠️ Conditional | — | No source files in env; lifecycle proven, fresh upload not. |
| 2 | Clean image invoice | Upload→1 record→image displays→header extract→review workflow | Image single-invoice path supported; multi-invoice image → EXCEPTION by design. Fresh image upload not run; viewer renders inline for existing docs. | ⚠️ Conditional | — | Same environment limitation as TC1. |
| 3 | Multi-invoice PDF, same vendor | 1 source doc, N records, sequence, page ranges, independent approve/export/post | 10 records, seq 1–10, page ranges per invoice; each independently actionable | ✅ Pass | — | Strong isolation evidence. |
| 4 | Multi-invoice PDF, different vendors | Each gets own vendor match; autocomplete independent; no data crossover | Distinct vendors/invoice numbers per record (e.g. Fastenal seq1 vs Rice Lake seq10); no crossover | ✅ Pass | — | Verified across full 10-invoice doc. |
| 5 | Unknown vendor | VendorRawName extracts; no auto VendorID; route to exception/review; manual select re-validates | Below-threshold not auto-assigned → EXCEPTION; manual select re-runs validation | ✅ Pass | — | Controlled-lookup enforced. |
| 6 | Missing/unreadable vendor | Flagged; clear reason; approval blocked until corrected | Routed to EXCEPTION; approval hard-blocked (non-overridable) without controlled vendor | ✅ Pass | — | Vendor block is a true hard-block. |
| 7 | Duplicate invoice | Detection via VendorID+InvoiceNumber; blocked/routed; warning references matched record | check-duplicate → `isDuplicate:true, matchedIds:[4], matchType:exact`; submit → EXCEPTION "Duplicate invoice (same vendor + invoice number)"; approve without reason blocked | ✅ Pass | D1, D2 | Duplicate IS flagged + override-gated. See D1 (overridable via documented reason) and D2 (intake-guard gap, covered by validation). |
| 8 | Low-confidence / bad scan | Confidence visible; low fields highlighted; route to Needs Review/Exception; manual correct; audit edits | Per-field confidence captured & displayed; low-confidence routing; edits audited | ✅ Pass | — | Field-confidence persisted. |
| 9 | Bad upload cleanup | Void w/ required reason; removed off active queues/export/KPI; viewable via toggle; hard-delete after confirm; POSTED not hard-deletable | All verified incl. injection-safe export exclusion and POSTED hard-delete block | ✅ Pass | — | "Show removed" toggle confirmed in UI. |
| 10 | Source document cleanup | Remove w/ reason voids children; hard-delete if no posted child; no orphan invoice/audit; safe file deletion | remove → children VOIDED + doc flagged; hard-delete → cascade `deletedInvoiceIds:[…]`, `fileDeleted:true`; POSTED child → 422 block; no-confirm → 422 | ✅ Pass | — | Fresh evidence this cycle; dataset restored. |
| 11 | Approval control | No post without approval; no voucher before approval; approved accepts voucher; `V-12345` ok; posted immutable | All verified: voucher pre-approval blocked, direct APPROVED blocked, approve→V-12345→POSTED, POSTED status-change blocked | ✅ Pass | — | Core control suite. |
| 12 | CSV export | One row/record; multi-invoice→multi-row; required cols present; voided excluded; injection-safe | 31 columns incl. all required; posted included; voided excluded; `=`/formula cells neutralized | ✅ Pass | — | Required cols: SourceDocumentID, InvoiceSequence, PageStart, PageEnd, DocumentID, BusinessDocumentID, VendorID, InvoiceNumber, InvoiceTotal, Status, VoucherID. |
| 13 | KPI dashboard | Active-only counts; voided excluded; exception/pending-extraction/needs-review accurate; posted/approved if shown | Total 14, Exceptions 6, Pending Approval 7, Needs Review 1, Posted 1, Approved Value $8,750, Exception Rate 42.9% | ✅ Pass | — | Voided excluded from operational counts. |

### Specialty suite — Vendor Autocomplete UAT

| Sub-check | Result | Evidence |
|---|---|---|
| User can type in Vendor field | ✅ Pass | Playwright typed into combobox search input |
| List filters as user types | ✅ Pass | "fast" → Fastenal/FastFreight; "van" → updated live |
| Vendor name searchable | ✅ Pass | Name match confirmed |
| Vendor code searchable | ✅ Pass | Client-side scoring includes code (code path verified in component) |
| Vendor alias searchable | ✅ Pass | Scoring includes aliases (verified in component logic) |
| VendorRawName influences suggestions | ✅ Pass | Raw extracted name surfaced as separate field; drives default match |
| Dropdown scrollable | ✅ Pass | Constrained-height list with scroll confirmed |
| Selecting vendor saves controlled VendorID | ✅ Pass | Persisted VendorID on selection (TC5) |
| Selecting vendor reruns validation | ✅ Pass | Re-validation observed (TC5) |
| OCR never directly assigns VendorID | ✅ Pass | Below-threshold → EXCEPTION, never auto-assigned (TC5) |

### Specialty suite — Review Screen UAT

| Sub-check | Result | Evidence |
|---|---|---|
| Document viewer stays visible next to extracted data | ✅ Pass | Side-by-side panels in screenshots |
| Image/PDF loads inline (Chrome) | ✅ Pass | PDF renders inline in Chromium |
| Image/PDF loads inline (Edge) | ⚠️ Conditional | Only Chromium tested; Edge is Chromium-based and CSP/Content-Type headers are set, but Edge not directly exercised |
| Prev/Next smooth for AP review | ✅ Pass | Navigation responsive in Playwright run |
| Extracted data changes when invoice changes | ✅ Pass | inv1 FASTENAL/ILSTR151143 → inv2 Falcon Industries/0110992-IN |
| Validation messages change per invoice | ✅ Pass | Per-invoice validation badges observed |
| Audit log changes per invoice | ⚠️ Conditional | Backend audit captures per-invoice lifecycle (verified); per-invoice audit *panel* on review screen not directly screenshotted |
| Edits save to selected invoice only | ✅ Pass | PATCH scoped by invoice id |
| Re-run extraction scoped to selected invoice | ✅ Pass | Scoped Re-run Extraction control |
| Re-run vendor match scoped to selected invoice | ✅ Pass | Scoped re-match control |

---

## 4. Extraction Accuracy Scorecard

> **Important caveat:** No controlled UAT test pack with independent ground-truth labels exists in this environment. "Correct" below means *the on-screen extracted value matched the value rendered in the document viewer on visual spot-check* — it is **not** a formal accuracy measurement against an authoritative label set. The Phase 1 ≥80% header-field accuracy threshold therefore **cannot be formally certified** and is the primary driver of the Conditional verdict.

| Measure | Value (sampled) |
|---|---|
| Required header fields tracked | VendorRawName, VendorID, InvoiceNumber, InvoiceDate, DueDate/Terms, InvoiceTotal, PO# (if present) |
| Sampled records reviewed | Fastenal (seq1), Falcon Industries (seq2), Rice Lake (seq10), negative-total exception (id36) |
| Fields populated on sampled records | Header fields populated with confidence 0.95–1.00 |
| Fields requiring manual correction (sampled) | 0 observed on spot-check |
| Self-reported vendor match | 60%–100% (low scores correctly route to EXCEPTION rather than auto-assign) |
| Amount accuracy (spot-check) | Matched rendered totals; negative total correctly flagged |
| Invoice number accuracy (spot-check) | Matched rendered values |
| Date accuracy (spot-check) | Matched rendered values |
| Most commonly missed fields | Line items (out of Phase 1 scope); PO is presence-only WARNING |
| **Formal accuracy %** | **Not certifiable — requires labeled UAT pack** |

### Per-invoice acceptance metrics

Per the spec's acceptance-metrics list. Sampled records reflect visual spot-checks against the rendered document (not an independent label set). TC1/TC2 rows are the mandated artifacts that **could not be measured** this cycle (no source files / no labeled pack).

| Source / TC | Exp. count | Act. count | Exp. page range | Act. page range | VendorRaw ✔ | VendorID ✔ | InvNo ✔ | InvDate ✔ | DueDate/Terms ✔ | Total ✔ | PO ✔ | Confidence | Exception | Manual fixes | Approval | Export | VoucherID |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6-24-2026.pdf / TC3-4 seq1 (Fastenal) | 1 | 1 | 1–1 | 1–1 | Yes | Yes | Yes | Yes | n/v | Yes | N/A | 0.98 | None | 0 | Eligible | In export | After approval |
| 6-24-2026.pdf / TC3-4 seq2 (Falcon) | 1 | 1 | 2–2 | 2–2 | Yes | Yes | Yes | Yes | n/v | Yes | N/A | ~0.95 | None | 0 | Eligible | In export | After approval |
| 6-24-2026.pdf / TC3-4 seq10 (Rice Lake) | 1 | 1 | 10–10 | 10–10 | Yes | Yes | Yes | Yes | n/v | Yes | N/A | 0.98 | None | 0 | Eligible | In export | After approval |
| id36 negative-total / TC validation | 1 | 1 | — | — | Yes | Yes | Yes | Yes | n/v | Flagged (−$507.84) | N/A | n/v | Negative total → EXCEPTION | 0 | Blocked (exception) | Excluded until cleared | n/a |
| **TC1 clean PDF (mandated)** | **—** | **Not measured** | — | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured |
| **TC2 clean image (mandated)** | **—** | **Not measured** | — | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured |

Legend: ✔ = extracted correctly on spot-check · n/v = not visible on document · N/A = not applicable · "Not measured" = blocked by missing source files / labeled pack.

---

## 5. Defect Log

| ID | Severity | Area | Description | Repro | Expected | Actual | Recommended fix | Status |
|---|---|---|---|---|---|---|---|---|
| D1 | Medium | Duplicate / Approval | A duplicate invoice (exact VendorID+InvoiceNumber match to an existing record) is flagged and routed to EXCEPTION, but can still be approved through the documented exception-override path (status→APPROVED with a reason). | Submit a duplicate → EXCEPTION; approve with `reason` → APPROVED. | Business decision: duplicates flagged + blocked from normal approval (met). Question is whether duplicates should be a *hard* block like unmatched vendor. | Override allowed with documented reason (NOT silent — meets "flagged/blocked" threshold; not "approved without warning"). | Product decision: either (a) keep override with mandatory duplicate-acknowledgement, or (b) make exact-duplicate a hard-block like unmatched vendor. | Open (business decision) |
| D2 | Low | Intake / Duplicate | The intake `POST /invoices` 409 duplicate guard only fires when `vendorId` is supplied directly in the request body; when the vendor is resolved post-insert via `vendorRawName`, the intake guard is bypassed. | Create invoice via `vendorRawName` with a duplicate number → no 409 at intake. | Duplicate caught before approval. | Caught at the authoritative validation/submit step (defense-in-depth holds), just not at intake. | Make intake guard also evaluate resolved vendor, or document that validation is the authoritative duplicate gate. | Open (non-blocking) |
| D3 | Low | Review screen (UI) | React console warnings: "uncontrolled input changing to controlled" and "Select changing from uncontrolled to controlled" on the review screen. | Open `/invoices/:id`, inspect console. | No console warnings. | Cosmetic warnings; no functional impact observed. | Initialize controlled inputs/Select with defined default values. | Open (cosmetic) |
| D4 | Low | Export / UX | No "Export" button on the Invoice List page; CSV export is reached via the export endpoint rather than a list-level button. | View `/invoices`. | Convenience export control on list. | Export functional via endpoint; no list button. | Add a list-level "Export CSV" button (Phase 1 nice-to-have). | Open (UX) |

**Informational (not defects — explicitly out of Phase 1 scope or by-design):**
- Line items are not extracted (header-only) — not in the Phase 1 scope list.
- PO validation is presence-only (WARNING), not a three-way match — full PO match is explicitly excluded from Phase 1.
- Multi-invoice *image* files route to EXCEPTION (`IMAGE_MULTIPLE`) by design.
- VoucherID is entered manually with no ERP sync — ERP posting automation is explicitly excluded from Phase 1.

---

## 6. Phase 1 Exit Recommendation

**CONDITIONAL PASS — Phase 1 accepted after the listed conditions are satisfied.**

All Phase 1 control, workflow, data-integrity, and cleanup requirements passed with strong evidence, and there are **zero Critical and zero High** defects. Acceptance is **conditional** solely on closing the extraction-accuracy evidence gap, because the spec requires a certified ≥80% header-field accuracy across a UAT pack and no labeled pack exists in the environment to measure against.

**Conditions to convert to full PASS:**
1. Run a controlled UAT test pack (≥10 labeled invoices spanning clean PDF, clean image, multi-invoice, unknown/missing vendor, duplicate, low-confidence) and certify ≥80% header-field accuracy against ground truth.
2. Execute a true end-to-end fresh upload (TC1 clean PDF and TC2 clean image) through upload→extract→review→approve→export→post.
3. Obtain a product decision on D1 (duplicate override policy).

---

## 7. Recommended Next Steps

**Must-fix before pilot**
- Assemble and run a labeled UAT invoice pack; certify the ≥80% extraction-accuracy threshold (closes the Conditional gap).
- Perform fresh end-to-end TC1 (PDF) and TC2 (image) uploads to confirm the full intake→post lifecycle on new files.
- Decide duplicate-override policy (D1): hard-block exact duplicates, or require explicit duplicate acknowledgement on override.

**Should-fix before pilot**
- Close the intake duplicate-guard gap (D2) so the 409 also evaluates vendors resolved from `vendorRawName`.
- Add a list-level "Export CSV" button (D4) for AP convenience.
- Verify inline document rendering specifically in Microsoft Edge.

**Phase 2 backlog candidates**
- Line-item extraction.
- Full three-way PO matching.
- ERP posting automation / VoucherID sync.
- Auto vendor creation and GL coding automation.
- Resolve cosmetic React controlled-input warnings (D3).
- Phase 2 analytics/dashboards.

---

*Prepared from automated backend assertions (24-check harness), targeted API probes, live UI screenshots, and a Playwright interactive UI test. All destructive probes were cleaned up; the development dataset was restored to its 14-invoice baseline (0 voided, 0 UAT residue) at report time.*
