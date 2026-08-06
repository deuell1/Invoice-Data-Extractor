/**
 * AP Pipeline Smoke Test
 *
 * Validates the full AP pipeline end-to-end, stage by stage:
 *
 *   Stage 1  Upload source document     → invoice created in PENDING_EXTRACTION
 *   Stage 2  Extraction completes       → invoice moves to PENDING_APPROVAL or EXCEPTION
 *   Stage 3  Approve invoice            → APPROVED
 *   Stage 4  Post invoice (voucher)     → POSTED
 *   Stage 5  Export to CSV              → download contains the invoice
 *
 * Each stage is a hard gate: the test fails if the expected status transition
 * is not reached within the timeout, or if storage/extraction is unavailable.
 *
 * Cleanup: every vendor and invoice created by this run is deleted in a
 * try/finally block so the database does not accumulate test data across runs.
 *
 * Environment:
 *   API_BASE_URL  (default: http://localhost:8080/api)
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.API_BASE_URL ?? "http://localhost:8080/api";

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
    failures.push(message);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
  passed++;
}

function warn(message) {
  console.warn(`  ⚠ ${message}`);
}

// Smoke-test API key — must match SMOKE_TEST_API_KEY on the server
const SMOKE_API_KEY = process.env.SMOKE_TEST_API_KEY ?? "";

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (SMOKE_API_KEY) headers["Authorization"] = `Bearer ${SMOKE_API_KEY}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

/**
 * Same as `api` but sends X-Smoke-Role: AP_CLERK so the server treats this
 * request as coming from an AP_CLERK — used solely by the role-guard suite.
 */
async function apiAsClerk(method, path, body) {
  const headers = { "Content-Type": "application/json", "X-Smoke-Role": "AP_CLERK" };
  if (SMOKE_API_KEY) headers["Authorization"] = `Bearer ${SMOKE_API_KEY}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

/**
 * Poll `fn` until it returns a truthy value. Hard-fails the test if the
 * timeout is exceeded — there is no silent pass-on-timeout.
 */
async function poll(fn, { timeoutMs = 90_000, intervalMs = 2_500, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;
  while (Date.now() < deadline) {
    lastResult = await fn();
    if (lastResult !== null && lastResult !== undefined && lastResult !== false) return lastResult;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out (${timeoutMs}ms) waiting for: ${label}`);
}

/**
 * Poll an invoice until extractionStatus is terminal (COMPLETED or FAILED)
 * and status has left PENDING_EXTRACTION.
 * Returns the final invoice JSON.
 */
async function waitForExtraction(invoiceId, timeoutMs = 90_000) {
  return poll(
    async () => {
      const { json } = await api("GET", `/invoices/${invoiceId}`);
      const { status, extractionStatus } = json;
      console.log(`  … invoice ${invoiceId}: status=${status} extractionStatus=${extractionStatus}`);
      const extractionDone = extractionStatus === "COMPLETED" || extractionStatus === "FAILED";
      const leftPending = status !== "PENDING_EXTRACTION";
      if (extractionDone && leftPending) return json;
      return false;
    },
    { timeoutMs, label: `invoice ${invoiceId} extraction to complete` },
  );
}

const RUN_ID = `smoke-${Date.now()}`;

// ─── Cleanup tracking ─────────────────────────────────────────────────────────
// All vendor and invoice IDs created during this run are accumulated here so
// the finally block can remove them regardless of test outcome.

const createdVendorIds = [];
const createdInvoiceIds = [];
const createdSourceDocIds = [];
const createdExportBatchIds = [];
// Object paths uploaded via presigned PUT but not yet linked to a tracked source
// document — must be cleaned up directly when source-doc creation fails.
const orphanedObjectPaths = [];

/**
 * Best-effort cleanup: void then delete every invoice created this run,
 * then delete every vendor. Errors are logged but never rethrown so they
 * cannot mask an assertion failure.
 */
