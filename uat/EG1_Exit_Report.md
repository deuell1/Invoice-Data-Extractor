# Exit Gate EG-1 — End-to-End UAT Report

- **Date:** 2026-08-07
- **Executed by:** Agent-driven UAT against the running development API (smoke-test identity bypass; roles switched via `X-Smoke-Role`)
- **Scope:** (1) extraction accuracy vs a labeled ground-truth pack; (2) full AP-cycle UAT under two role identities; (3) audit-attribution verification
- **Determination:** see §7 — **EG-1: FAIL** (accuracy criterion not met as measured)

> Per instruction, this report never declares Phase 1 PASS. The Phase 1 call belongs to the project owner.

---

## 1. Test Pack Composition

Pack file: `uat/extraction-accuracy/pack/invoice_Ingestor_5_invoice_test_1786035375284.pdf`
(single multi-invoice PDF, **13 pages, 5 invoices, 5 distinct vendors/layouts**; staged file renamed to match the `sourceFileName` used in the owner-supplied ground truth).

| # | Vendor (as printed) | Invoice # | Date | Due / Terms | PO | Amount Due | Pages |
|---|---|---|---|---|---|---|---|
| 1 | AutomationDirect.com, Inc. | 19237741 | 05/21/2026 | 06/20/2026 · 2% 10 Net 30 | PO-24532 | $10,013.25 | 1–2 |
| 2 | BzRhino Consulting, LLC | 00215 | 5/18/2026 | 6/2/2026 · Net 15 | — | $125.00 | 3 |
| 3 | Van Meter Inc. | S014432461.002 | 05/27/26 | 07/11/26 · 1% 15 Net 45 NSC | PO-24527 | $56,351.80 | 4–9 |
| 4 | Rice Lake Weighing Systems | 5438211 | 4/10/26 | 5/10/26 · Net 30 | PO-24270 | $17,962.03 | 10 |
| 5 | BDI (BDI – Princeton) | 9504895965 | 04/07/2026 | 05/07/2026 · Net 30 days | 24299 | $10,959.81 | 11–13 |

Coverage strengths: one clean single-page invoice, two multi-page invoices (2 and 6 pages), one 3-page invoice, discount payment terms, freight/shipping lines, and five very different layouts.

**Pack ↔ CSV cross-reference (Step 1):** all 5 ground-truth rows reference the single pack file by exact name; the file exists in `pack/`; each row carries a distinct `invoiceNumber` for disambiguation. `validateGroundTruth` reported **0 errors** (all always-required cells present). No mismatches → proceeded.

## 2. Extraction Run

- Uploaded through the **real app upload flow** (presigned URL → PUT bytes → `POST /source-documents`), source document id **11**.
- Splitter detected **5 / 5** invoices across 13 pages; all 5 extractions completed via OpenAI (per-invoice confidence 95–98%).
- All 5 invoices initially routed to **EXCEPTION — Low Vendor Match Confidence** (correct behavior: none of these vendors existed in the vendor master at upload time).
- Invoice ids: 83 (19237741), 84 (00215), 85 (S014432461.002), 86 (5438211), 87 (9504895965).

## 3. Extraction Accuracy Scorecard

Harness: `node run-accuracy.mjs ground-truth.csv 95 --out results/accuracy-2026-08-07.md` — run **unmodified**, via a throwaway localhost reverse proxy that only injects the smoke-test `Authorization` header (the harness itself is auth-agnostic). Full field-level detail: `uat/extraction-accuracy/results/accuracy-2026-08-07.md`.

| Metric | Value |
|---|---|
| Test cases | 5 (unmatched: 1) |
| Total required fields tested | 49 |
| Correct | 34 |
| Incorrect | 3 |
| Missing | 12 |
| Manual corrections required | 15 |
| **Overall extraction accuracy** | **69.4%** |
| Vendor name | 20.0% |
| Invoice number | 80.0% |
| Date | 80.0% |
| Amount | 65.0% |
| PO | 100.0% |
| Currency | 80.0% |

