# Phase 2 UAT — Browser-Based Import / Export Workflow

_Date: 2026-06-29_
_Method: automated Playwright browser session (real UI, real backend, shared dev database)_
_Result: **PASS** — 21/21 verifications passed, 0 failures_

> This report closes the "broader UI end-to-end pass" recommended in
> `uat/Phase2_Status_Report.md` §9. It exercises the full import→validate→commit
> and export→generate→download cycle through the browser with real CSV file
> uploads, then restores the database to its baseline.

---

## 1. Scope

| Flow | Exercised through the browser |
| --- | --- |
| Import — validation gating | Upload an all-invalid CSV; confirm commit is blocked |
| Import — commit | Upload a mixed CSV (valid + invalid rows); validate; commit valid rows |
| Import — history | Confirm the committed batch appears in Import History |
| Export — generate | Generate an `APPROVED` invoice export |
| Export — download | Confirm a download control is offered for the generated batch |
| Export — history | Confirm the export batch appears in Export History |

Out of scope (covered elsewhere or by manual UAT): extraction-accuracy
certification and Edge-browser rendering (both tracked as open Phase 1 exit gates
in the status report).

---

## 2. Test Data

All test data used a `UAT-PO-` prefix so it could be removed precisely afterward.

**Blocking import file** (`uat-blocking.csv`) — a single row with an empty
required `poNumber`:

```
poNumber,vendorCode,poDate,buyer,description,totalAmount,currency,status
,V-UAT,2026-01-15,UAT Buyer,Blocking row missing PO,100.00,USD,OPEN
```

**Mixed import file** (`uat-mixed.csv`) — two valid rows + one invalid row
(empty `poNumber`):

```
poNumber,vendorCode,poDate,buyer,description,totalAmount,currency,status
UAT-PO-A1,V-UAT,2026-01-15,UAT Buyer,UAT valid row one,1500.00,USD,OPEN
UAT-PO-A2,V-UAT,2026-01-16,UAT Buyer,UAT valid row two,2500.00,USD,OPEN
,V-UAT,2026-01-17,UAT Buyer,UAT invalid missing PO,300.00,USD,OPEN
```

Both files were supplied to the real file input via the browser.

---

## 3. Results

### 3.1 Import — blocking validation (all rows invalid)

| # | Check | Expected | Observed | Result |
| --- | --- | --- | --- | --- |
| 1 | `/imports` page loads | "Imports" heading visible | Visible | ✅ |
| 2 | Import type selectable | "PO Reference" selectable | Selected | ✅ |
| 3 | Validate blocking file | Blocking badge shown | Shown | ✅ |
| 4 | Valid count | 0 | 0 | ✅ |
| 5 | Rejected count | 1 | 1 | ✅ |
| 6 | Commit gating | Commit button disabled | Disabled | ✅ |

### 3.2 Import — mixed file, successful commit

| # | Check | Expected | Observed | Result |
| --- | --- | --- | --- | --- |
| 7 | Validate mixed file | "Ready to commit" badge | Shown | ✅ |
| 8 | Total rows | 3 | 3 | ✅ |
| 9 | Valid rows | 2 | 2 | ✅ |
| 10 | Rejected rows | 1 | 1 | ✅ |
| 11 | Actor entry | "uat.tester" accepted | Accepted | ✅ |
| 12 | Commit | Import Committed card shown | Shown | ✅ |
| 13 | Accepted / Rejected | 2 accepted, 1 rejected | 2 / 1 | ✅ |
| 14 | Import History | Newest row = PO_REFERENCE, COMMITTED | `row-import-3`, COMMITTED | ✅ |

Only the two valid rows were committed; the invalid row was rejected — confirming
partial-commit semantics (a mixed file commits valid rows and drops invalid ones).

### 3.3 Export — generate APPROVED export and download

| # | Check | Expected | Observed | Result |
| --- | --- | --- | --- | --- |
| 15 | `/exports` page loads | "Exports" heading visible | Visible | ✅ |
| 16 | Export type | "Approved Invoices" selected | Selected | ✅ |
| 17 | Actor entry | "uat.tester" accepted | Accepted | ✅ |
| 18 | Generate | Export Generated card shown | Shown | ✅ |
| 19 | Record count | 4 | 4 | ✅ |
| 20 | Status | SUCCESS badge | SUCCESS | ✅ |
| 21 | Download + history | Download control present; newest history row = APPROVED / CSV / 4 / SUCCESS | Present; `row-export-2` APPROVED/CSV/4/SUCCESS | ✅ |

---

## 4. Database Reconciliation & Cleanup

During the test the database showed exactly the expected mutations:

- `import_batch`: 1 PO_REFERENCE batch, `rowsAccepted=2`, `rowsRejected=1`,
  `uploadedBy=uat.tester`.
- `po_header`: 2 rows inserted (`UAT-PO-A1`, `UAT-PO-A2`).
- `export_batch`: 1 APPROVED batch, `recordCount=4`, `status=SUCCESS`,
  `exportedBy=uat.tester`.
- `invoice_capture`: the 4 APPROVED invoices (ids 32, 33, 34, 37) stamped
  `export_status=EXPORTED` with the matching `export_batch_id`.

**All test mutations were then reverted.** The database was returned to its
baseline:

| State | Value |
| --- | --- |
| Invoices | 14 (5 EXCEPTION / 4 PENDING_APPROVAL / 4 APPROVED / 1 POSTED) |
| `po_header` rows | 0 |
| `import_batch` rows | 0 |
| `export_batch` rows | 0 |
| Exported invoices | 0 |

---

## 5. Conclusion

The full browser-based import and export workflow **passes UAT**. Validation
gating, partial-commit semantics, actor capture, export generation with
export-readiness stamping, download availability, and both history views all
behave correctly end-to-end. This closes the recommended pre-sign-off UI pass for
the import/export workflow; the two open Phase 1 exit gates (extraction-accuracy
certification and Edge rendering) remain the only outstanding items before full
pilot sign-off.
