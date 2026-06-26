# Phase 1 UAT Artifacts

Supporting material for the Phase 1 exit gate of the Invoice Data Extractor.

| Path | Purpose |
|---|---|
| `extraction-accuracy/` | Repeatable harness + template to score extraction accuracy against a labeled ground-truth test pack. |
| `extraction-accuracy/run-accuracy.mjs` | Scorer: compares expected vs extracted fields, prints the accuracy table and metrics. |
| `extraction-accuracy/ground-truth.template.csv` | Template for the labeled ground-truth values. |
| `extraction-accuracy/pack/` | Where the labeled invoice files go (empty until a pack is supplied). |
| `edge-rendering-checklist.md` | Manual checklist for verifying inline PDF/JPG/PNG rendering in Microsoft Edge. |

The consolidated verdict lives in `../Phase1_UAT_Exit_Report.md`.
