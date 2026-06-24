---
name: Monorepo db schema changes
description: Steps required after editing lib/db Drizzle schema so consumers typecheck against the new shape.
---

# Editing the lib/db Drizzle schema

After changing a table in `lib/db/src/schema/*`:

1. Apply to the database: `pnpm --filter @workspace/db run push` (drizzle-kit push).
2. Regenerate declaration output: `pnpm run typecheck:libs` (root) — this runs
   `tsc --build`, which rebuilds `lib/db/dist/**/*.d.ts`.

**Why:** consumers like `@workspace/api-server` resolve `@workspace/db` through
TypeScript **project references**, which read the emitted `dist` declarations,
not `src`. New columns appear in `src` immediately but the consumer's `tsc`
keeps failing (e.g. "X does not exist in type ...{insert}...") until the `dist`
declarations are rebuilt. Runtime works (exports point at `src`); only the
type check is stale.
