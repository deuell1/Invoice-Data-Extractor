# Phase 1 — Original Acceptance Checklist

This is the literal 26-item checklist from the original Phase 1 build plan
(Phase_1.docx), which was never committed to this repo. uat/Phase1_Signoff.md
is the official sign-off record and uses a differently-organized 16-area
functional checklist instead, because this literal list wasn't available
to it at the time. This file maps each literal item to what verifies it, so
the two documents agree rather than silently diverging.

| # | Original checklist item | Verified by | Status |
|---|---|---|---|
| 1 | User can upload PDF/image invoice | Phase1_Signoff.md area 1 | PASS |
| 2 | System generates DocumentID | sourceDocumentService.ts:176 — format confirmed `INV-CAP-000001` | PASS |
| 3 | System stores original file unchanged | Phase1_Signoff.md area 1 | PASS |
| 4 | System creates invoice_capture record | Phase1_Signoff.md area 2 | PASS |
| 5 | System extracts VendorRawName | Phase1_Signoff.md area 3 (accuracy_run id 3, 100.0%) | PASS |
| 6 | System extracts InvoiceNumber | Phase1_Signoff.md area 3 | PASS |
| 7 | System extracts InvoiceDate | Phase1_Signoff.md area 3 | PASS |
| 8 | System extracts DueDate or PaymentTerms | Phase1_Signoff.md area 3 | PASS |
| 9 | System extracts InvoiceTotal | Phase1_Signoff.md area 3 | PASS |
| 10 | System extracts PO number when visible | Phase1_Signoff.md area 3 | PASS |
| 11 | System stores ExtractionConfidence as a percentage | extractionService.ts — Claude output and threshold checks (>=85%) operate on 0-100 scale; stored internally as a 0-1 decimal, converted back to % at every display/logging point | PASS (see note below) |
| 12 | System matches VendorID from Vendor_ID table | Phase1_Signoff.md area 5 | PASS |
| 13 | System does not use OCR to assign VendorID directly | Non-negotiable rule enforced throughout — VendorID never derived from extracted text | PASS |
| 14 | System flags missing required fields | Phase1_Signoff.md area 7 | PASS |
| 15 | System flags low confidence below 85% | Phase1_Signoff.md area 7 | PASS |
| 16 | System checks duplicate VendorID + InvoiceNumber | Phase1_Signoff.md area 8 | PASS |
| 17 | System routes exceptions to queue | Phase1_Signoff.md area 9 | PASS |
| 18 | AP reviewer can edit extracted fields | Phase1_Signoff.md area 4 | PASS |
| 19 | Edits create audit log records | Phase1_Signoff.md area 4 | PASS |
| 20 | AP reviewer can approve or reject | Phase1_Signoff.md area 10 | PASS |
| 21 | Approved invoices can export to CSV | Phase1_Signoff.md area 14 | PASS |
| 22 | User can manually enter VoucherID | Phase1_Signoff.md area 11 | PASS |
| 23 | Invoice can be marked Exported | Phase1_Signoff.md area 11 | PASS |
| 24 | Invoice can be marked Posted | Phase1_Signoff.md area 11 | PASS |
| 25 | Original invoice link remains available | Phase1_Signoff.md area 1 | PASS |
| 26 | Basic KPI counts are visible | Phase1_Signoff.md area 15 | PASS |

**Note on item 11:** "stored as a percentage" is satisfied in intent, not in
literal column type — the database column is a 0-1 decimal
(`numeric(5,4)`), not a 0-100 integer. Every point where a human or a
threshold check reasons about this value treats it as a percentage. This
is a standard normalize-in-DB, format-at-the-edge pattern, not a defect.

**Conclusion:** all 26 items pass. The 16-area checklist in
uat/Phase1_Signoff.md is confirmed substantively complete against the
original literal checklist — nothing is missing, only differently grouped.
