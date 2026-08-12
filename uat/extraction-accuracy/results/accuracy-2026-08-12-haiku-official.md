# Extraction Accuracy Results

- Date: 2026-08-12
- API: http://localhost:18082/api
- Ground-truth file: `uat/extraction-accuracy/ground-truth.csv`
- Test cases: 5 (unmatched: 0)
- PASS threshold: 80%

## Field-Level Detail

| Case | Field | Expected | Actual | Verdict |
|---|---|---|---|---|
| TP-001 | vendorRawName | AutomationDirect.com, Inc. | AUTOMATIONDIRECT.COM, INC. | CORRECT |
| TP-001 | invoiceNumber | 19237741 | 19237741 | CORRECT |
| TP-001 | invoiceDate | 5/21/2026 | 2026-05-21 | CORRECT |
| TP-001 | poNumber | PO-24532 | PO-24532 | CORRECT |
| TP-001 | subtotal | 10013.25 | 10013.25 | CORRECT |
| TP-001 | taxAmount | 0 | 0 | CORRECT |
| TP-001 | freightAmount | 0 | 0 | CORRECT |
| TP-001 | totalAmount | 10013.25 | 10013.25 | CORRECT |
| TP-001 | currency | USD | USD | CORRECT |
| TP-001 | dueDateOrTerms | 6/20/2026 | 2026-06-20 | CORRECT |
| TP-002 | vendorRawName | BzRhino Consulting, LLC | BzRhino Consulting, LLC | CORRECT |
| TP-002 | invoiceNumber | 00215 | 00215 | CORRECT |
| TP-002 | invoiceDate | 5/18/2026 | 2026-05-18 | CORRECT |
| TP-002 | subtotal | 125 | 125 | CORRECT |
| TP-002 | taxAmount | 0 | 0 | CORRECT |
| TP-002 | freightAmount | 0 | 0 | CORRECT |
| TP-002 | totalAmount | 125 | 125 | CORRECT |
| TP-002 | currency | USD | USD | CORRECT |
| TP-002 | dueDateOrTerms | 6/2/2026 | 2026-06-02 | CORRECT |
| TP-003 | vendorRawName | Van Meter, Inc. | VAN METER INC. | CORRECT |
| TP-003 | invoiceNumber | S014432461.002 | S014432461.002 | CORRECT |
| TP-003 | invoiceDate | 5/27/2026 | 2026-05-27 | CORRECT |
| TP-003 | poNumber | PO-24527 | PO-24527 | CORRECT |
| TP-003 | subtotal | 56351.8 | 56351.8 | CORRECT |
| TP-003 | taxAmount | 0 | 0 | CORRECT |
| TP-003 | freightAmount | 0 | 0 | CORRECT |
| TP-003 | totalAmount | 56351.8 | 56351.8 | CORRECT |
| TP-003 | currency | USD | USD | CORRECT |
| TP-003 | dueDateOrTerms | 7/11/2026 | 2026-07-11 | CORRECT |
| TP-004 | vendorRawName | Rice Lake Weighing Systems | RICE LAKE WEIGHING SYSTEMS | CORRECT |
| TP-004 | invoiceNumber | 5438211 | 5438211 | CORRECT |
| TP-004 | invoiceDate | 4/10/2026 | 2026-04-10 | CORRECT |
| TP-004 | poNumber | PO-24270 | PO-24270 | CORRECT |
| TP-004 | subtotal | 17820 | 17820 | CORRECT |
| TP-004 | taxAmount | 0 | 0 | CORRECT |
| TP-004 | freightAmount | 142.03 | 142.03 | CORRECT |
| TP-004 | totalAmount | 17962.03 | 17962.03 | CORRECT |
| TP-004 | currency | USD | USD | CORRECT |
| TP-004 | dueDateOrTerms | 5/10/2026 | 2026-05-10 | CORRECT |
| TP-005 | vendorRawName | BDI - Princeton | BDI - Princeton | CORRECT |
| TP-005 | invoiceNumber | 9504895965 | 9504895965 | CORRECT |
| TP-005 | invoiceDate | 4/7/2026 | 2026-04-07 | CORRECT |
| TP-005 | poNumber | 24299 | 24299 | CORRECT |
| TP-005 | subtotal | 10620.69 | 10620.69 | CORRECT |
| TP-005 | taxAmount | 0 | 0 | CORRECT |
| TP-005 | freightAmount | 339.12 | 339.12 | CORRECT |
| TP-005 | totalAmount | 10959.81 | 10959.81 | CORRECT |
| TP-005 | currency | USD | USD | CORRECT |
| TP-005 | dueDateOrTerms | 5/7/2026 | 2026-05-07 | CORRECT |

## Summary Metrics

| Metric | Value |
|---|---|
| Total required fields tested | 49 |
| Correct fields | 49 |
| Incorrect fields | 0 |
| Missing fields | 0 |
| Manual corrections required | 0 |
| **Overall extraction accuracy** | **100.0%** |
| Vendor name accuracy | 100.0% |
| Invoice number accuracy | 100.0% |
| Date accuracy | 100.0% |
| Amount accuracy | 100.0% |
| PO accuracy | 100.0% |
| Currency accuracy | 100.0% |

## Verdict

**Phase 1 extraction accuracy: PASS** (100.0% vs 80% threshold).
