---
name: Approval hard-blocks vs exception override
description: Which validation outcomes must be checked BEFORE the exception-override path in the invoice approve route.
---

In the invoice approve route (`POST /invoices/:id/approve`), an EXCEPTION-state
approval with a documented `reason` deliberately bypasses `outcome.blocking`
(the `!isExceptionApproval` guard). So putting a check into `outcome.blocking`
is NOT enough to make it un-approvable.

**Rule:** Any validation outcome that must be *non-overridable* (can never be
exception-approved) needs its own explicit early-return guard placed BEFORE the
`if (outcome.blocking.length > 0 && !isExceptionApproval)` line — alongside the
vendor-hard-block and duplicate-FAIL guards. Current non-overridable set:
vendor hard block, duplicate FAIL, header tie-out FAIL.

**Why:** "FAIL blocks approval" requirements are violated silently if you only
add the failure to `outcome.blocking`, because exception override skips it. A
tie-out FAIL was approvable with a reason until a dedicated guard was added.

**How to apply:** When a spec says a check must block approval unconditionally,
add `if (outcome.checks.<thatCheck> === "FAIL") return 422` before the
exception-override branch; reserve `outcome.blocking` for issues that a
documented exception override is allowed to bypass.
