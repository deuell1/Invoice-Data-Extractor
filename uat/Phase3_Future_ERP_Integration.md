# Phase 3 — Future ERP Integration (Placeholder)

> **Status: NOT STARTED — placeholder only.**
> Nothing in this document is implemented. Phase 2 deliberately demonstrates the
> full Accounts Payable capture lifecycle using **import/export files only**. No
> live ERP connection exists, and no code in this project performs any live ERP
> action.

## Scope boundary (what Phase 2 does NOT do)

- No real-time posting of invoices to an ERP / accounting system.
- No bi-directional sync of vendors, POs, or GL data with an ERP.
- No ERP credentials, endpoints, or webhooks are configured or called.

The terminology used throughout the product reflects this boundary. Export
readiness is described only as **Export Ready / Exported / Export Failed /
Export Blocked**. The product never claims an invoice was "posted to", "synced
with", or "sent to" an ERP.

## Future scope (Phase 3 candidates)

1. **ERP connector framework** — pluggable adapters for common AP targets
   (e.g. NetSuite, SAP, Oracle, QuickBooks, Microsoft Dynamics).
2. **Outbound posting** — transform an Export Ready invoice into the target
   ERP's voucher/bill payload and post it via the ERP API, capturing the
   returned ERP document id.
3. **Status reconciliation** — poll or receive webhooks to reflect ERP-side
   approval, payment, and void status back into the capture system.
4. **Master-data sync** — replace file-based vendor/PO import with scheduled or
   event-driven sync from the ERP system of record.
5. **Error handling & retries** — formal retry/backoff and a dead-letter queue
   for failed ERP posts, surfaced through the existing exception workflow.
6. **Audit & compliance** — extend the audit trail to record ERP request and
   response payloads for each posting attempt.

## Migration path from Phase 2

The Phase 2 export-readiness engine already computes which invoices are
**Export Ready**. Phase 3 would consume the same readiness signal as its
posting trigger, so no rework of the readiness rules is expected. The file
export remains available as a fallback and for systems without an API.

## Explicit non-goals for Phase 2

- Do **not** mark any invoice as posted to an external system.
- Do **not** call any external ERP endpoint.
- Do **not** present ERP-posted/synced/sent status in the UI.
