---
name: Role-based access control
description: AP_MANAGER vs AP_CLERK enforcement pattern — where roles live, how they're checked server-side and client-side, and the smoke-test bypass.
---

# Role-Based Access Control

## The rule
Two roles: `AP_MANAGER` (can approve, post, export, delete vendors) and `AP_CLERK` (intake, edit, exceptions only). Any authenticated user without an explicit `AP_MANAGER` role in Clerk publicMetadata is treated as `AP_CLERK` (least-privilege default).

**Why:** Role enforcement must not rely on client trust — guards live at the API level.

## Server-side pattern
`requireAuth` (in `artifacts/api-server/src/middlewares/requireAuth.ts`) reads `auth.sessionClaims?.publicMetadata?.role` and sets `(req as any).clerkUserRole`. The `requireRole("AP_MANAGER")` factory returns a middleware that returns 403 when the role doesn't match.

Smoke-test API key bypass grants `AP_MANAGER` automatically so tests can exercise guarded routes.

**Guarded routes:**
- `POST /invoices/:id/approve` → AP_MANAGER
- `POST /invoices/bulk-approve` → AP_MANAGER
- `PATCH /invoices/:id/voucher` (posts invoice) → AP_MANAGER
- `GET /invoices/export` (legacy CSV) → AP_MANAGER
- `POST /exports` → AP_MANAGER
- `DELETE /vendors/:id` → AP_MANAGER

## Client-side pattern
`artifacts/invoice-capture/src/hooks/use-role.ts` exports `useRole()` and `useIsManager()`. They read `user.publicMetadata.role` from Clerk's `useUser()` hook. Mock clerk (`src/e2e/mock-clerk.tsx`) sets `publicMetadata: { role: "AP_MANAGER" }` so E2E tests see approve/export buttons enabled.

Role is displayed in the sidebar (`layout.tsx`) next to the user's name with a shield icon.

**How to apply:** Whenever adding a new mutating route that should be manager-only, import `requireRole` from `../middlewares/requireAuth` and add it as inline middleware before the route handler. Mirror the restriction in the UI with `useIsManager()`.
