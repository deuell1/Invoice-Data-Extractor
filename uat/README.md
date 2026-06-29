# Phase 1 UAT Artifacts

Supporting material for the Phase 1 exit gate of the Invoice Data Extractor.

| Path | Purpose |
|---|---|
| `extraction-accuracy/` | Repeatable harness + template to score extraction accuracy against a labeled ground-truth test pack. |
| `extraction-accuracy/run-accuracy.mjs` | Scorer: compares expected vs extracted fields, prints the accuracy table and metrics. |
| `extraction-accuracy/ground-truth.template.csv` | Template for the labeled ground-truth values. |
| `extraction-accuracy/pack/` | Where the labeled invoice files go (empty until a pack is supplied). |
| `edge-rendering-checklist.md` | Manual checklist for verifying inline PDF/JPG/PNG rendering in Microsoft Edge. |
| `tie-out-test-cases.md` | Phase 1 header tie-out hardening test cases (PASS/WARNING/FAIL/SKIPPED), run commands, and cross-cutting checks. |

The consolidated verdict lives in `../Phase1_UAT_Exit_Report.md`.

## Phase 2 UAT Artifacts

| Path | Purpose |
|---|---|
| `Phase2_Status_Report.md` | Phase 2 status report (scope, feature status, DB reconciliation, open gates). |
| `Phase2_ImportExport_UAT.md` | Browser-based UAT of the full import→validate→commit and export→generate→download workflow (21/21 PASS; DB restored to baseline). |
| `Phase3_Future_ERP_Integration.md` | Placeholder documenting future ERP scope (no live action in Phase 2). |
