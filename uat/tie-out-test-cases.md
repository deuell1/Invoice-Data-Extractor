# Phase 1 Tie-Out UAT Test Cases

Hardening validation for the invoice header tie-out. The engine computes:

```
Expected Total = Subtotal + Tax + Freight + Other Charges − Discount
Difference     = Total − Expected Total
```

Status thresholds (on `|Difference|`):

| Status | Condition | Effect |
|---|---|---|
| `PASS` | ≤ $0.01 | Clean; no review item. |
| `WARNING` | > $0.01 and ≤ $0.05 | Visible warning; **does not** block approval. |
| `FAIL` | > $0.05 (subtotal **and** total present) | Blocking; routes invoice to **EXCEPTION**. |
| `SKIPPED` | subtotal **or** total missing | Cannot reconcile; surfaced as a review warning when the total is present, never auto-blocks. |

Discount magnitude is always subtracted: a discount entered as `50`, `-50`, or `(50)`
all reduce the expected total by $50. Optional components (tax/freight/discount/other)
default to $0 when blank and never trigger a false failure on their own.

## How to run

These cases are driven through the live API against a seeded invoice (any invoice
with `subtotal` and `totalAmount` set). Editing an amount field re-runs the
authoritative validation engine, which recomputes and persists the tie-out result.

```bash
BASE="$REPLIT_DEV_DOMAIN"
# Inspect current tie-out state
curl -s "https://$BASE/api/invoices/<ID>" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log({status:d.status,tieOutStatus:d.tieOutStatus,expected:d.tieOutExpectedTotal,diff:d.tieOutDifference,explanation:d.tieOutExplanation});})"
# Edit an amount (triggers revalidation)
curl -s -X PATCH "https://$BASE/api/invoices/<ID>" -H "Content-Type: application/json" -d '{"otherChargesAmount":100,"editorRole":"AP_PROCESSOR"}'
```

Restore the invoice to its original amounts after testing so seeded data returns to baseline.

## Test cases

| # | Scenario | Inputs (Sub / Tax / Freight / Discount / Other / Total) | Expected status | Expected `tieOutExpectedTotal` | Expected effect |
|---|---|---|---|---|---|
| T-01 | Exact match | 2400 / 0 / 0 / 0 / 0 / 2400 | `PASS` | 2400.00 | No review item; status stays approvable. |
| T-02 | Match with tax + freight | 1000 / 80 / 20 / 0 / 0 / 1100 | `PASS` | 1100.00 | No review item. |
| T-03 | Discount applied (positive) | 1000 / 0 / 0 / 50 / 0 / 950 | `PASS` | 950.00 | Discount reduces expected total. |
| T-04 | Discount entered negative | 1000 / 0 / 0 / -50 / 0 / 950 | `PASS` | 950.00 | Magnitude subtracted — same as T-03. |
| T-05 | Other charges added | 1000 / 0 / 0 / 0 / 25 / 1025 | `PASS` | 1025.00 | Other charges increase expected total. |
| T-06 | Penny rounding (within $0.01) | 1000 / 0 / 0 / 0 / 0.01 / 1000 | `PASS` | 1000.01 | Diff $0.01 → still PASS. |
| T-07 | Minor rounding (WARNING band) | 2400 / 0 / 0 / 0 / 0.03 / 2400 | `WARNING` | 2400.03 | Diff $0.03 → `NEEDS_REVIEW`; approval **allowed**. |
| T-08 | Upper WARNING edge | 1000 / 0 / 0 / 0 / 0.05 / 1000 | `WARNING` | 1000.05 | Diff $0.05 → still WARNING (inclusive). |
| T-09 | Material mismatch (FAIL) | 2400 / 0 / 0 / 0 / 100 / 2400 | `FAIL` | 2500.00 | Diff $100 → invoice routed to **EXCEPTION**; approval blocked. |
| T-10 | Just over WARNING (FAIL) | 1000 / 0 / 0 / 0 / 0.06 / 1000 | `FAIL` | 1000.06 | Diff $0.06 → blocking. |
| T-11 | Missing subtotal | (blank) / 0 / 0 / 0 / 0 / 1000 | `SKIPPED` | null | Total present, subtotal missing → review warning, not blocked. |
| T-12 | Missing total | 1000 / 0 / 0 / 0 / 0 / (blank) | `SKIPPED` | null | Handled by the existing "total missing" amount check (blocking). |
| T-13 | FAIL is non-overridable | T-09 invoice in `EXCEPTION` | `FAIL` | 2500.00 | `POST /invoices/:id/approve` with a documented reason returns **422** — a tie-out `FAIL` can never be exception-overridden; amounts must be corrected first. WARNING (T-07) remains approvable. |

## Cross-cutting checks

- **Persistence:** `tieOutStatus`, `tieOutExpectedTotal`, `tieOutDifference`, and
  `tieOutExplanation` are written on every validation run and returned by
  `GET /invoices/:id` and the list endpoint.
- **Audit:** editing `subtotal`, `taxAmount`, `freightAmount`, `discountAmount`,
  `otherChargesAmount`, or `totalAmount` writes a `FIELD_UPDATED` audit entry with
  old → new values.
- **CSV export:** approved/posted export includes `DiscountAmount`,
  `OtherChargesAmount`, `TieOutExpectedTotal`, `TieOutDifference`, `TieOutStatus`,
  and `TieOutExplanation` columns.
- **KPIs / routing:** a `FAIL` sets `validationStatus = FAILED` and moves the
  invoice to `EXCEPTION`; a `WARNING` sets `validationStatus = NEEDS_REVIEW` while
  remaining approvable.
- **UI:** the Extraction Review "Header Tie-Out" panel shows the six editable
  amount fields plus Expected Total, Difference, a colored status badge, and the
  plain-language explanation; values refresh after each edit.

## Verified this cycle (live API)

T-01 (PASS), T-07 (WARNING), and T-09 (FAIL) were exercised end-to-end against a
seeded invoice and confirmed to produce the expected status, expected total,
difference, explanation, and routing, then reverted to baseline. The remaining
cases follow the same deterministic engine and can be run with the commands above.
