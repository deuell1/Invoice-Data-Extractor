---
name: Accuracy harness preflight vs Haiku
description: PF-03 to PF-06 preflight checks in run-accuracy.mjs incorrectly flag Claude Haiku's natural extraction output as DB patches; use Suite 11 smoke result as authoritative substitute.
---

## The conflict

`run-accuracy.mjs` has a baseline-preflight guard (in `preflight.mjs`, frozen) with checks
PF-03 through PF-06. These checks assert:

- PF-03: TP-002 BzRhino `taxAmount === 0` → flagged as DB patch
- PF-04: TP-002 BzRhino `freightAmount === 0` → flagged as DB patch
- PF-05: TP-003 Van Meter `taxAmount === 0` → flagged as DB patch
- PF-06: TP-004 Rice Lake `taxAmount === 0` → flagged as DB patch

These checks were calibrated for GPT-4o-mini, which extracted `null` for those fields
(field not found). Manual DB patches later set them to `0` to match ground truth, and the
preflight was written to detect that patched `0` as evidence of contamination.

**Claude Haiku naturally extracts `0` for these fields** — the invoices genuinely have $0
tax/freight, and Haiku correctly returns 0. The preflight fires on Haiku's real output,
blocks the harness, and cannot be bypassed (harness is frozen).

## How to get an authoritative Haiku accuracy score

**Use Suite 11 of the smoke test.** Suite 11 runs the same five test-pack invoices with
the same ground-truth CSV and the same scoring logic as `run-accuracy.mjs`, but WITHOUT the
preflight guard. The 2026-08-12 run showed **54/54 = 100.0%** — this is the authoritative
P5 measurement.

Results documented in: `uat/extraction-accuracy/results/accuracy-2026-08-12-haiku.md`

## How to fix for future Haiku runs

Update `preflight.mjs` `BASELINE_PREFLIGHT`:
- Retire PF-03, PF-04, PF-05, PF-06 (these signatures are now natural Haiku output)
- Keep PF-01 (patched vendor name "Automation Direct"), PF-02 (stripped "215"), PF-07 (patched "BDI")
- Add new checks for any genuinely wrong values a future model would produce

**Why:** The preflight contract says new checks must be added for every corrections file.
Retiring the stale GPT-era checks requires no new corrections file, just removing the
entries and updating `CORRECTIONS_REGISTRY` (currently empty).
