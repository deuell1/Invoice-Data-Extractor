---
name: Vendor matching service
description: Controlled vendor ID assignment from vendorRawName; fuzzy scoring, exception routing, status transitions.
---

## Rule
VendorID MUST come from the controlled vendor matching pipeline only — never from AI/OCR output. `vendorRawName` is the raw string from the document; it is scored against `vendor_id.vendorName` and `vendor_id.aliases` to produce a match.

**Why:** AP controls require that the vendor linked to a payment comes from the internal vendor master, not unverified OCR text.

## Algorithm (vendorMatcher.ts)
- Normalize: lowercase, strip punctuation (`/[^\w\s]/g`), collapse whitespace
- Score: 60% Jaccard token overlap + 40% Levenshtein (normalized) + 10% bonus when vendorRawName tokens ⊆ candidate tokens
- Threshold: `VENDOR_MATCH_THRESHOLD = 0.85`
- Aliases: each vendor alias scored alongside vendorName; matched alias stored in audit log

## Exception routing
| Outcome | Condition | Exception reason |
|---|---|---|
| no_match | 0 vendors in DB | "No vendors found in vendor master" |
| no_match | best score = 0 | "No vendor match found..." |
| low_confidence | 0 < score < 0.85 | "Vendor match confidence X% below 85% threshold (best: ...)" |
| inactive | vendor.isActive = false | "Vendor '...' is inactive" |
| on_hold | vendor.onHold = true | "Vendor '...' is on hold" |
| matched | score ≥ 0.85, active, not on hold | success — store vendorId + vendorMatchScore |

## Status transition on success
When match succeeds, check if invoice is currently in EXCEPTION with an exceptionReason that contains "vendor" or "match". If so, revert status to `PENDING_EXTRACTION` and clear exceptionReason. Otherwise leave status unchanged.

**Why:** Avoids accidentally clearing non-vendor exception reasons (e.g. a duplicate flag) when re-running vendor match.

## API
- `POST /invoices` — auto-runs matching when `vendorRawName` is supplied
- `POST /invoices/:id/match-vendor` — manual re-trigger; used by "Re-run Match" button in extraction-review.tsx

## How to apply
Any time vendor assignment logic needs to change, update `vendorMatcher.ts` only. Do not write vendorId to invoices anywhere else in the codebase.