async function cleanup() {
  console.log("\n── Cleanup: removing smoke-test data ──────────────────────");
  if (
    createdInvoiceIds.length === 0 &&
    createdVendorIds.length === 0 &&
    createdSourceDocIds.length === 0 &&
    createdExportBatchIds.length === 0 &&
    orphanedObjectPaths.length === 0
  ) {
    console.log("  (nothing to clean up)");
    return;
  }

  // Step 1: void all invoices first (handles POSTED/APPROVED that cannot be
  // hard-deleted directly).
  for (const id of createdInvoiceIds) {
    try {
      const { status } = await api("POST", `/invoices/${id}/void`, {
        reason: "Smoke-test cleanup — automated removal after run",
      });
      if (status === 200 || status === 404) {
        // 200 = voided, 404 = already gone — both are fine
      } else {
        warn(`void invoice ${id} returned ${status}`);
      }
    } catch (err) {
      warn(`void invoice ${id} failed: ${err.message}`);
    }
  }

  // Step 2: hard-delete all invoices (now that they're VOIDED or never POSTED).
  for (const id of createdInvoiceIds) {
    try {
      const { status } = await api("DELETE", `/invoices/${id}`, {
        confirm: true,
      });
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted invoice ${id}`);
      } else {
        warn(`delete invoice ${id} returned ${status}`);
      }
    } catch (err) {
      warn(`delete invoice ${id} failed: ${err.message}`);
    }
  }

  // Step 3: hard-delete source documents (invoices are gone so the cascade is safe).
  for (const id of createdSourceDocIds) {
    try {
      const { status } = await api("DELETE", `/source-documents/${id}`, { confirm: true });
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted source document ${id}`);
      } else {
        warn(`delete source document ${id} returned ${status}`);
      }
    } catch (err) {
      warn(`delete source document ${id} failed: ${err.message}`);
    }
  }

  // Step 4: delete any object paths that were uploaded but never linked to a
  // source document (orphan uploads from runs that failed mid-way through
  // Stage 1c of Suite 4).  Source-doc-linked blobs are already cleaned up by
  // Step 3, so this only fires when that step was skipped.
  for (const objPath of orphanedObjectPaths) {
    try {
      // objPath is already the /objects/... form; strip the leading /objects/
      // to match the wildcard route DELETE /storage/objects/*path.
      const routePath = objPath.replace(/^\/objects\//, "");
      const { status } = await api("DELETE", `/storage/objects/${routePath}`, undefined);
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted orphaned object ${objPath}`);
      } else {
        warn(`delete orphaned object ${objPath} returned ${status}`);
      }
    } catch (err) {
      warn(`delete orphaned object ${objPath} failed: ${err.message}`);
    }
  }

  // Step 5: delete export batches created during this run.
  for (const id of createdExportBatchIds) {
    try {
      const { status } = await api("DELETE", `/exports/${id}`, undefined);
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted export batch ${id}`);
      } else {
        warn(`delete export batch ${id} returned ${status}`);
      }
    } catch (err) {
      warn(`delete export batch ${id} failed: ${err.message}`);
    }
  }

  // Step 6: delete all vendors (invoices are gone so the FK check passes).
  for (const id of createdVendorIds) {
    try {
      const { status } = await api("DELETE", `/vendors/${id}`, { confirm: true });
      if (status === 200 || status === 404) {
        console.log(`  ✓ deleted vendor ${id}`);
      } else {
        warn(`delete vendor ${id} returned ${status}`);
      }
    } catch (err) {
      warn(`delete vendor ${id} failed: ${err.message}`);
    }
  }

  console.log("── Cleanup complete ────────────────────────────────────────");
}

// ─── Suites (wrapped in try/finally so cleanup always runs) ──────────────────

