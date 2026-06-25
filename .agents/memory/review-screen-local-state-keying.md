---
name: Review-screen local state keying
description: How to seed/reset local form + per-invoice derived state on review screens so navigation re-seeds but polling/save does not clobber edits.
---

On screens that load one record at a time and let the user navigate between
sibling records (e.g. `extraction-review.tsx` Prev/Next across invoices from the
same source document), do NOT seed local form state with a one-time boolean
`useRef` flag.

**Rule:** key the "have I seeded this?" ref by the record identity, not a
boolean. Use `useRef<string|null>` holding `${record.id}:${meaningfulPhase}`
(e.g. `extractionStatus`) and re-seed whenever the key changes.

**Why:** a boolean `initialized` flag only fires on first mount. When the route
param / selected id changes the component does NOT unmount (same route pattern),
so refs persist and the form keeps the previous record's values — reviewers can
then edit/approve the wrong data. Keying on `id` fixes navigation; adding the
state phase (`extractionStatus`) also re-seeds when async processing completes
(PROCESSING→COMPLETED) yet preserves in-flight user edits across polling/save
refetches because those keep the same key.

**How to apply:**
- Form seed ref keyed on `id:phase`; reset the ref to `null` after actions that
  should force a re-seed (e.g. re-run extraction).
- Per-record async results (duplicate check, etc.): key a separate ref on `id`,
  clear the prior result on switch, and ignore late responses whose captured id
  no longer matches the current ref (stale-response guard).
- Rely on react-query keys including the current id; without `keepPreviousData`
  the loading guard shows a loader instead of stale fields while a sibling loads.
