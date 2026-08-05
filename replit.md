# Invoice Capture MVP

A single-tenant accounts-payable automation system that processes supplier invoices from scan/upload through AI extraction, vendor matching, validation, exception handling, approval, voucher creation, and CSV export.

## Core Pipeline

Upload → Extract (OpenAI OCR) → Vendor Match (fuzzy) → Validate / Tie-Out → Review / Exception Queue → Approve → Voucher → Post → CSV Export

## Repository Map

```
.
├── artifacts/
│   ├── api-server/          # Express API (TypeScript) — all business logic
│   │   └── src/
│   │       ├── routes/      # Thin HTTP handlers (invoices, vendors, imports, exports, approvals, sources, audit, settings, accuracy)
│   │       └── services/    # Core logic (extractionService, vendorMatchingService, validationService, importService, exportService)
│   └── invoice-capture/     # Vite + React SPA
│       └── src/
│           ├── pages/       # One file per route (invoice-list, exception-queue, approval-queue, vendor-admin, vendor-detail, imports, exports, …)
│           └── components/  # Shared UI (layout, app-router, cleanup-actions, …)
├── lib/
│   ├── db/src/schema/       # Drizzle ORM schema (vendors, invoices, source_documents, audit, import_batch, export_batch, accuracy_run, exception_event, app_settings)
│   ├── api-spec/            # openapi.yaml — single source of truth for the API contract
│   ├── api-zod/             # Generated Zod schemas (run codegen to regenerate; never hand-edit)
│   └── api-client-react/    # Generated React Query hooks (run codegen to regenerate; never hand-edit)
└── pnpm-workspace.yaml
```

## Architecture Decisions

1. **OpenAPI-first codegen**: `lib/api-spec/openapi.yaml` is the single contract. After any spec change, run `pnpm --filter @workspace/api-spec run codegen` to regenerate `lib/api-zod` and `lib/api-client-react`. Never hand-edit generated files.

2. **State machine on the server**: Every invoice status transition is enforced in `artifacts/api-server/src/routes/invoices.ts`. POSTED is terminal; posting requires APPROVED; the client must not assume transitions are free.

3. **Vendor match is the critical gate**: `vendorMatchingService.ts` uses fuzzy matching (85 % threshold) on `vendorRawName`. An invoice with no vendor match sits in EXCEPTION and cannot proceed to APPROVED. Missing-vendor is a non-overridable hard block at approval.

4. **Extraction confidence is 0–1 (overall) / 0–100 (per-field)**: `extractionService.ts` normalises OpenAI output to these scales. Do not conflate the two when reading `confidenceScore` vs `fieldConfidence` values.

## User Preferences

- Deletion-only pass first: remove features before adding new ones
- Keep the AP pipeline clean; no governance extras (notes threading, reviewed flags, etc.)
- Vendor edit UI: operational fields editable inline; secondary details (address, contact, taxId, etc.) in a collapsed read-only accordion