try {

// ─── Suite 1: Health check ────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("SUITE 1: API health check");
console.log("══════════════════════════════════════════");

{
  const { status, json } = await api("GET", "/healthz");
  assert(status === 200, `GET /healthz returns 200 (got ${status})`);
  assert(json.status === "ok", `health.status is "ok" (got "${json.status}")`);
}

// ─── Suite 2: Full pipeline – extraction is the gate before approval ──────────
//
// Stage 1  Create vendor + invoice → PENDING_EXTRACTION
// Stage 2  Trigger extraction      → wait for PENDING_APPROVAL or EXCEPTION
// Stage 3  Approve                 → APPROVED
// Stage 4  Post (voucher)          → POSTED
// Stage 5  Export + download CSV   → CSV contains the invoice

console.log("\n══════════════════════════════════════════");
console.log("SUITE 2: Full AP pipeline (staged)");
console.log("  Stage 1: Upload   → PENDING_EXTRACTION");
console.log("  Stage 2: Extract  → PENDING_APPROVAL or EXCEPTION");
console.log("  Stage 3: Approve  → APPROVED");
console.log("  Stage 4: Post     → POSTED");
console.log("  Stage 5: Export   → CSV verified");
console.log("══════════════════════════════════════════");

let pipelineInvoiceId;
let pipelineInvoiceNumber;
let pipelineVoucherId;

// ── Stage 1: Create vendor + invoice → PENDING_EXTRACTION ─────────────────────
{
  console.log("\n  [Stage 1] Create vendor + invoice → PENDING_EXTRACTION");

  const vendorCode = `TEST-${RUN_ID}`;
  const vendorName = `Smoke Test Supplier ${RUN_ID}`;

  const { status: vs, json: vj } = await api("POST", "/vendors", {
    vendorCode,
    vendorName,
    paymentTerms: "Net 30",
    isActive: true,
  });
  assert(vs === 201, `POST /vendors returns 201 (got ${vs}: ${JSON.stringify(vj).slice(0, 200)})`);
  assert(vj.isActive === true, "vendor is active");
  createdVendorIds.push(vj.id);

  // Create invoice with vendorRawName so vendor is matched synchronously at
  // creation time (score=1.0).  Extraction is NOT triggered yet; the invoice
  // sits at PENDING_EXTRACTION / extractionStatus=COMPLETED until we explicitly
  // re-trigger extraction in Stage 2.
  pipelineInvoiceNumber = `INV-${RUN_ID}`;
  const { status: is, json: ij } = await api("POST", "/invoices", {
    vendorRawName: vendorName,
    invoiceNumber: pipelineInvoiceNumber,
    invoiceDate: "2026-06-01",
    dueDate: "2026-07-01",
    totalAmount: 550,
    subtotal: 500,
    taxAmount: 50,
    currency: "USD",
    originalFileName: `${pipelineInvoiceNumber}.pdf`,
    // Fake object path — extraction will fail → EXCEPTION (correct transition to test)
    fileObjectPath: `/objects/test/${RUN_ID}/invoice.pdf`,
  });
  assert(is === 201, `POST /invoices returns 201 (got ${is}: ${JSON.stringify(ij).slice(0, 300)})`);
  assert(ij.status === "PENDING_EXTRACTION", `invoice starts as PENDING_EXTRACTION (got "${ij.status}")`);
  assert(ij.vendorId != null, `vendor matched at creation (vendorId=${ij.vendorId})`);
  assert(Number(ij.vendorMatchScore) >= 0.85, `vendorMatchScore >= 0.85 (got ${ij.vendorMatchScore})`);
  pipelineInvoiceId = ij.id;
  createdInvoiceIds.push(pipelineInvoiceId);
  console.log(`  → invoice id=${pipelineInvoiceId}, vendorMatchScore=${ij.vendorMatchScore}`);
}

// ── Stage 2: Trigger extraction → wait for PENDING_APPROVAL or EXCEPTION ──────
{
  console.log("\n  [Stage 2] Trigger extraction → wait for PENDING_APPROVAL or EXCEPTION");

  const { status: es, json: ej } = await api("POST", `/invoices/${pipelineInvoiceId}/extract`, {});
  assert(
    es === 200,
    `POST /invoices/:id/extract returns 200 (got ${es}: ${JSON.stringify(ej).slice(0, 200)})`,
  );

  // Poll until extraction leaves PENDING_EXTRACTION.
  const extracted = await waitForExtraction(pipelineInvoiceId);

  const validPostExtractionStatuses = ["PENDING_APPROVAL", "EXCEPTION"];
  assert(
    validPostExtractionStatuses.includes(extracted.status),
    `invoice moved to PENDING_APPROVAL or EXCEPTION after extraction (got "${extracted.status}")`,
  );
  console.log(`  → extraction settled: status=${extracted.status} extractionStatus=${extracted.extractionStatus}`);
}

// ── Stage 3: Approve → APPROVED ───────────────────────────────────────────────
{
  console.log("\n  [Stage 3] Approve invoice → APPROVED");

  // Re-fetch to get current status so we know whether a reason is needed.
  const { json: current } = await api("GET", `/invoices/${pipelineInvoiceId}`);

  let approveBody = {};
  if (current.status === "EXCEPTION") {
    // Exception invoices require a documented override reason.
    approveBody = { reason: "Smoke-test exception override — extraction used fake file path" };
    console.log("  → invoice is EXCEPTION; approving with override reason");
  }

  const { status: as, json: aj } = await api(
    "POST",
    `/invoices/${pipelineInvoiceId}/approve`,
    approveBody,
  );
  assert(as === 200, `POST /invoices/:id/approve returns 200 (got ${as}: ${JSON.stringify(aj).slice(0, 300)})`);
  assert(aj.status === "APPROVED", `invoice status=APPROVED after approval (got "${aj.status}")`);

  // Verify audit log: APPROVED row has actorClerkId === "smoke-test" and correct role
  const { status: apAlS, json: apAlJ } = await api("GET", `/invoices/${pipelineInvoiceId}/audit`);
  assert(apAlS === 200, `GET audit-log returns 200 after approve (got ${apAlS})`);
  const approvedRow = apAlJ.find((r) => r.action === "APPROVED");
  assert(approvedRow, `APPROVED audit row exists in log`);
  assert(
    approvedRow.actorClerkId === "smoke-test",
    `APPROVED audit row has actorClerkId="smoke-test" (got "${approvedRow.actorClerkId}")`,
  );
  assert(
    ["AP_MANAGER", "AP_APPROVER"].includes(approvedRow.editorRole),
    `APPROVED audit row has valid manager role (got "${approvedRow.editorRole}")`,
  );
  console.log(`  → approve audit verified: actorClerkId=${approvedRow.actorClerkId}, role=${approvedRow.editorRole}`);
}

// ── Stage 4: Post (voucher) → POSTED ─────────────────────────────────────────
{
  console.log("\n  [Stage 4] Assign voucher → POSTED");

  pipelineVoucherId = `VCH-${RUN_ID}`;
  const { status: ps, json: pj } = await api(
    "PATCH",
    `/invoices/${pipelineInvoiceId}/voucher`,
    { voucherId: pipelineVoucherId },
  );
  assert(ps === 200, `PATCH /invoices/:id/voucher returns 200 (got ${ps}: ${JSON.stringify(pj).slice(0, 300)})`);
  assert(pj.status === "POSTED", `invoice status=POSTED (got "${pj.status}")`);
  assert(pj.voucherId === pipelineVoucherId, `voucherId stored (${pj.voucherId})`);
}

// ── Stage 5: Export → CSV verified ────────────────────────────────────────────
{
  console.log("\n  [Stage 5] Export batch → download CSV");

  // Create a persistent export batch for POSTED invoices.
  const { status: xbS, json: xbJ } = await api("POST", "/exports", {
    exportType: "POSTED",
    format: "CSV",
    exportedBy: "smoke-test",
  });
  assert(xbS === 201, `POST /exports returns 201 (got ${xbS}: ${JSON.stringify(xbJ).slice(0, 300)})`);
  assert(xbJ.status === "SUCCESS", `export batch status=SUCCESS (got "${xbJ.status}")`);
  assert(typeof xbJ.recordCount === "number", `recordCount is a number (${xbJ.recordCount})`);
  assert(xbJ.recordCount >= 1, `export contains at least one record (got ${xbJ.recordCount})`);
  createdExportBatchIds.push(xbJ.id);

  // Download and verify CSV content.
  const smokeHeaders = SMOKE_API_KEY ? { Authorization: `Bearer ${SMOKE_API_KEY}` } : {};
  const dlRes = await fetch(`${BASE}/exports/${xbJ.id}/download`, { headers: smokeHeaders });
  assert(dlRes.status === 200, `GET /exports/:id/download returns 200 (got ${dlRes.status})`);
  const contentType = dlRes.headers.get("content-type") ?? "";
  assert(contentType.includes("csv"), `Content-Type is CSV (got "${contentType}")`);
  const csv = await dlRes.text();
  assert(csv.includes(pipelineInvoiceNumber), `CSV contains the invoice number (${pipelineInvoiceNumber})`);
  assert(csv.includes(pipelineVoucherId), `CSV contains the voucher ID (${pipelineVoucherId})`);
  console.log(`  → CSV length=${csv.length} bytes, recordCount=${xbJ.recordCount}`);

  // Also verify the quick inline export endpoint.
  const inlineRes = await fetch(`${BASE}/invoices/export?status=POSTED`, { headers: smokeHeaders });
  assert(inlineRes.status === 200, `GET /invoices/export?status=POSTED returns 200`);
  const inlineCsv = await inlineRes.text();
  assert(inlineCsv.includes(pipelineInvoiceNumber), `Inline CSV export contains the invoice number`);
}

// ─── Suite 3: Dashboard stats ─────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("SUITE 3: Dashboard stats reflect completed pipeline");
console.log("══════════════════════════════════════════");

{
  const { status, json } = await api("GET", "/invoices/stats");
  assert(status === 200, `GET /invoices/stats returns 200 (got ${status})`);
  assert(typeof json.total === "number", `stats.total is a number (${json.total})`);
  assert(json.posted >= 1, `stats.posted >= 1 (got ${json.posted}) — includes pipeline invoice`);
}

// ─── Suite 4: Source document upload pipeline (non-optional) ─────────────────
//
// This suite is REQUIRED. If object storage is unavailable, the test FAILS.
// The suite waits for extraction to reach a terminal status before asserting.

console.log("\n══════════════════════════════════════════");
console.log("SUITE 4: Source document upload pipeline (required)");
console.log("  Stage 1: Upload PDF        → source doc created");
console.log("  Stage 2: Detection         → invoices in PENDING_EXTRACTION");
console.log("  Stage 3: Extraction done   → PENDING_APPROVAL or EXCEPTION");
console.log("══════════════════════════════════════════");

{
  // Create vendors whose names exactly match those embedded in the test PDF so
  // that vendor matching succeeds after real OpenAI extraction.  We use a
  // run-specific vendorCode suffix to avoid duplicate-key conflicts across runs
  // while keeping the vendorName stable for fuzzy matching.
  const PDF_VENDORS = [
    { vendorCode: `PDF-ACME-${RUN_ID}`,    vendorName: "Acme Office Supplies Inc." },
    { vendorCode: `PDF-FAST-${RUN_ID}`,    vendorName: "FastFreight Logistics" },
    { vendorCode: `PDF-TECH-${RUN_ID}`,    vendorName: "TechParts Global Ltd." },
  ];
  for (const pv of PDF_VENDORS) {
    const { status: pvS, json: pvJ } = await api("POST", "/vendors", {
      vendorCode: pv.vendorCode,
      vendorName: pv.vendorName,
      paymentTerms: "Net 30",
      isActive: true,
    });
    assert(pvS === 201, `Suite 4 vendor created: ${pv.vendorName} (got ${pvS}: ${JSON.stringify(pvJ).slice(0, 120)})`);
    createdVendorIds.push(pvJ.id);
    console.log(`  → ensured vendor "${pv.vendorName}" (${pvJ.id})`);
  }

  // Generate the multi-invoice test PDF.
  const genScript = path.resolve(__dirname, "gen_pdf.mjs");
  const genResult = spawnSync("node", [genScript], { env: { ...process.env, SMOKE_RUN_ID: RUN_ID }, stdio: "pipe" });
  if (genResult.status !== 0) {
    const err = genResult.stderr?.toString() || "unknown error";
    assert(false, `gen_pdf.mjs failed (exit ${genResult.status}): ${err}`);
  }
  assert(existsSync("/tmp/multi_invoice.pdf"), "gen_pdf.mjs created /tmp/multi_invoice.pdf");

  // Read the PDF bytes and request a presigned upload URL.
  // Use dynamic import so the error is surfaced as a test failure, not an
  // uncaught exception that bypasses the harness.
  const { readFileSync } = await import("node:fs");
  const pdf = readFileSync("/tmp/multi_invoice.pdf");
  const meta = JSON.parse(readFileSync("/tmp/multi_invoice_meta.json", "utf8"));
  const expectedInvoiceCount = meta.expectedInvoiceCount;
  console.log(`  → expecting exactly ${expectedInvoiceCount} invoice(s) from gen_pdf.mjs`);

  // Stage 1a: Request presigned upload URL.
  const urlRes = await api("POST", "/storage/uploads/request-url", {
    name: "smoke_test_suite4.pdf",
    size: pdf.length,
    contentType: "application/pdf",
  });
  assert(
    urlRes.ok,
    `Storage presigned URL returned (status=${urlRes.status} — is object storage running?): ${JSON.stringify(urlRes.json).slice(0, 200)}`,
  );
  const { uploadURL, objectPath } = urlRes.json;
  assert(typeof uploadURL === "string", `uploadURL is a string (${uploadURL?.slice(0, 60)}…)`);
  assert(typeof objectPath === "string", `objectPath is a string (${objectPath})`);

  // Stage 1b: Upload PDF to presigned URL.
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: pdf,
    headers: { "Content-Type": "application/pdf" },
  });
  assert(putRes.ok, `PDF uploaded via PUT to presigned URL (status=${putRes.status})`);
  // Track the objectPath immediately after a successful PUT. If source-document
  // creation below fails, cleanup() will delete this orphaned file directly.
  orphanedObjectPaths.push(objectPath);

  // Stage 1c: Create source document.
  const { status: csS, json: csJ } = await api("POST", "/source-documents", {
    fileObjectPath: objectPath,
    originalFileName: "smoke_test_suite4.pdf",
    contentType: "application/pdf",
  });
  assert(
    csS === 200 || csS === 201,
    `POST /source-documents returns 2xx (got ${csS}: ${JSON.stringify(csJ).slice(0, 200)})`,
  );
  const sourceId = csJ.source?.id;
  assert(typeof sourceId === "number", `source document id returned (id=${sourceId})`);
  createdSourceDocIds.push(sourceId);
  // Source document now owns the blob — remove from orphan list to avoid
  // double deletion (deleteSourceDocument handles file removal).
  orphanedObjectPaths.splice(orphanedObjectPaths.indexOf(objectPath), 1);
  console.log(`  → source document id=${sourceId}`);

  // Stage 2: Poll until at least 1 invoice is detected (PENDING_EXTRACTION).
  const afterDetection = await poll(
    async () => {
      const { json: d } = await api("GET", `/source-documents/${sourceId}`);
      const s = d.source;
      console.log(`  … detect poll: proc=${s?.processingStatus} detected=${s?.detectedInvoiceCount} invoices=${d?.invoiceCount}`);
      const done =
        (s.processingStatus === "COMPLETED" || s.processingStatus === "EXCEPTION") &&
        d.invoiceCount > 0;
      if (done) return d;
      // Fail if processing finished but found nothing (e.g. detection itself failed).
      const finishedEmpty =
        (s.processingStatus === "COMPLETED" || s.processingStatus === "EXCEPTION") &&
        (s.detectedInvoiceCount === 0);
      if (finishedEmpty) return { _detectionEmpty: true, source: s };
      return false;
    },
    { timeoutMs: 60_000, label: "source document detection" },
  );

  if (afterDetection._detectionEmpty) {
    assert(false, `Source document detection finished but found 0 invoices (processingStatus=${afterDetection.source.processingStatus}). Check vendor data or file content.`);
  }

  const detectedInvoices = afterDetection.invoices ?? [];
  assert(
    detectedInvoices.length === expectedInvoiceCount,
    `Detected invoice count matches PDF page count: expected ${expectedInvoiceCount}, got ${detectedInvoices.length} (pages may have been silently dropped)`,
  );
  console.log(`  → detected ${detectedInvoices.length} invoice(s) (expected ${expectedInvoiceCount})`);

  // Track all detected invoices for cleanup.
  for (const inv of detectedInvoices) {
    createdInvoiceIds.push(inv.id);
  }

  // Verify each detected invoice started at PENDING_EXTRACTION.
  for (const inv of detectedInvoices) {
    assert(
      inv.status === "PENDING_EXTRACTION",
      `detected invoice ${inv.id} starts as PENDING_EXTRACTION (got "${inv.status}")`,
    );
  }

  // Stage 3: Wait for extraction to complete on all invoices.
  // Each invoice will reach PENDING_APPROVAL or EXCEPTION; never stays PENDING_EXTRACTION.
  console.log("  → waiting for all invoices to finish extraction …");

  // Known-good exceptionReasons produced by the validation/extraction pipeline.
  // Anything that looks like a raw stack trace or uncaught server error is a bug.
  const UNHANDLED_ERROR_PATTERNS = [/TypeError/i, /ReferenceError/i, /SyntaxError/i, /\bat\s+\w/];

  const suite4Finals = [];
  for (const inv of detectedInvoices) {
    const finalInv = await waitForExtraction(inv.id, 120_000);
    const validStatuses = ["PENDING_APPROVAL", "EXCEPTION"];
    assert(
      validStatuses.includes(finalInv.status),
      `invoice ${inv.id} reached PENDING_APPROVAL or EXCEPTION (got "${finalInv.status}")`,
    );
    console.log(`  → invoice ${inv.id}: final status=${finalInv.status} exceptionReason=${finalInv.exceptionReason ?? "none"}`);

    if (finalInv.status === "EXCEPTION") {
      const reason = finalInv.exceptionReason ?? "";
      const looksLikeUnhandledError = UNHANDLED_ERROR_PATTERNS.some((p) => p.test(reason));
      assert(
        !looksLikeUnhandledError,
        `invoice ${finalInv.id} EXCEPTION reason is a business-logic message, not a crash (got: "${reason.slice(0, 120)}")`,
      );
    }

    suite4Finals.push(finalInv);
  }

  // Stage 4: Approve + post at least one invoice that reached PENDING_APPROVAL.
  // This confirms the full extraction → approval → posting path works end-to-end
  // with real OpenAI output (not just that the invoice left PENDING_EXTRACTION).
  console.log("\n  [Stage 4] Approve + post a PENDING_APPROVAL invoice from suite 4 source doc");

  const suite4Approvable = suite4Finals.filter((inv) => inv.status === "PENDING_APPROVAL");
  assert(
    suite4Approvable.length >= 1,
    `At least 1 source-doc invoice reached PENDING_APPROVAL (got ${suite4Approvable.length}/${suite4Finals.length}). ` +
    `Check that PDF vendor names match seeded vendors — extraction status: ${suite4Finals.map((i) => `${i.id}:${i.status}`).join(", ")}`,
  );

  const toApprove = suite4Approvable[0];
  const { status: s4aS, json: s4aJ } = await api("POST", `/invoices/${toApprove.id}/approve`, {});
  assert(
    s4aS === 200,
    `POST /invoices/${toApprove.id}/approve returns 200 (got ${s4aS}: ${JSON.stringify(s4aJ).slice(0, 300)})`,
  );
  assert(s4aJ.status === "APPROVED", `source-doc invoice ${toApprove.id} status=APPROVED (got "${s4aJ.status}")`);
  console.log(`  → invoice ${toApprove.id} approved`);

  // Stage 5: Post (voucher) the approved source-doc invoice.
  console.log("\n  [Stage 5] Post (voucher) the approved source-doc invoice");
  const s4VoucherId = `VCH-S4-${RUN_ID}`;
  const { status: s4pS, json: s4pJ } = await api(
    "PATCH",
    `/invoices/${toApprove.id}/voucher`,
    { voucherId: s4VoucherId },
  );
  assert(
    s4pS === 200,
    `PATCH /invoices/${toApprove.id}/voucher returns 200 (got ${s4pS}: ${JSON.stringify(s4pJ).slice(0, 300)})`,
  );
  assert(s4pJ.status === "POSTED", `source-doc invoice ${toApprove.id} status=POSTED (got "${s4pJ.status}")`);
  assert(s4pJ.voucherId === s4VoucherId, `voucherId stored (${s4pJ.voucherId})`);
  console.log(`  → invoice ${toApprove.id} posted with voucherId=${s4VoucherId}`);
}

