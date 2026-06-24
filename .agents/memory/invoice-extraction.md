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
Pipeline order: extract -> vendor match -> validation. Validation routes to
EXCEPTION for low overall confidence, any low-confidence field, missing required
fields (vendor, invoice number, total, invoice date), or duplicate
(vendorId + invoiceNumber). A clean invoice is **auto-advanced to
PENDING_APPROVAL**.
**Why:** this replaced an earlier manual processor "Submit for Approval" review
step — done to match the user's written spec for straight-through processing of
clean invoices. If a human-review gate is reintroduced, this auto-advance is the
line to change.
