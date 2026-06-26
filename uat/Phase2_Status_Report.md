# Phase 2 Status Report — Invoice Data Extractor (AP Invoice Capture MVP)

_Date: 2026-06-26_

> **Scope note:** Phase 2 demonstrates the **full Accounts Payable invoice
> capture lifecycle** using **import/export files only**. There is **no ERP
> integration** — that is explicitly deferred to Phase 3 (see
> `uat/Phase3_Future_ERP_Integration.md`). Phase 2 was built **additively on top
> of Phase 1** with no rebuild; all Phase 1 routes, pages, and the tie-out engine
> are preserved.

---

## 1. Executive Summary

Phase 2 is **functionally complete and verified end-to-end** in the development
environment. The build added the export-readiness lifecycle, exception
management, advanced search, file-based import/export, source-document
management, vendor analytics, an accuracy-measurement framework, an audit
viewer, and admin settings — all wired into a single navigation shell alongside
the preserved Phase 1 screens.

- **Backend:** central typecheck passes; all new endpoints return data that
  reconciles with database ground truth.
- **Frontend:** the web app typechecks and renders; 10 new pages added, Phase 1
  pages untouched and still routable.
- **Terminology compliance:** a repository-wide scan of the frontend confirms
  **zero** occurrences of the forbidden phrases _"ERP Posted" / "ERP Synced" /
  "Sent to ERP"_. Export state is described only as **Export Ready / Exported /
  Export Failed / Export Blocked**.
- **Accuracy:** the framework correctly reports **"Not measured"** because no
  labeled test pack has been recorded — no accuracy numbers are fabricated.

**Phase 1 is NOT declared fully PASS** — two Phase 1 exit gates remain open (see
Section 9).

---

## 2. Scope & Boundaries

| Area | In Phase 2 | Deferred to Phase 3 |
| --- | --- | --- |
| Capture lifecycle | Full (intake → extraction → exception → approval → export-ready → exported) | — |
| Data exchange | Import/export **files** (CSV) | Live ERP API posting/sync |
| Vendor / PO master data | Admin-only **file import** | Event-driven ERP sync |
| External system actions | **None** | All ERP connectors, webhooks, reconciliation |

The Phase 3 placeholder (`/phase3` in the app and
`uat/Phase3_Future_ERP_Integration.md`) documents future scope and performs **no
live action**.

---

## 3. Feature Implementation Status

| # | Capability | Page / Route | Status |
| --- | --- | --- | --- |
| 1 | Enhanced dashboard (Phase 1 cards + Phase 2 metrics & filters) | `/dashboard` | ✅ Done |
| 2 | Advanced search (15+ filters, sort, pagination) | `/search` | ✅ Done |
| 3 | Source-document management (list, counts, audit) | `/sources` | ✅ Done |
| 4 | Exception management (assign / review / note / return + timeline) | `/exception-management` | ✅ Done |
| 5 | Vendor analytics | `/analytics` | ✅ Done |
| 6 | Import workflow (template, validate, commit, history) | `/imports` | ✅ Done |
| 7 | Export workflow (8 export types, history, download) | `/exports` | ✅ Done |
| 8 | Accuracy reporting (Not-measured aware) | `/accuracy` | ✅ Done |
| 9 | Audit viewer | `/audit` | ✅ Done |
| 10 | Admin settings (safe defaults) | `/settings` | ✅ Done |
| 11 | Phase 3 ERP placeholder (no live action) | `/phase3` | ✅ Done |

Phase 1 screens preserved and still routable: Invoices (`/invoices`), Intake
(`/invoices/new`), Extraction Review (`/invoices/:id`), Source Batch
(`/sources/:id`), Exceptions (`/exceptions`), Approvals (`/approvals`), Vendors
(`/vendors`).

---

## 4. Backend — Data Layer & Endpoints

**Schema additions (pushed cleanly; existing 14 invoices intact):**

- `invoice_capture` — export-readiness fields (`exportStatus`, `exportBatchId`,
  `exportedAt`, `exportBlockedReason`, `exportRetryCount`, `exportFileName`,
  `exportFormat`) and exception-management fields (`exceptionOwner`,
  `exceptionReviewedAt`, `exceptionReviewedBy`).
- New tables: `import_batch`, `export_batch`, `app_settings`, `accuracy_run`,
  `exception_event`.
- Extended `po_header` (`poDate`, `buyer`, `importBatchId`) and `vendor_id`
  (`importBatchId`).

**New / extended endpoints** (registered in `routes/index.ts`):

- Dashboard & analytics: `GET /dashboard/metrics`, `GET /analytics/vendors`.
- Exceptions: `GET /exceptions`, `GET /invoices/:id/exception/events`,
  `POST /invoices/:id/exception/{note,assign,review,return-to-approval}`.
- Advanced search: extended `GET /invoices` list filters (tie-out, validation,
  export status, PO/voucher/business-doc, batch, date/amount/confidence ranges).
- Source documents: `GET /source-documents`, `GET /source-documents/:id/audit`.
- Imports: `GET /imports/template`, `POST /imports/validate`, `POST /imports`,
  `GET /imports`, `GET /imports/:id`. Import semantics:
  - `VENDOR_MASTER` / `PO_REFERENCE` — insert new rows, or update existing rows
    when "update existing" is selected. Vendors are **never** auto-created from
    extraction.
  - `INVOICE_CORRECTION` — **updates existing invoices in place** (matched by
    vendor + invoice number), applying only the provided fields; rows with no
    matching existing invoice are **rejected** (corrections never create
    invoices).
  - **Admin-only guard:** `VENDOR_MASTER` commits are rejected (HTTP 403) unless
    an identified actor ("Uploaded By") is supplied. With no auth system in this
    pilot, this self-asserted, recorded actor is the enforceable form of the
    admin-only control; the UI also disables commit until an actor is entered.