// ─── Suite 5: True exception override approval ────────────────────────────────
//
// Forces an invoice into EXCEPTION via the status endpoint, then verifies:
//   (a) approving without a reason is rejected (422)
//   (b) approving with a reason succeeds and reaches APPROVED

console.log("\n══════════════════════════════════════════");
console.log("SUITE 5: Exception override approval (required reason)");
console.log("══════════════════════════════════════════");

{
  // Create a vendor and a fully-valid invoice.
  const excVendorName = `Smoke Exception Vendor ${RUN_ID}`;
  const { json: excV } = await api("POST", "/vendors", {
    vendorCode: `EXC-${RUN_ID}`,
    vendorName: excVendorName,
    paymentTerms: "Net 30",
    isActive: true,
  });
  createdVendorIds.push(excV.id);

  const excInvNum = `EXCTEST-${RUN_ID}`;
  const { status: excIS, json: excI } = await api("POST", "/invoices", {
    vendorRawName: excVendorName,
    invoiceNumber: excInvNum,
    invoiceDate: "2026-06-15",
    dueDate: "2026-07-15",
    totalAmount: 999,
    subtotal: 999,
    currency: "USD",
    originalFileName: `${excInvNum}.pdf`,
    fileObjectPath: `/objects/test/${RUN_ID}/exc.pdf`,
  });
  assert(excIS === 201, `Exception test invoice created (got ${excIS})`);
  const excId = excI.id;
  createdInvoiceIds.push(excId);
  assert(excI.vendorId != null, `Vendor matched for exception test invoice (vendorId=${excI.vendorId})`);

  // ── Reject test + audit assertion ────────────────────────────────────────────
  // Force to PENDING_APPROVAL so reject endpoint is valid, then reject and verify audit.
  {
    const { status: toPAS } = await api("PATCH", `/invoices/${excId}/status`, { status: "PENDING_APPROVAL" });
    assert(toPAS === 200, `Force excId to PENDING_APPROVAL for reject test (got ${toPAS})`);
    const { status: rejS, json: rejJ } = await api("POST", `/invoices/${excId}/reject`, {
      reason: "Smoke test reject for audit coverage",
    });
    assert(rejS === 200, `POST /invoices/:id/reject returns 200 (got ${rejS})`);
    assert(rejJ.status === "EXCEPTION", `invoice status=EXCEPTION after reject (got "${rejJ.status}")`);
    const { status: rAlS, json: rAlJ } = await api("GET", `/invoices/${excId}/audit`);
    assert(rAlS === 200, `GET audit-log returns 200 after reject (got ${rAlS})`);
    const rejectedRow = rAlJ.find((r) => r.action === "REJECTED");
    assert(rejectedRow, `REJECTED audit row exists in log`);
    assert(
      rejectedRow.actorClerkId === "smoke-test",
      `REJECTED audit row has actorClerkId="smoke-test" (got "${rejectedRow.actorClerkId}")`,
    );
    console.log(`  → reject audit verified: actorClerkId=${rejectedRow.actorClerkId}`);
  }

  // ── Exception assign test + audit assertion ────────────────────────────────
  // excId is already EXCEPTION after the reject above.
  {
    const { status: eaS } = await api("POST", `/invoices/${excId}/exception/assign`, {
      owner: "smoke-tester",
      ownerClerkId: "smoke-test",
    });
    assert(eaS === 200, `POST /invoices/:id/exception/assign returns 200 (got ${eaS})`);
    const { status: eaAlS, json: eaAlJ } = await api("GET", `/invoices/${excId}/audit`);
    assert(eaAlS === 200, `GET audit-log returns 200 after assign (got ${eaAlS})`);
    const assignedRow = eaAlJ.find((r) => r.action === "EXCEPTION_ASSIGNED");
    assert(assignedRow, `EXCEPTION_ASSIGNED audit row exists in log`);
    assert(
      assignedRow.actorClerkId === "smoke-test",
      `EXCEPTION_ASSIGNED audit row has actorClerkId="smoke-test" (got "${assignedRow.actorClerkId}")`,
    );
    console.log(`  → exception assign audit verified: actorClerkId=${assignedRow.actorClerkId}`);
  }

  // Force to EXCEPTION status using the status endpoint.
  const { status: forceS, json: forceJ } = await api(
    "PATCH",
    `/invoices/${excId}/status`,
    { status: "EXCEPTION", reason: "Forced to EXCEPTION by smoke test" },
  );
  assert(forceS === 200, `PATCH /invoices/:id/status → EXCEPTION returns 200 (got ${forceS}: ${JSON.stringify(forceJ).slice(0, 200)})`);
  assert(forceJ.status === "EXCEPTION", `Invoice is now EXCEPTION (got "${forceJ.status}")`);
  console.log(`  → invoice ${excId} forced to EXCEPTION`);

  // (a) Approve WITHOUT a reason → must be rejected 422.
  const { status: noReasonS, json: noReasonJ } = await api(
    "POST",
    `/invoices/${excId}/approve`,
    {},
  );
  assert(
    noReasonS === 422,
    `Approving EXCEPTION without reason returns 422 (got ${noReasonS}: ${JSON.stringify(noReasonJ).slice(0, 200)})`,
  );
  console.log(`  → correctly rejected approval without reason (422)`);

  // (b) Approve WITH a documented reason → must succeed.
  const overrideReason = "Exception override: smoke test forced status for coverage";
  const { status: withReasonS, json: withReasonJ } = await api(
    "POST",
    `/invoices/${excId}/approve`,
    { reason: overrideReason },
  );
  assert(
    withReasonS === 200,
    `Approving EXCEPTION with reason returns 200 (got ${withReasonS}: ${JSON.stringify(withReasonJ).slice(0, 200)})`,
  );
  assert(withReasonJ.status === "APPROVED", `Invoice reached APPROVED (got "${withReasonJ.status}")`);
  console.log(`  → EXCEPTION invoice approved with override reason → APPROVED`);

  // (c) Verify idempotency guard: re-approving returns 409.
  const { status: dupS } = await api("POST", `/invoices/${excId}/approve`, {});
  assert(dupS === 409, `Re-approving APPROVED invoice returns 409 (got ${dupS})`);
}

