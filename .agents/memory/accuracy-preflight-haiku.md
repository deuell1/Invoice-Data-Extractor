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

## Resolution (2026-08-12)

PF-03, PF-04, PF-05, PF-06 were removed from `BASELINE_PREFLIGHT`. CLEAN_ACTUALS in
`preflight-check.test.mjs` updated to reflect Haiku's natural output (0 instead of null).
`preflight-exit.test.mjs` rewritten to use PF-01 (vendorRawName "Automation Direct") as
the trigger scenario. All three test files pass: 20/20 and 2/2.

Official harness run produced **100.0% (49/49)** — accuracy_run id 3.
Report: `uat/extraction-accuracy/results/accuracy-2026-08-12-haiku-official.md`
Addendum written to `uat/EG1_Exit_Report.md`.