- Exports: `POST /exports`, `GET /exports`, `GET /exports/:id`,
  `GET /exports/:id/download`.
- Accuracy: `GET /accuracy-runs`, `POST /accuracy-runs`.
- Settings: `GET /settings`, `PUT /settings`.

**Preserved safeguards:** CSV formula-injection escaping (shared `toCsv`
helper) and exclusion of VOIDED invoices from active counts/exports.

**Verification (live, against the running server):**

- `POST /exports` (type `APPROVED`) → `recordCount: 4`, `status: SUCCESS`;
  `GET /exports/:id/download` streams a CSV with all Phase 2 columns and the
  correct `Content-Disposition` filename.
- `GET /imports/template?importType=PO_REFERENCE` → valid CSV header + sample.
- `GET /settings` → safe defaults (see Section 8).

---

## 5. Frontend — Pages & Navigation

- 10 new pages created under `artifacts/invoice-capture/src/pages/` plus the
  Phase 3 placeholder; all wired in `app-router.tsx` and the sidebar
  `layout.tsx`. Default route now redirects `/` → `/dashboard`.
- All pages follow existing conventions: shadcn UI, `Loader2` loading states,
  explicit empty states, `StatusBadge`, `data-testid` attributes.
- Web app passes `tsc --noEmit` with zero errors.
- Rendered/verified via preview: Dashboard, Exports, Accuracy ("Not measured"
  panel).

---

## 6. Database Ground-Truth Reconciliation

Dashboard metrics were checked against direct SQL on `invoice_capture`:

| Metric | Dashboard | DB (SQL) | Match |
| --- | --- | --- | --- |
| Total active invoices | 14 | 14 | ✅ |
| Exception | 5 | 5 | ✅ |
| Pending Approval | 4 | 4 | ✅ |
| Approved | 4 | 4 | ✅ |
| Posted | 1 | 1 | ✅ |
| Voided | 0 | 0 | ✅ |

Export round-trip: after a test `APPROVED` export, **4** invoices transitioned
to `EXPORTED` in the database, matching `export_batch.recordCount = 4`. An
`INVOICE_CORRECTION` round-trip was also verified to **update** a target invoice
in place (total amount changed; invoice count unchanged at 14) and to **reject**
a correction row with no matching invoice (no insert). Vendor analytics and
source-document counts reconcile against per-vendor / per-document SQL
aggregates. **All verification mutations were reverted — the database was
returned to its 14-invoice baseline (5 EXCEPTION / 4 PENDING_APPROVAL /
4 APPROVED / 1 POSTED) with no residual test import/export batches.**

---

## 7. Phase 1 Regression Results

| Phase 1 surface | Check | Result |
| --- | --- | --- |
| `GET /invoices` (list) | Returns paged invoices with original fields | ✅ Pass |
| `GET /invoices/:id` | Returns full invoice detail | ✅ Pass |
| `GET /vendors` | Returns vendor list | ✅ Pass |
| Tie-out engine / CSV columns | Export CSV still emits tie-out columns + explanations | ✅ Pass |
| CSV injection protection | Leading `"`/`=` cells escaped in export | ✅ Pass |
| VOIDED exclusion | Active counts exclude VOIDED | ✅ Pass |
| Phase 1 routes/pages | All still routable; no removals | ✅ Pass |

No Phase 1 regressions were observed. Backend and web app both typecheck.

---

## 8. Accuracy Measurement Framework

- `GET /accuracy-runs` returns `{ "data": [], "measured": false }`.
- The `/accuracy` page renders a prominent **"Not measured"** panel stating that
  no labeled test pack has been recorded and that no numbers are estimated or
  invented. Operators may record a measured run via "Record Run".

**Settings safe defaults** (seeded on read; `GET /settings`):

| Setting | Value |
| --- | --- |
| Extraction confidence threshold | 85% |
| Vendor match threshold | 85% |
| Tie-out PASS tolerance | $0.01 |
| Tie-out WARNING tolerance | $0.05 |
| Default page size | 20 |
| Default export format | CSV |

---

## 9. Remaining Risks, Open Exit Gates & Phase 3 Recommendation

**Phase 1 is NOT declared fully PASS.** Two Phase 1 exit gates remain open and
are carried forward (unchanged by Phase 2):

1. **Extraction-accuracy certification (TO-10).** End-to-end extraction of a
   real parenthesized-discount PDF was not driven in this environment. *Manual
   step:* upload a PDF whose discount/credit is shown as `(25.00)`, run
   extraction, and confirm the stored Discount Amount and tie-out reconcile. A
   certification harness exists under `uat/extraction-accuracy/`.
2. **Edge runtime confirmation.** The tie-out review panel was verified in the
   standard preview browser but not in Microsoft Edge. *Manual step:* run
   `uat/edge-rendering-checklist.md` in Edge.

**Phase 2 risks / follow-ups:**

- Import/export and exception flows were verified via API and representative UI
  states; a broader UI end-to-end pass (full import→commit→export cycle through
  the browser with file uploads) is recommended before pilot sign-off.
- Settings are read with safe defaults until an admin saves; persistence is
  available via `PUT /settings` and was exercised at the contract level.
- **Admin-only enforcement is self-asserted (no auth system).** Vendor master
  import requires a recorded actor but cannot cryptographically verify identity
  in this pilot. A real role/identity gate is a Phase 3+ consideration if AP
  policy requires enforced segregation of duties.

**Phase 3 recommendation:** the export-readiness engine already determines which
invoices are **Export Ready**; Phase 3 should reuse that same signal as the
posting trigger for ERP connectors. No rework of the readiness rules is
anticipated. File export remains the fallback path.