// ─── Suite 6: Bulk approve ────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("SUITE 6: Bulk approve endpoint");
console.log("══════════════════════════════════════════");

{
  const bulkVendorName = `Bulk Test Supplier ${RUN_ID}`;
  const { json: bulkV } = await api("POST", "/vendors", {
    vendorCode: `BULK-${RUN_ID}`,
    vendorName: bulkVendorName,
    paymentTerms: "Net 30",
    isActive: true,
  });
  createdVendorIds.push(bulkV.id);

  const bulkIds = [];
  for (let i = 1; i <= 2; i++) {
    const { json: bInv } = await api("POST", "/invoices", {
      vendorRawName: bulkVendorName,
      invoiceNumber: `BULK-${i}-${RUN_ID}`,
      invoiceDate: "2026-06-15",
      dueDate: "2026-07-15",
      totalAmount: 100 * i,
      subtotal: 100 * i,
      currency: "USD",
      originalFileName: `bulk-${i}.pdf`,
      fileObjectPath: `/objects/test/${RUN_ID}/bulk-${i}.pdf`,
    });
    bulkIds.push(bInv.id);
    createdInvoiceIds.push(bInv.id);
  }

  const { status: baS, json: baJ } = await api("POST", "/invoices/bulk-approve", { ids: bulkIds });
  assert(baS === 200, `POST /invoices/bulk-approve returns 200 (got ${baS})`);
  assert(typeof baJ.succeeded === "number", `bulk-approve returns succeeded count (${baJ.succeeded})`);
  assert(
    baJ.succeeded === 2,
    `bulk-approve succeeded for 2 invoices (got ${baJ.succeeded}, errors: ${JSON.stringify(baJ.errors)})`,
  );
}

