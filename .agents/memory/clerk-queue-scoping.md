---
name: Clerk queue scoping pattern
description: How AP_CLERK vs AP_MANAGER server-side scoping is enforced on /exceptions and /invoices routes.
---

# Clerk queue scoping pattern

## The rule
AP_CLERK must be scoped server-side regardless of query params — callers cannot widen scope by omitting or overriding filters.

**On `/exceptions`:**
- AP_CLERK: always filter by `(exceptionOwnerClerkId = req.clerkUserId) OR (exceptionOwner IS NULL AND exceptionOwnerClerkId IS NULL)`
- AP_MANAGER: honor optional `assignedTo` (Clerk user ID) for "My work" toggle; no filter = show all

**On `/invoices`:**
- AP_CLERK + `status=EXCEPTION`: same exceptionOwnerClerkId scoping as /exceptions
- AP_CLERK + any other status (PENDING_APPROVAL, no status, etc.): `submittedBy = req.clerkUserId`
- AP_MANAGER: honor optional `assignedTo` → filters by `submittedBy`; no filter = show all

**Why:**
Security review rejected UI-level-only changes. Server must enforce independently since authenticated clerks can call the API directly with crafted params.

## Unassigned vs. assigned-by-display-name
"Truly unassigned" = BOTH `exceptionOwner IS NULL AND exceptionOwnerClerkId IS NULL`.
Items where `exceptionOwner` has a value but `exceptionOwnerClerkId` is null (display-name-only assignment) are treated as **assigned** — not unassigned. They are hidden from all other clerks until a proper Clerk ID is stored.

**Why:**
If `isNull(exceptionOwnerClerkId)` alone were used for "unassigned", display-name-only assignments would leak to all clerks.

## ownerClerkId field
`exceptionOwnerClerkId` stores the Clerk user ID of the assigned exception owner.
- Auto-filled for self-assignment in the UI (when owner name === actorName)
- Managers can supply it manually in the AssignOwnerModal for cross-user assignment
- The assign endpoint (`/exceptions/:id/assign`) receives `ownerClerkId` in the body via `ExceptionAssignInput`

## How to apply
- Any new queue route for in-progress AP work must read `req.clerkUserRole` and `req.clerkUserId` and enforce scoping before building the WHERE clause.
- Never rely on `assignedTo` query param being set by the caller for AP_CLERK — always override it.
