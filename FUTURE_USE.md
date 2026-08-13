# Future Use — Deliberately Deferred, Not Currently Planned

Last updated: 2026-08-13

This file is for scope decisions, not defects. Each entry names something
intentionally excluded right now, why, and the specific condition under
which it should be reconsidered. If there's no active plan or timeline for
an item, it belongs here, not in KNOWN_ISSUES.md or an active backlog.

## Remit-to / vendor-banking review validation

**What:** Automated fuzzy-matching of an invoice's remit-to address against
the vendor master's RemitToAddress, flagging mismatches for review.

**Why deferred:** This app does not auto-pay anything — ERP posting is
manual, and a human explicitly reviews remit-to details before payment is
released. That human review is the actual control; automated matching on
top of it is defense-in-depth for a threat model (unattended automated
payment release) that doesn't exist here.

**Revisit if:** An auto-pay or automatic payment-release feature is ever
proposed. At that point this becomes a required control, not optional.

## Dual-model extraction review pattern (retired, not returning)

**What:** extractionCompare.ts, HAIKU_REVIEWER_RUNBOOK.md, and the
extraction_review schema — a blind dual-model (two independent extractions
compared against each other) review pattern.

**Status:** None of these three ever existed in this repo. The pattern was
retired before it was built, not built and then removed. Owner-confirmed
2026-08-13.

**Revisit if:** A second-opinion or cross-model verification pattern is
ever reconsidered for extraction — this note explains why the original
version doesn't exist and isn't a rediscoverable asset to restore.

## Explicitly out-of-scope items from the original MVP scope document

**What:** The original invoice-capture scope document lists these as
explicitly excluded from MVP and later phases, with no current
implementation and no active plan:
- Fully touchless posting without AP review
- Automatic new vendor creation
- Automatic vendor banking or remit-to changes
- Full 3-way match automation
- Automatic payment release
- Complex tax coding
- GL account coding automation
- Vendor statement reconciliation
- Advanced fraud detection
- Multi-currency processing

**Why deferred:** Per the original scope document's own phasing — these are
Phase 3/4 concepts (ERP integration, automation) or explicitly named
non-goals for the MVP, not oversights.

**Revisit if:** Any specific item above is proposed as real, prioritized
work — at that point it should move out of this file into an active
backlog with its own scoping, not be built directly from this one-line
description.