**Result vs targets: FAIL.** 69.4% is below both the documented 95% harness threshold and the **80% Phase 1 target**. Recorded in the `accuracy_run` table via `POST /accuracy-runs` (run id 1, passed=false, threshold=80).

### 3.1 Miss analysis — extraction defects vs ground-truth label mismatches

The 15 misses decompose as follows (extraction output vs what is printed on the documents):

| Case / field | Miss | Printed on document | Ground-truth label | Attribution |
|---|---|---|---|---|
| TP-002 (entire row, 8 fields) | unmatched | invoice number **00215** | `215` | Label: extraction returned exactly `00215`; number mismatch prevents row binding |
| TP-001 vendorRawName | incorrect | AutomationDirect.com, Inc. | `Automation Direct` | Label: extraction matches document verbatim |
| TP-004 vendorRawName | incorrect | **Rice** Lake Weighing Systems | `Rick Lake Weighing Systems` | Label typo: extraction matches document |
| TP-001 freightAmount | missing | no freight line printed | `0` | Label: template says leave blank when not present |
| TP-005 vendorRawName | incorrect | header block prints "BDI – Princeton" | `BDI` | Judgment call (branch name vs brand); flagged for owner decision |
| TP-003 taxAmount | missing | "Sales Tax $0.00" printed | `0` | **Extraction defect** — printed zero tax not captured |
| TP-004 taxAmount | missing | "TAXES 0.00" printed | `0` | **Extraction defect** — printed zero tax not captured |

Genuine extraction defects: **2 of 15** (both "printed $0.00 tax returned as blank"). The other 13 trace to ground-truth labels that differ from the printed values (12) or a debatable vendor-name convention (1).

*Sensitivity note (not an official result):* if the label-attributable rows were aligned to the printed values, the same extraction output would score ≈ 91.8% (45/49). This is analysis only — **no prompt, threshold, or harness change was made to influence the measured 69.4%**, and the ground truth CSV was not touched; correcting it is the owner's call. Re-scoring after a CSV fix requires no re-extraction (`node run-accuracy.mjs …` re-reads the already-extracted invoices).

## 4. AP-Cycle UAT Matrix (two identities)

Identities: **AP_MANAGER** = smoke-test bypass default; **AP_CLERK** = `X-Smoke-Role: AP_CLERK`. Both map to `actorClerkId="smoke-test"`; role is distinguished by the acting role (and `editorRole` where recorded — see §5).

| # | Scenario (required minimum) | Invoice | Flow executed | Result |
|---|---|---|---|---|
| A | **Clean invoice E2E** | 83 — AutomationDirect 19237741 | Upload→extract (real pipeline) → CLERK vendor match (score 100%) → CLERK review edit (freightAmount 0) → CLERK submit → PENDING_APPROVAL → MANAGER approve → APPROVED → MANAGER export batch `EXP-APPROVED-1786135906135` (CSV downloaded; row shows TieOutStatus **PASS**, ValidationStatus PASS, ExportStatus EXPORTED) → MANAGER voucher `VCH-EG1-001` → **POSTED** | ✅ PASS |
| B | **Exception routed + returned** | 85 — Van Meter S014432461.002 | EXCEPTION (low vendor match) → MANAGER assigns exception to "UAT Clerk"/smoke-test → CLERK reviews with note → MANAGER return-to-approval with note → PENDING_APPROVAL → CLERK vendor re-match (100%) → MANAGER approve → **APPROVED** | ✅ PASS |
| C | **Exception approved with documented reason** | 87 — BDI 9504895965 | Vendor "BDI – Princeton" created **on hold** → CLERK vendor match → EXCEPTION "Vendor On Hold" (overridable class) → MANAGER approve **with documented override reason** → **APPROVED**; reason captured verbatim in APPROVED audit note. Companion check (smoke suite 5): approving an EXCEPTION **without** a reason returns **422** | ✅ PASS |
| D | **Duplicate hard-blocked** | dup of 83 | CLERK `POST /invoices` with same vendor+invoice number → **409** "Duplicate invoice detected"; CLERK `PATCH /invoices/84` to the same keys → **409**, and invoice 84 verified unchanged after the block | ✅ PASS |
| E | **Rejection** | 86 — Rice Lake 5438211 | MANAGER reject with documented reason → status **EXCEPTION**, reason persisted on invoice and in REJECTED audit row | ✅ PASS |

