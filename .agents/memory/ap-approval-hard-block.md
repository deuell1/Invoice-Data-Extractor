---
name: AP approval vendor hard-block
description: Why missing-vendor exceptions cannot be overridden at approval, unlike other exceptions.
---

The approve route (`POST /invoices/:id/approve`) has a documented-exception **override** path: an invoice in EXCEPTION can normally be approved if the approver supplies a documented `reason`, even when validation still has blocking issues.

A subset of vendor reasons is exempt from that override and is a **hard block** (always 422, even with a reason): the reasons in `VENDOR_HARD_BLOCK_REASONS` — "Vendor Name Not Extracted", "Vendor Not Found", "Low Vendor Match Confidence". These all mean there is no usable matched `vendorId`.

**Why:** A Phase 1 requirement states approval must be blocked when the vendor name or controlled-vendor match is missing — these must never be approvable, because posting an invoice with no verified vendor is unacceptable in AP. "Vendor Inactive" / "Vendor On Hold" are *matched* vendors (vendorId present) and intentionally remain overridable with a documented reason.

**How to apply:** Keep the canonical reason strings in `VENDOR_REASON` / `VENDOR_HARD_BLOCK_REASONS` (validationService.ts) as the single source of truth; the approve route imports them. If you add a new "no usable vendor" condition, add its reason to the hard-block list, or approval override will silently let it through.
