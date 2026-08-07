---
name: Extraction accuracy harness
description: How to run uat/extraction-accuracy/run-accuracy.mjs against the auth-protected API, and accuracy_run recording semantics.
---

**Rule:** Keep `run-accuracy.mjs` auth-agnostic. It fetches `GET /invoices` with no headers, so run it through a throwaway localhost reverse proxy that injects `Authorization: Bearer $SMOKE_TEST_API_KEY` and set `API_BASE=http://localhost:<proxyPort>/api`. Do not add auth (or any other changes) to the harness — its blocking `validateGroundTruth` and exact ISO currency matching are contractually frozen.

**Why:** The harness predates Clerk auth; EG-1 instructions forbid weakening/modifying it, and a proxy preserves it byte-for-byte while the API stays protected.

**How to apply:** ~12-line `node:http` proxy forwarding to `localhost:8080`; run harness; kill proxy. Re-scoring after a ground-truth CSV fix needs **no re-extraction** — the harness reads already-extracted invoices, so re-runs are cheap.

Other durable facts:
- Harness matches rows by normalized `originalFileName` **and** `invoiceNumber` — leading zeros matter ("215" ≠ "00215"); an unmatched row scores every provided field as missing. Never re-upload the same file name: a second same-name/same-number invoice makes row binding ambiguous.
- Only ever feed `POST /accuracy-runs` real harness output — measured evidence, never fabricated numbers.
- Ground-truth CSV is owner-supplied; label/document mismatches are reported, never edited by the agent.
