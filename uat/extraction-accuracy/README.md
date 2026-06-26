# Phase 1 UAT — Extraction Accuracy Process

A repeatable process for measuring invoice extraction accuracy against a
**labeled ground-truth test pack**. Use it to convert the Phase 1 accuracy item
from *"Not measured"* to a measured **PASS/FAIL**.

## What you need

1. A **labeled test pack**: a set of real (or representative) invoice files —
   PDF, JPG, PNG, and at least one multi-invoice PDF — for which you know the
   correct field values.
2. The known-correct values recorded in `ground-truth.csv`
   (copy `ground-truth.template.csv`).

If you do **not** have a labeled pack, the Phase 1 result stays
**"Not measured — labeled test pack required."** This harness is the template to
run the moment a pack exists.

## Fields scored

| Field | Required |
|---|---|
| VendorRawName | always |
| InvoiceNumber | always |
| InvoiceDate | always |
| DueDate **or** PaymentTerms | always (one of) |
| TotalAmount | always |
| Currency | always |
| PONumber | if present on the document |
| Subtotal | if present |
| TaxAmount | if present |
| FreightAmount | if present |

Leave a cell blank in the CSV to skip scoring that optional field.

## Steps

1. **Place the pack** files in `pack/` (for record-keeping) and upload them
   through the app using the normal upload flow, so they run through the real
   extraction pipeline. For multi-invoice PDFs, let the splitter create one
   invoice per detected document.
2. **Fill the ground truth.** Copy the template and enter expected values:
   ```bash
   cp ground-truth.template.csv ground-truth.csv
   # edit ground-truth.csv — one row per expected invoice
   ```
   `sourceFileName` must match the uploaded file name exactly. For multi-invoice
   PDFs, repeat the same `sourceFileName` and set a distinct `invoiceNumber` per
   row (rows are matched by file name, then disambiguated by invoice number).
3. **Run the scorer** against the running API:
   ```bash
   node run-accuracy.mjs ground-truth.csv 95 --out results/accuracy-$(date +%F).md
   ```
   - Arg 1: ground-truth CSV.
   - Arg 2: PASS threshold percent (default 95 — set to the agreed Phase 1 target).
   - `--out`: optional path to also save the markdown report.
   - `API_BASE` env overrides the API URL (default `http://localhost:8080/api`).
4. **Read the result.** The scorer prints a field-level table and the summary
   metrics (total tested, correct, incorrect, missing, manual corrections,
   overall accuracy %, and per-category accuracy for vendor / invoice number /
   date / amount / PO / currency). Exit code is `0` on PASS, `1` on FAIL.

## Scoring rules

- **Correct / Incorrect / Missing** per field. *Missing* = the document had a
  value but extraction returned none. *Incorrect* = a value was returned but does
  not match.
- **Manual corrections required** = incorrect + missing.
- **Normalization** so trivial formatting differences are not penalized:
  - Dates compared as calendar dates (formats like `01/15/2026` and `2026-01-15`
    are treated as equal).
  - Amounts compared numerically with a ±0.01 tolerance (currency symbols and
    thousands separators ignored).
  - Strings compared case-insensitively, ignoring punctuation/whitespace.
  - Currency compared as upper-case ISO code.
- **DueDate or PaymentTerms** is scored as a single field: if the ground truth
  provides a due date, the extracted due date is compared; otherwise payment
  terms are compared.

## Recording the result

Paste the summary metrics block into **section 4 (Extraction Accuracy Scorecard)**
of `Phase1_UAT_Exit_Report.md` and update the verdict. Mark the accuracy item
**closed** only if overall accuracy meets the agreed threshold.
