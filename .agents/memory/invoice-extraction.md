---
name: Invoice extraction service
description: OpenAI extraction conventions, confidence scaling, and post-extraction routing decisions for the AP invoice app.
---

# Live OpenAI invoice extraction

## OpenAI Responses API Structured Outputs shape
For `client.responses.create`, strict JSON schema goes under `text.format` with
`type`, `name`, `strict`, and `schema` at that level — NOT nested under a
`json_schema` key (that nesting is the Chat Completions shape).
**Why:** getting this wrong silently falls back / errors. Strict mode also
requires every property in `required` and `additionalProperties: false`, with
nullable fields typed as `["string","null"]`.

## Confidence scale convention
The model returns confidence on a 0–100 scale (overall + per field). It is
normalized to 0–1 before DB storage (`confidence_score` is `numeric(5,4)`), and
the review UI multiplies by 100 for display.
**Why:** mixing the two scales causes thresholds (85) and the % badge to be
wrong. Keep model-facing = 0–100, stored = 0–1.
**How to apply:** any new confidence field follows the same convert-on-ingest rule.

## Field-name mapping (model -> internal)
Model uses `poNumberRaw`, `invoiceTotal`, `amountDue`; internal/app fields use
`poNumber` and a single `totalAmount`. `totalAmount` prefers `amountDue`, falling
back to `invoiceTotal` (the final payable). `raw_extraction` stores the verbatim
model JSON for audit; `field_confidence` stores per-field scores keyed by the
internal field names the review UI understands.

## Post-extraction routing decision
Pipeline order: extract -> vendor match -> validation. A single authoritative
engine (`validationService.validateInvoice`) runs after extraction, after vendor
matching, on submit, and on approval. It splits findings into **blocking** vs
**warnings**:
- blocking (missing/invalid required fields, vendor required/inactive/on-hold,
  due date neither present nor derivable, total ≤ 0, non-USD currency, duplicate
  vendorId+invoiceNumber, header tie-out mismatch) → routes to **EXCEPTION**.
- warnings/low-confidence (overall conf < 0.85, low critical-field conf, missing
  PO) → stays **PENDING_APPROVAL** with `reviewStatus = NEEDS_REVIEW` (a flag,
  not a separate status).
- clean → **PENDING_APPROVAL**.
There is **no NEEDS_REVIEW status** in the enum — needs-review is PENDING_APPROVAL
+ the reviewStatus flag.
**Why:** low confidence / missing PO are NOT hard stops — they should be visible
for human review but not blocked, per the validation-tightening spec. Earlier
behavior (any low confidence → EXCEPTION) was too aggressive.
**How to apply:** only ever downgrade status via this engine; it guards terminal
states (won't downgrade APPROVED/POSTED). Approval re-runs it; exception override
on approve requires a documented reason.
