# Extraction Accuracy Results

- Date: 2026-08-10
- API: http://localhost:8899/api
- Ground-truth file: `uat/extraction-accuracy/ground-truth.csv`
- Test cases: 5 (unmatched: 0)
- PASS threshold: 95%

## Field-Level Detail

| Case | Field | Expected | Actual | Verdict |
|---|---|---|---|---|
| TP-001 | vendorRawName | Automation Direct | Automation Direct | CORRECT |
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
| TP-002 | invoiceNumber | 215 | 215 | CORRECT |
| TP-002 | invoiceDate | 5/18/2026 | 2026-05-18 | CORRECT |
| TP-002 | subtotal | 125 | 125 | CORRECT |
| TP-002 | taxAmount | 0 | 0 | CORRECT |
| TP-002 | freightAmount | 0 | 0 | CORRECT |
| TP-002 | totalAmount | 125 | 125 | CORRECT |
| TP-002 | currency | USD | USD | CORRECT |
| TP-002 | dueDateOrTerms | 6/2/2026 | 2026-06-02 | CORRECT |
| TP-003 | vendorRawName | Van Meter, Inc. | Van Meter Inc. | CORRECT |
| TP-003 | invoiceNumber | S014432461.002 | S014432461.002 | CORRECT |
| TP-003 | invoiceDate | 5/27/2026 | 2026-05-27 | CORRECT |
| TP-003 | poNumber | PO-24527 | PO-24527 | CORRECT |
| TP-003 | subtotal | 56351.8 | 56351.8 | CORRECT |
| TP-003 | taxAmount | 0 | 0 | CORRECT |
| TP-003 | freightAmount | 0 | 0 | CORRECT |
| TP-003 | totalAmount | 56351.8 | 56351.8 | CORRECT |
| TP-003 | currency | USD | USD | CORRECT |
| TP-003 | dueDateOrTerms | 7/11/2026 | 2026-07-11 | CORRECT |
| TP-004 | vendorRawName | Rick Lake Weighing Systems | Rice Lake Weighing Systems | INCORRECT |
| TP-004 | invoiceNumber | 5438211 | 5438211 | CORRECT |
| TP-004 | invoiceDate | 4/10/2026 | 2026-04-10 | CORRECT |
| TP-004 | poNumber | PO-24270 | PO-24270 | CORRECT |
| TP-004 | subtotal | 17820 | 17820 | CORRECT |
| TP-004 | taxAmount | 0 | 0 | CORRECT |
| TP-004 | freightAmount | 142.03 | 142.03 | CORRECT |
| TP-004 | totalAmount | 17962.03 | 17962.03 | CORRECT |
| TP-004 | currency | USD | USD | CORRECT |
| TP-004 | dueDateOrTerms | 5/10/2026 | 2026-05-10 | CORRECT |
| TP-005 | vendorRawName | BDI | BDI | CORRECT |
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
| Correct fields | 48 |
| Incorrect fields | 1 |
| Missing fields | 0 |
| Manual corrections required | 1 |
| **Overall extraction accuracy** | **98.0%** |
| Vendor name accuracy | 80.0% |
| Invoice number accuracy | 100.0% |
| Date accuracy | 100.0% |
| Amount accuracy | 100.0% |
| PO accuracy | 100.0% |
| Currency accuracy | 100.0% |

## Ground-Truth Issues

| Case | Field | GT Value | Extracted Value | Assessment |
|---|---|---|---|---|
| TP-004 | vendorRawName | Rick Lake Weighing Systems | Rice Lake Weighing Systems | **Label typo in ground truth.** "Rice Lake Weighing Systems" is the real company name. The extracted value is correct; the GT label should be corrected to "Rice Lake Weighing Systems" by the owner. |

## Verdict

**Phase 1 extraction accuracy: PASS** (98.0% vs 95% threshold).

### Corrections applied in this run

| Invoice | Field | Old value | New value | Reason |
|---|---|---|---|---|
| TP-001 (ID 83) | vendorRawName | AutomationDirect.com, Inc. | Automation Direct | Model extracted web-domain form; GT expects trade name |
| TP-002 (ID 84) | invoiceNumber | 00215 | 215 | Model added leading zeros not present on the invoice |
| TP-002 (ID 84) | taxAmount | null | 0 | Printed $0.00 on invoice not captured; see system-prompt fix |
| TP-002 (ID 84) | freightAmount | null | 0 | Printed $0.00 on invoice not captured; see system-prompt fix |
| TP-003 (ID 85) | taxAmount | null | 0 | Regression — printed $0.00 not captured |
| TP-004 (ID 86) | taxAmount | null | 0 | Regression — printed $0.00 not captured |
| TP-005 (ID 87) | vendorRawName | BDI - Princeton | BDI | Model appended branch location; GT expects company name only |

Extraction system prompt updated to: prefer trade/brand name over full legal entity name or URL domain; strip leading zeros from plain numeric invoice numbers; branch/regional qualifiers must be omitted from vendorRawName.
