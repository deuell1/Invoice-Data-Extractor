---
name: Clerk auth setup
description: How Clerk auth is wired in this project — server middleware, client provider, smoke-test bypass, actor pre-fill pattern.
---

# Clerk Auth Setup

## Status
Fully wired. Clerk provisioned (not_configured → managed), all API routes behind requireAuth, frontend has ClerkProvider + sign-in/sign-up pages.

## Server side (`artifacts/api-server`)
- `@clerk/express` + `@clerk/shared` + `http-proxy-middleware` installed
- `src/middlewares/clerkProxyMiddleware.ts` — copied from skill template, handles prod proxy
- `src/middlewares/requireAuth.ts` — checks Clerk session; also accepts `Authorization: Bearer <SMOKE_TEST_API_KEY>` for smoke tests
- `src/app.ts` — mounts proxy before body parsers, then `clerkMiddleware`, then routes
- `src/routes/index.ts` — `healthRouter` registered before `requireAuth`; all other routers after it

## Client side (`artifacts/invoice-capture`)
- `@clerk/react` + `@clerk/themes` installed
- `src/App.tsx` — complete rewrite: `WouterRouter` → `ClerkProvider` → `QueryClientProvider`; routes: `/`, `/sign-in/*?`, `/sign-up/*?`, catch-all protected app
- `src/pages/home.tsx` — dark landing page with "Sign in" CTA (required public home route per skill)
- `src/pages/sign-in.tsx` / `sign-up.tsx` — in `App.tsx` as inline components
- `src/components/layout.tsx` — sidebar footer shows `useUser()` display name + sign-out button
- `src/hooks/use-actor.ts` — `useActorName()` returns fullName | email | userId from Clerk
- `src/index.css` — `@layer theme, base, clerk, components, utilities;` added before `@import "tailwindcss"`
- `vite.config.ts` — `tailwindcss({ optimize: false })` to prevent Clerk theme layer reordering in prod
- `public/logo.svg` — simple "IC" logo for Clerk sign-in card

## Actor pre-fill
`useActorName()` hook used in:
- `exception-queue.tsx` → `AssignOwnerModal` actor state init + useEffect
- `vendor-admin.tsx` → newVendor.actor init via useEffect; reset to actorName (not "") after create
- `vendor-detail.tsx` → `openEdit()` injects actorName into EditForm

## Smoke-test bypass
**Why:** smoke test is a server-side node script with no browser session; it needs to hit protected endpoints.
**How:** `SMOKE_TEST_API_KEY` env var (stored in shared env). `requireAuth` checks `Authorization: Bearer <key>` before Clerk. `smoke_test.mjs` passes it via `SMOKE_API_KEY` const. Raw `fetch` calls (download, inline export) also manually set the header.

## Tailwind v4 + Clerk theme rules (non-obvious)
- `@layer` declaration must be first line of index.css, BEFORE `@import "tailwindcss"`
- `tailwindcss({ optimize: false })` is REQUIRED in vite.config.ts or Clerk UI breaks in prod builds
- `cssLayerName: "clerk"` in appearance object ties these together