// ─── Suite 7: Vendors search ──────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("SUITE 7: Vendors list and search");
console.log("══════════════════════════════════════════");

{
  const { status, json } = await api("GET", `/vendors?search=${encodeURIComponent("Smoke Test")}`);
  assert(status === 200, `GET /vendors search returns 200 (${status})`);
  assert(Array.isArray(json.data), "vendors.data is an array");
  assert(json.data.length >= 1, `search found at least 1 smoke-test vendor (${json.data.length})`);
}

// ─── Suite 8: Source documents list ──────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("SUITE 8: Source documents list");
console.log("══════════════════════════════════════════");

{
  const { status, json } = await api("GET", "/source-documents");
  assert(status === 200, `GET /source-documents returns 200 (${status})`);
  assert(typeof json.total === "number", `source-documents.total is a number (${json.total})`);
  assert(json.total >= 1, `At least 1 source document exists (${json.total})`);
}

// ─── Suite 9: Exports list ────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("SUITE 9: Exports list");
console.log("══════════════════════════════════════════");

{
  const { status, json } = await api("GET", "/exports");
  assert(status === 200, `GET /exports returns 200 (${status})`);
  assert(Array.isArray(json.data), "exports.data is an array");
  assert(json.data.length >= 1, `At least 1 export batch exists (${json.data.length})`);
}

