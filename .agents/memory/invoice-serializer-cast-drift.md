---
name: Invoice numeric serializer cast drift
description: Numeric invoice_capture columns must be Number()-cast in BOTH invoice serializers or the source-documents endpoint 500s.
---

When adding any `numeric(...)` column to the `invoice_capture` schema, the value
arrives from Drizzle as a **string**, but the OpenAPI response schemas expect a
JS `number`. Two separate serializers must each cast it:

- `serializeInvoice` in `artifacts/api-server/src/routes/invoices.ts`
- `serializeSourceInvoice` in `artifacts/api-server/src/routes/sourceDocuments.ts`

**Why:** These two serializers were written independently and there is no shared
helper. The tie-out hardening added `discountAmount`, `otherChargesAmount`,
`tieOutExpectedTotal`, `tieOutDifference` and only the invoices route was cast at
first — `GET /api/source-documents/:id` then threw a ZodError ("Expected number,
received string") and returned HTTP 500 the moment any child invoice had those
fields populated, silently breaking the review screen's batch / Prev–Next nav for
split documents.

**How to apply:** Any new numeric invoice column → add a `row.x != null ? Number(row.x) : null`
cast in *both* serializers in lockstep. Grep both files for an existing cast
(e.g. `freightAmount`) and mirror it. Consider centralizing into one shared
helper to remove the drift risk entirely.