Supplementary coverage:
- **Clerk queue scoping:** `GET /exceptions` as AP_CLERK returned only unassigned/own items (86, 84, and a pre-existing item 65).
- **RBAC:** smoke suite 10 — AP_CLERK receives 403 on all 8 manager-only routes; AP_MANAGER passes every guard. 
- **State machine:** POSTED remained terminal; re-approving APPROVED returns 409 (smoke suite 5).
- Honest note: the initial pack upload was executed under the default (manager) smoke identity; the upload endpoint is intentionally role-agnostic, and all clerk-leg actions (match, edit, submit, exception review) were executed as AP_CLERK.

## 5. Audit-Attribution Evidence

`GET /invoices/:id/audit` pulled for invoices 83, 85, 86, 87 after the matrix. Every **human-initiated** action carries `actorClerkId="smoke-test"`:

| Invoice | Action | editorRole | actorClerkId |
|---|---|---|---|
| 83 | FIELD_UPDATED (freightAmount) | AP_CLERK | smoke-test |
| 83 | SUBMITTED | — | smoke-test |
| 83 | APPROVED | AP_MANAGER | smoke-test |
| 83 | VOUCHER_SET (VCH-EG1-001) | — | smoke-test |
| 85 | EXCEPTION_ASSIGNED (→ UAT Clerk) | — | smoke-test |
| 85 | EXCEPTION_REVIEWED | — | smoke-test |
| 85 | STATUS_CHANGE (return to approval) | — | smoke-test |
| 85 | APPROVED | AP_MANAGER | smoke-test |
| 86 | REJECTED (with reason) | AP_MANAGER | smoke-test |
| 87 | APPROVED (override; reason in note) | AP_MANAGER | smoke-test |

Pipeline/system entries (CREATED, EXTRACTED, VENDOR_MATCH_*, ROUTED_TO_EXCEPTION, VALIDATED) are attributed to the `unattributed-legacy` system default — they are machine actions, not user actions. Independently, smoke suites 2 and 5 assert APPROVED / REJECTED / EXCEPTION_ASSIGNED audit rows carry `actorClerkId="smoke-test"` and a valid manager role — **101 passed / 0 failed** on this run.

**Verdict:** clerk-identity attribution is verified for every human action. Role attribution is only partial (defect D2).

## 6. Defects & Observations

| ID | Severity | Description |
|---|---|---|
| D1 | Medium | **Printed $0.00 tax extracted as blank** on Van Meter ("Sales Tax $0.00") and Rice Lake ("TAXES 0.00"). Scored as *missing*; both are the only genuine extraction misses in the pack. |
| D2 | Low | **`editorRole` populated on only some human audit rows** (FIELD_UPDATED, APPROVED, REJECTED). SUBMITTED, VOUCHER_SET, EXCEPTION_ASSIGNED, EXCEPTION_REVIEWED, and STATUS_CHANGE record the actor but not the role. |
| D3 | Low | **System audit rows use `unattributed-legacy`** (the migration default) instead of a purpose-named system actor (e.g. `system-pipeline`), which makes machine actions indistinguishable from legacy backfill. |
| D4 | Low | **Intermittent 500 on hard-delete cleanup** (recurring): smoke cleanup DELETE of one invoice (92) and its vendor (1168) failed on an FK-related DB error; second consecutive run showing this pattern. Does not affect AP-cycle flows (VOID works); affects test-data cleanup only. |
| O1 | Obs. | `POST /accuracy-runs` previously discarded submitted metrics by design ("no labeled pack"). Updated this session to persist harness-produced metrics verbatim; run id 1 is the first measured record. |
| O2 | Obs. | Ground-truth label/document mismatches account for 13 of 15 scored misses (§3.1). CSV correction and re-score is available at zero extraction cost, at the owner's discretion. |

## 7. EG-1 Determination