// ─── Suite 10: Role-based access control ─────────────────────────────────────
//
// Covers every route guarded by requireRole("AP_MANAGER"):
//   POST   /invoices/:id/approve
//   POST   /invoices/bulk-approve
//   PATCH  /invoices/:id/voucher
//   GET    /invoices/export
//   POST   /exports
//   DELETE /exports/:id
//   DELETE /vendors/:id
//   DELETE /storage/objects/*path
//
// Strategy:
//   • AP_CLERK (via X-Smoke-Role: AP_CLERK header) must get exactly 403 on all.
//   • AP_MANAGER must get the expected business status (404, 200, or 201) — not
//     403, 401, 400, or 5xx — proving the guard lets the request through.
//
// Non-mutating manager checks use a guaranteed-absent numeric ID (999999999) so
// the role guard runs and the handler returns 404 without touching real data.
// POST /exports actually creates a batch (tracked for cleanup).

console.log("\n══════════════════════════════════════════");
console.log("SUITE 10: Role-based access control (AP_CLERK vs AP_MANAGER)");
console.log("  AP_CLERK  → must get 403 on all 8 manager-only routes");
console.log("  AP_MANAGER → must get expected business status (no 403/401/5xx)");
console.log("══════════════════════════════════════════");

{
  const GHOST_ID = 999999999; // Non-existent ID; role guard fires before DB lookup.

  // ── 10a: AP_CLERK must receive exactly 403 on every manager-only route ───────
  console.log("\n  [10a] AP_CLERK blocked (403) on all manager-only routes");

  const clerkBlockedRoutes = [
    ["POST",   `/invoices/${GHOST_ID}/approve`,              {}],
    ["POST",   `/invoices/bulk-approve`,                     { ids: [GHOST_ID] }],
    ["PATCH",  `/invoices/${GHOST_ID}/voucher`,              { voucherId: "VCH-ROLE-TEST" }],
    ["GET",    `/invoices/export`,                           undefined],
    ["POST",   `/exports`,                                   { exportType: "POSTED", format: "CSV", exportedBy: "role-test" }],
    ["DELETE", `/exports/${GHOST_ID}`,                       undefined],
    ["DELETE", `/vendors/${GHOST_ID}`,                       { confirm: true }],
    ["DELETE", `/storage/objects/smoke-role-test/ghost.pdf`, undefined],
  ];

  for (const [method, routePath, body] of clerkBlockedRoutes) {
    const { status: clerkStatus } = await apiAsClerk(method, routePath, body);
    assert(
      clerkStatus === 403,
      `AP_CLERK: ${method} ${routePath} returns 403 (got ${clerkStatus})`,
    );
  }

  // ── 10b: AP_MANAGER gets the expected business status on every guarded route ─
  console.log("\n  [10b] AP_MANAGER reaches handler (no 403/401/5xx) on all guarded routes");

  // Routes where the role guard passes and the handler returns 404 (resource absent).
  const mgrExpect404 = [
    ["POST",   `/invoices/${GHOST_ID}/approve`, {}],
    ["PATCH",  `/invoices/${GHOST_ID}/voucher`, { voucherId: "VCH-ROLE-TEST" }],
    ["DELETE", `/exports/${GHOST_ID}`,          undefined],
    ["DELETE", `/vendors/${GHOST_ID}`,          { confirm: true }],
  ];

  for (const [method, routePath, body] of mgrExpect404) {
    const { status: mgrStatus } = await api(method, routePath, body);
    assert(
      mgrStatus === 404,
      `AP_MANAGER: ${method} ${routePath} returns 404 after passing guard (got ${mgrStatus})`,
    );
  }

  // DELETE /storage/objects is idempotent — returns 200 even for non-existent paths.
  {
    const { status: storageS } = await api("DELETE", "/storage/objects/smoke-role-test/ghost.pdf");
    assert(
      storageS === 200,
      `AP_MANAGER: DELETE /storage/objects/* returns 200 (idempotent) after passing guard (got ${storageS})`,
    );
  }

  // bulk-approve with a non-existent ID → 200 with succeeded=0 (no 403/404).
  {
    const { status: baRoleS, json: baRoleJ } = await api("POST", "/invoices/bulk-approve", { ids: [GHOST_ID] });
    assert(
      baRoleS === 200,
      `AP_MANAGER: POST /invoices/bulk-approve returns 200 after passing guard (got ${baRoleS})`,
    );
  }

  // GET /invoices/export → 200 CSV (no invoice filter needed; returns whatever is posted).
  {
    const { status: exportRoleS } = await api("GET", "/invoices/export");
    assert(
      exportRoleS === 200,
      `AP_MANAGER: GET /invoices/export returns 200 after passing guard (got ${exportRoleS})`,
    );
  }

  // POST /exports → 201 (creates a real export batch; tracked for cleanup).
  {
    const { status: xRoleS, json: xRoleJ } = await api("POST", "/exports", {
      exportType: "POSTED",
      format: "CSV",
      exportedBy: "role-smoke-test",
    });
    assert(
      xRoleS === 201,
      `AP_MANAGER: POST /exports returns 201 after passing guard (got ${xRoleS})`,
    );
    if (xRoleJ?.id) createdExportBatchIds.push(xRoleJ.id);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("Failed assertions:");
  for (const f of failures) console.log(`  • ${f}`);
}
console.log("══════════════════════════════════════════\n");

} finally {
  // Always clean up, regardless of test outcome.
  await cleanup();
}

process.exit(failed > 0 ? 1 : 0);
