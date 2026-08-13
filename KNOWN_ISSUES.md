# Known Issues & Accepted Gaps

Last updated: 2026-08-13

This file tracks deliberate, informed decisions to defer specific gaps —
not bugs that were missed. Each entry states the gap, the impact, and why
it was deferred rather than fixed immediately. Revisit this file before
each phase sign-off.

## CLERK_WEBHOOK_SECRET is not configured

**Gap:** The Clerk webhook signing secret was never set. `POST /webhooks/clerk`
returns 500 on every call — verified to fail closed, never skips signature
verification.

**Impact:** Cosmetic only. The webhook exists solely to evict a cached
display name (`actorNameCache`) when a Clerk user updates their profile.
Without it, an updated name takes up to `CLERK_NAME_CACHE_TTL_MS` (default
5 minutes) to appear correctly in the audit trail instead of updating
instantly. No security exposure, no data-integrity impact.

**Why deferred:** This app's Clerk instance has no standalone account —
it's provisioned via Replit's "Clerk for Platforms" integration. The only
UI path to the signing secret (Tools → User & Auth → Configure → Advanced)
is gated behind Replit's Pro plan. No Clerk Backend API path exists to
retrieve or rotate it instead. Not worth a plan upgrade for a 5-minute
display-name cache lag.

**Revisit if:** Replit Pro is adopted for other reasons — this becomes a
5-minute fix at that point.

## No proactive deployment monitoring/alerting

**Gap:** Replit's Deployments pane shows logs and status on request, but
does not proactively notify (email/SMS/webhook) on failure.

**Impact:** An outage is discovered by someone noticing, not by an alert.

**Why deferred:** Explicit, informed decision given current scale (one AP
team, not high-traffic). Confirmed by checking the Deployments pane
directly rather than assuming.

**Revisit if:** Traffic or team size grows, or after any incident where
detection lag mattered. Lightest fix identified: an external uptime
monitor (e.g. UptimeRobot, Better Uptime) polling GET /healthz — which
already checks real DB connectivity, not just process liveness — on a
5-minute interval with email/SMS alerting.

## Dev-database accumulated test debris

**Gap:** As of this writing, the dev Postgres instance has 1,167 orphaned
vendor_audit_log rows (from vendors deleted outside the API, bypassing the
app's explicit audit-log cleanup) and one leftover test invoice referencing
vendor RIC270 (RICE LAKE WEIGHING SYSTEMS) that blocks the vendor cleanup
FULL_RESET smoke test (Suite 13 and Suite 14 in smoke_test.mjs).

**Impact:** None on production — this is dev-only. Causes two expected,
known smoke-test failures on every run; do not mistake these for new
regressions. Any new smoke-test failure beyond these two specific ones is
real and should be investigated.

**Why deferred:** Cosmetic, dev-only, no functional impact. A cleanup
script already exists for this exact purpose (cleanVendorAuditOrphans.ts)
but has not yet been run.

**Revisit if:** Convenient — run cleanVendorAuditOrphans.ts and manually
resolve or void the leftover Rice Lake test invoice referencing vendor
id 1658.

## Baseline load-test results (2026-08-13)

Recorded from tests/load/basic-load.mjs, run against the dev environment
(localhost:8080) at 10 connections / 30s per endpoint, per the entry above
this one. This is now the actual baseline referenced by that entry.

| Endpoint | p50 | p99 | req/s | errors |
|---|---|---|---|---|
| GET /invoices | 25ms | 39ms | 387 | 0/11,619 |
| GET /invoices/stats | 7ms | 16ms | 1,205 | 0/36,135 |
| GET /exceptions | 52ms | 79ms | 187 | 0/5,618 |
| GET /vendors | 17ms | 33ms | 551 | 0/16,525 |

Zero errors across ~70,000 total requests.

**Worth noting, not urgent:** GET /exceptions is 2-7x slower than the other
three endpoints, with correspondingly lower throughput (mechanically
consistent — not two separate signals). Still well within acceptable range
for a human-facing review-queue screen. Worth checking whether
invoice_capture.review_status has an index if this number gets meaningfully
worse in a future re-run — that's the most likely explanation for a filtered
query being slower than the plain list endpoints it's being compared against.

**Scope caveat:** this ran against dev, not production. Dev currently holds
more rows (2,000+ vendors, 1,167 orphaned audit rows per the entry above)
than production's clean ~564, so if this baseline is biased at all, it's
biased pessimistic rather than optimistic.
