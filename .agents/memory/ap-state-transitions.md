---
name: AP invoice state-transition guards
description: Which invoice status transitions must be blocked at the API layer.
---

# AP invoice state-transition guards

Every endpoint that mutates invoice `status` must enforce the AP workflow state
machine itself — do not rely on the UI to only offer valid transitions.

**Why:** the UI hides invalid actions, but the API endpoints are independently
reachable; without server-side guards an invoice can skip approval or reverse a
terminal decision (audit/GL integrity risk).

**How to apply:**
- Posting (assign voucher) requires status `APPROVED` (or already `POSTED`, for
  voucher correction) — never post an un-approved/in-exception invoice.
- `POSTED` is terminal: block reject and block the general-purpose status-change
  endpoint from moving a posted invoice.
- Exception approval requires a documented reason; approve re-runs validation and
  blocks non-exception invoices with blocking issues.
- Return 422 for invalid transitions and record `oldValue` in the audit entry.