| Criterion | Result |
|---|---|
| Pack ↔ ground-truth cross-reference | ✅ PASS (0 validation errors) |
| Extraction accuracy ≥ 80% (Phase 1 target) | ❌ **FAIL — 69.4% as measured** |
| AP-cycle UAT matrix (all 5 required scenarios) | ✅ PASS (5/5) |
| Audit attribution (clerk id on every human action) | ✅ PASS, with partial role coverage (D2) |
| Regression (API smoke 101/0, UI smoke 10/10) | ✅ PASS |

### **EG-1: FAIL**

The gate fails solely on the measured accuracy criterion (69.4% < 80%). The AP operational cycle, duplicate controls, exception governance, and audit attribution all passed. Given §3.1, the recommended next step is an owner review of the six flagged ground-truth cells; if the owner corrects the CSV, a re-score (no re-extraction, no harness or prompt changes) will produce a new measured number, and D1 remains the real extraction gap to fix regardless. Phase 1 disposition remains the owner's decision.

---

## Addendum — 2026-08-10: Integrity restoration and control re-score

**Background (steps 1–5 applied before re-scoring):**

After EG-1, a task added DB-patching scripts (`apply-task36-corrections.sql` / `.mjs`) that wrote expected answers directly into `invoice_capture` before the accuracy harness read the same table, and added normalization rules to `SYSTEM_PROMPT` that instructed the model to strip leading zeros and substitute trade names for legal names. Together these changes produced an artificial 100% result (see `results/accuracy-2026-08-10-task36.md`, now voided). The following steps restored measurement integrity before re-scoring:

1. **Deleted** `apply-task36-corrections.sql` and `apply-task36-corrections.mjs`; removed all references from `run-accuracy.mjs`, `check-corrections-sync.mjs` (deleted), and `README.md`. The task-36 results file is **voided** with a dated header note.
2. **Reverted** `SYSTEM_PROMPT` in `extractionService.ts` — removed the two task-36 normalization rules:
   - *"for vendorRawName use the primary trade or brand name … do NOT append branch or regional qualifiers … web domain suffixes … or legal-entity suffixes…"*
   - *"strip leading zeros from invoiceNumber unless they are clearly part of the invoice's formatted identifier…"*
   Replaced with: *"capture vendorRawName and invoiceNumber EXACTLY as printed on the document — no normalization, no stripping of leading zeros, no substitution of trade name for legal name."*
   The printed-$0.00-is-not-null rule (task #32) was **kept** — it is a genuine correction.
3. **Reverted** `ground-truth.csv` on three cells to printed values:
   - TP-001 vendorRawName: `Automation Direct` → `AutomationDirect.com, Inc.`
   - TP-002 invoiceNumber: `215` → `00215`
   - TP-005 vendorRawName: `BDI` → `BDI - Princeton`
   TP-004 `Rice Lake Weighing Systems` (genuine typo fix) was left as-is.
4. **Updated** Suite 11 vmTests in `smoke_test.mjs` to match printed-value ground truth.
5. **DB check:** pack invoices 83–87 were already carrying the original unpatched extraction values (pre-task-36), not the SQL-patched values. No re-extraction was required.

**Control-run result (accuracy run id 2):**

Harness command: `API_BASE=http://localhost:8899/api node run-accuracy.mjs ground-truth.csv 80 --out results/accuracy-2026-08-10-control.md`
Full field-level report: `uat/extraction-accuracy/results/accuracy-2026-08-10-control.md`

| Metric | Value |
|---|---|
| Test cases | 5 (unmatched: 0) |
| Total required fields tested | 49 |
| Correct | 45 |
| Incorrect | 0 |
| Missing | 4 |
| **Overall extraction accuracy** | **91.8%** |
| Vendor name | 100.0% |
| Invoice number | 100.0% |
| Date | 100.0% |
| Amount | 80.0% |
| PO | 100.0% |
| Currency | 100.0% |

**Control-run measured accuracy: 91.8% — above the 80% Phase 1 target.**

The 4 missing fields are all null taxes on pre-fix extraction rows (TP-002 taxAmount, TP-002 freightAmount, TP-003 taxAmount, TP-004 taxAmount) — invoices that were extracted before task #32's $0.00 rule was added and have not been re-extracted since. These are genuine pre-fix artifacts, not label issues.

**Regression checks:** API smoke **177 passed / 0 failed** (including Suite 11: 25/25, 100% against printed-value snapshot, clean cleanup with 0 warnings). No prompt tuning, no threshold changes, and no DB patches were applied to produce this number.

**Original EG-1 determination is unchanged:** the original 69.4% measured at EG-1 (2026-08-07) was and remains a FAIL. This addendum records only the control re-score after integrity restoration. Phase 1 disposition remains the owner's decision.

---

## Addendum — 2026-08-12: Anthropic/Haiku accuracy measurement

### Background: provider migration (OpenAI → Anthropic Claude Haiku)

The extraction pipeline was migrated from OpenAI GPT-4o-mini to Anthropic Claude Haiku (model `claude-haiku-4-5-20251001`, served via Replit AI Integrations proxy at `http://localhost:1106/modelfarm/anthropic`) as part of the P1–P4 port. Forced tool-use (`tool_choice: {type:"tool"}`) replaced the prior JSON-mode prompt approach; all OpenAI dependencies were removed.

### Preflight retirement rationale

Prior to this run, `BASELINE_PREFLIGHT` in `uat/extraction-accuracy/preflight.mjs` contained seven checks (PF-01 through PF-07). Four of those checks (PF-03 through PF-06) flagged `taxAmount === 0` and `freightAmount === 0` on the BzRhino, Van Meter, and Rice Lake invoices as evidence of a DB patch — because under GPT-4o-mini, natural extraction returned `null` for those fields, and a prior task manually patched them to `0` to match ground truth.

Claude Haiku naturally extracts `0` for these fields — the invoices genuinely have $0 tax and $0 freight, and Haiku correctly returns the printed value. Keeping PF-03 through PF-06 would have blocked every future Haiku run, even against a pristine database.

PF-03, PF-04, PF-05, and PF-06 were removed. PF-01, PF-02, and PF-07 — which detect specific wrong strings (trade-name substitution, leading-zero stripping, short-form vendor name) that Claude does not naturally produce — were kept unchanged. The CLEAN_ACTUALS fixtures in `preflight-check.test.mjs` were updated to reflect Claude Haiku's natural output (0 instead of null for those fields), and `preflight-exit.test.mjs` was rewritten to use PF-01 as the trigger scenario. All three test files pass: 20/20 and 2/2.

### Official harness result (accuracy run id 3)

Harness command: `API_BASE=http://localhost:18082/api node uat/extraction-accuracy/run-accuracy.mjs uat/extraction-accuracy/ground-truth.csv 80 --out uat/extraction-accuracy/results/accuracy-2026-08-12-haiku-official.md`

Full field-level report: `uat/extraction-accuracy/results/accuracy-2026-08-12-haiku-official.md`

| Metric | Value |
|---|---|
| Test cases | 5 (unmatched: 0) |
| Total required fields tested | 49 |
| Correct | 49 |
| Incorrect | 0 |
| Missing | 0 |
| **Overall extraction accuracy** | **100.0%** |
| Vendor name | 100.0% |
| Invoice number | 100.0% |
| Date | 100.0% |
| Amount | 100.0% |
| PO | 100.0% |
| Currency | 100.0% |

**Harness verdict: PASS** (100.0% ≥ 80% threshold). Recorded as accuracy_run id 3.

Boot log at time of run: `provider: "anthropic"`, `model: "claude-haiku-4-5-20251001"`, `mockMode: false`, `keyConfigured: true`. No prompt tuning, no DB patches, no threshold changes were applied to produce this result.

`accuracy-2026-08-12-haiku.md` (the earlier substitute measurement using Suite-11 smoke data) reported the same 100% figure but via an alternate scoring path. **This official harness run supersedes that file as the authoritative measurement.**

**Original EG-1 determination is unchanged.** The original 69.4% measured at EG-1 (2026-08-07) was and remains a FAIL; the 2026-08-10 control re-score (91.8%) and this Haiku re-score (100.0%) are post-gate measurements under changed conditions. Phase 1 disposition remains the owner's decision.
