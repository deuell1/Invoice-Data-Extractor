---
name: Invoice extraction confidence scaling
description: Two different numeric scales for confidence in the invoice-capture app — overall vs per-field.
---

In the invoice-capture extraction pipeline there are TWO confidence scales that must not be conflated:

- **Overall** `confidenceScore` is stored normalized to **0–1** (e.g. 0.95). UI multiplies by 100 to display; low-confidence threshold compares against **0.85**.
- **Per-field** `fieldConfidence` is a JSON map stored with values on a **0–100** scale (e.g. 95). UI displays the value directly; low-confidence threshold compares against **85**.

**Why:** mixing them silently breaks the "below 85" highlight logic — a per-field value of 0.95 would look "low" and an overall of 95 would look "high" if the wrong scale is assumed.

**How to apply:** when adding new confidence-driven UI or validation, check which value you have. `fieldConfidence` keys are internal field names (vendorRawName, invoiceNumber, invoiceDate, dueDate, paymentTerms, poNumber, subtotal, taxAmount, freightAmount, totalAmount, currency). `lowConfidenceFields` is a comma-joined string of those keys, derived server-side from the 0–100 values against threshold 85.
