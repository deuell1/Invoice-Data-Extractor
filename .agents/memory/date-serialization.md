---
name: Date serialization in Drizzle routes
description: Nullable timestamp columns return Date objects but Zod expects string — must serialize before Zod parse.
---

## Rule
When a Drizzle table column is `timestamp(...).nullable()` (no `.notNull()`), the DB returns `Date | null`.
The generated Zod schemas from Orval use `zod.string().nullable()` for `type: ["string", "null"]` date-time fields, which rejects `Date` objects with "Expected string, received date".

**Why:** Zod v4 strict mode does not coerce Date → string. Orval emits `z.string()` for string-typed date-time OpenAPI fields.

**How to apply:** In every route handler, serialize rows through a helper before passing to Zod parse:
```typescript
function serializeRow(row) {
  return {
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : (row.updatedAt ?? null),
  };
}
```
NOT NULL timestamp columns (always Date, never null) appear to work fine through Zod without this. Only nullable timestamps need explicit serialization.
