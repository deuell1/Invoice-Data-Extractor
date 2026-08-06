---
name: api-client-react generated types rebuild
description: lib/api-client-react is a composite TS project; invoice-capture references its dist/.d.ts via tsconfig project references — editing src/generated/ requires a rebuild step.
---

## Rule
After editing any file in `lib/api-client-react/src/generated/` (e.g. `api.schemas.ts`), rebuild the package before running invoice-capture typecheck:

```bash
pnpm --filter @workspace/api-client-react exec tsc --build tsconfig.json
```

Without this, `artifacts/invoice-capture` sees the stale compiled `.d.ts` in `lib/api-client-react/dist/` and reports spurious type errors.

**Why:** `artifacts/invoice-capture/tsconfig.json` has `"references": [{ "path": "../../lib/api-client-react" }]`. TypeScript composite project references resolve to `dist/` declarations, not the source `.ts` files, even though `package.json` exports point to `src/index.ts` for bundlers.

**How to apply:** Any time you change types in api-client-react source (e.g. adding/removing fields from VendorUpdate, AuditLogEntry, etc.), run the rebuild before verifying invoice-capture compiles.
