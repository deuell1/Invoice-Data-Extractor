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
import { runCleanup } from "./smoke_cleanup.mjs";

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
 *
 * Delegates to runCleanup() from smoke_cleanup.mjs — the same function
 * exercised by smoke_cleanup_exit.test.mjs, so any regression in cleanup
 * logic will break both production runs and the test suite.
 */
async function cleanup() {
  const result = await runCleanup({
    api,
    createdInvoiceIds,
    createdVendorIds,
    createdSourceDocIds,
    createdExportBatchIds,
    orphanedObjectPaths,
  });
  failed   += result.failed;
  failures.push(...result.failures);
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

  // Verify audit log: VOUCHER_SET row carries the actor AND their role.
  const { status: vAlS, json: vAlJ } = await api("GET", `/invoices/${pipelineInvoiceId}/audit`);
  assert(vAlS === 200, `GET audit-log returns 200 after voucher set (got ${vAlS})`);
  const voucherRow = vAlJ.find((r) => r.action === "VOUCHER_SET");
  assert(voucherRow, `VOUCHER_SET audit row exists in log`);
  assert(
    voucherRow.actorClerkId === "smoke-test",
    `VOUCHER_SET audit row has actorClerkId="smoke-test" (got "${voucherRow.actorClerkId}")`,
  );
  assert(
    ["AP_MANAGER", "AP_CLERK"].includes(voucherRow.editorRole),
    `VOUCHER_SET audit row has editorRole populated (got "${voucherRow.editorRole}")`,
  );
  console.log(`  → voucher audit verified: actorClerkId=${voucherRow.actorClerkId}, role=${voucherRow.editorRole}`);
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

// Captured for use in Suite 12 (actor-attribution end-to-end check).
let suite4SourceId;

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
  // Expose to Suite 12 (actor-attribution end-to-end check).
  suite4SourceId = sourceId;
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

  // ── Submit test + audit assertion ───────────────────────────────────────────
  // Submit the invoice through validation and verify the SUBMITTED audit row
  // records both the actor and their role.
  {
    const { status: subS } = await api("POST", `/invoices/${excId}/submit`, {});
    assert(subS === 200, `POST /invoices/:id/submit returns 200 (got ${subS})`);
    const { status: sAlS, json: sAlJ } = await api("GET", `/invoices/${excId}/audit`);
    assert(sAlS === 200, `GET audit-log returns 200 after submit (got ${sAlS})`);
    const submittedRow = sAlJ.find((r) => r.action === "SUBMITTED");
    assert(submittedRow, `SUBMITTED audit row exists in log`);
    assert(
      submittedRow.actorClerkId === "smoke-test",
      `SUBMITTED audit row has actorClerkId="smoke-test" (got "${submittedRow.actorClerkId}")`,
    );
    assert(
      ["AP_MANAGER", "AP_CLERK"].includes(submittedRow.editorRole),
      `SUBMITTED audit row has editorRole populated (got "${submittedRow.editorRole}")`,
    );
    console.log(`  → submit audit verified: actorClerkId=${submittedRow.actorClerkId}, role=${submittedRow.editorRole}`);
  }

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
    assert(
      ["AP_MANAGER", "AP_CLERK"].includes(assignedRow.editorRole),
      `EXCEPTION_ASSIGNED audit row has editorRole populated (got "${assignedRow.editorRole}")`,
    );
    console.log(`  → exception assign audit verified: actorClerkId=${assignedRow.actorClerkId}, role=${assignedRow.editorRole}`);
  }

  // ── Exception review + audit assertion ──────────────────────────────────────
  {
    const { status: erS } = await api("POST", `/invoices/${excId}/exception/review`, {
      note: "Smoke test exception review",
    });
    assert(erS === 200, `POST /invoices/:id/exception/review returns 200 (got ${erS})`);
    const { status: erAlS, json: erAlJ } = await api("GET", `/invoices/${excId}/audit`);
    assert(erAlS === 200, `GET audit-log returns 200 after exception review (got ${erAlS})`);
    const reviewedRow = erAlJ.find((r) => r.action === "EXCEPTION_REVIEWED");
    assert(reviewedRow, `EXCEPTION_REVIEWED audit row exists in log`);
    assert(
      reviewedRow.actorClerkId === "smoke-test",
      `EXCEPTION_REVIEWED audit row has actorClerkId="smoke-test" (got "${reviewedRow.actorClerkId}")`,
    );
    assert(
      ["AP_MANAGER", "AP_CLERK"].includes(reviewedRow.editorRole),
      `EXCEPTION_REVIEWED audit row has editorRole populated (got "${reviewedRow.editorRole}")`,
    );
    console.log(`  → exception review audit verified: actorClerkId=${reviewedRow.actorClerkId}, role=${reviewedRow.editorRole}`);
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

// ─── Suite 11: Extraction accuracy regression guard ───────────────────────────
//
// Uploads the real UAT test PDF (TP-001–TP-005), waits for all 5 invoices to
// extract, then checks every invoice's vendorRawName, invoiceNumber, invoiceDate,
// dueDate, subtotal, totalAmount, and currency against the known-correct snapshot values embedded
// below.  Fails if:
//   • any guarded field is missing or doesn't match the snapshot
//   • overall field accuracy across all 5 REQUIRED_ALWAYS fields drops below 95%
//
// This suite is the automated regression guard described in the accuracy harness
// README: it fires on every smoke-test run so field-level drift is caught before
// it reaches the manual accuracy report.

console.log("\n══════════════════════════════════════════");
console.log("SUITE 11: Extraction accuracy regression guard");
console.log("  Uploads UAT test PDF → waits for 5 extractions");
console.log("  Checks vendorRawName, invoiceNumber, invoiceDate, dueDate, subtotal, taxAmount, totalAmount, currency");
console.log("  against known-correct snapshot for TP-001–TP-005");
console.log("══════════════════════════════════════════");

{
  // ── Build snapshot from ground-truth CSV ─────────────────────────────────────
  // Suite 11 reads uat/extraction-accuracy/ground-truth.csv at runtime so that
  // the regression guard is always checked against the same source of truth used
  // by the accuracy harness.  A CSV update that is NOT reflected here produces an
  // immediate, visible error before any upload happens — preventing silent drift.
  const gtCsvPath = path.resolve(__dirname, "../../uat/extraction-accuracy/ground-truth.csv");
  if (!existsSync(gtCsvPath)) {
    assert(false, `Suite 11: ground-truth CSV not found at ${gtCsvPath} — cannot build snapshot`);
  }
  const { readFileSync: readFileSyncGt } = await import("node:fs");
  const gtCsvText = readFileSyncGt(gtCsvPath, "utf8");

  // Minimal RFC-4180-compatible CSV parser — handles double-quoted fields with
  // embedded commas (e.g. "BzRhino Consulting, LLC", "Van Meter, Inc.").
  const parseCsvRow = (line) => {
    const fields = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; } // escaped ""
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(field);
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field);
    return fields;
  };

  const gtLines = gtCsvText.trim().split(/\r?\n/);
  const gtHeaders = parseCsvRow(gtLines[0]);
  const col = (name) => gtHeaders.indexOf(name);
  const REQUIRED_CSV_COLS = ["testCaseId", "invoiceNumber", "vendorRawName", "invoiceDate", "dueDate", "paymentTerms", "subtotal", "taxAmount", "totalAmount", "currency"];
  const missingCols = REQUIRED_CSV_COLS.filter((h) => col(h) === -1);
  if (missingCols.length > 0) {
    assert(false, `Suite 11: ground-truth CSV is missing required column(s): ${missingCols.join(", ")} (headers found: ${gtHeaders.join(", ")})`);
  }

  // ── Numeric cell parser (validates raw string before conversion) ─────────────
  // Using Number("") === 0, which is isFinite — blank cells would silently become
  // zero and corrupt expected totals.  This helper rejects blank/non-numeric raw
  // values with a descriptive error before the SNAPSHOT is built.
  const parseRequiredFinite = (rawCell, field, rowRef) => {
    const trimmed = (rawCell ?? "").trim();
    if (trimmed === "") {
      throw new Error(`Suite 11 ground-truth ${rowRef}: ${field} is blank — must be a number`);
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      throw new Error(`Suite 11 ground-truth ${rowRef}: ${field} is not a finite number (got "${trimmed}")`);
    }
    return n;
  };

  // Build the snapshot from CSV rows.
  // invoiceDate stays in M/D/YYYY (ground-truth format) — normDate normalises both
  // sides of the comparison, so no pre-conversion is needed here.
  const SNAPSHOT = gtLines.slice(1).filter(Boolean).map((line, lineIdx) => {
    const row = parseCsvRow(line);
    const rowRef = `row ${lineIdx + 2} (line ${lineIdx + 2} of CSV)`;
    return {
      testCaseId:    row[col("testCaseId")].trim(),
      invoiceNumber: row[col("invoiceNumber")].trim(),
      vendorRawName: row[col("vendorRawName")].trim(),
      invoiceDate:   row[col("invoiceDate")].trim(),
      dueDate:       row[col("dueDate")].trim(),
      paymentTerms:  row[col("paymentTerms")].trim(),
      subtotal:      parseRequiredFinite(row[col("subtotal")], "subtotal", rowRef),
      taxAmount:     parseRequiredFinite(row[col("taxAmount")], "taxAmount", rowRef),
      totalAmount:   parseRequiredFinite(row[col("totalAmount")], "totalAmount", rowRef),
      currency:      row[col("currency")].trim(),
    };
  });

  if (SNAPSHOT.length === 0) {
    assert(false, "Suite 11: ground-truth CSV contains no data rows — cannot build snapshot");
  }

  // ── Strict calendar-date validator ──────────────────────────────────────────
  // `new Date("2/30/2026")` silently normalises to March 2 and would pass an
  // isNaN check.  Instead we parse the M/D/YYYY parts explicitly and round-trip
  // through the 3-argument Date constructor so any day-of-month overflow is
  // detected (month/day would differ from what we supplied).
  const isValidCalendarDate = (s) => {
    if (!s || typeof s !== "string") return false;
    // Accept M/D/YYYY or MM/DD/YYYY (the format used in ground-truth.csv)
    const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return false;
    const month = Number(m[1]);
    const day   = Number(m[2]);
    const year  = Number(m[3]);
    if (month < 1 || month > 12) return false;
    if (day   < 1 || day   > 31) return false;
    if (year  < 1900 || year > 2100) return false;
    // Round-trip: if day overflows the month (e.g. Feb 30) the Date rolls
    // forward and the parts no longer match what we supplied.
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  };

  // ── Per-row integrity checks ─────────────────────────────────────────────────
  // Validate each parsed row before any upload so that a malformed CSV produces
  // a loud, descriptive error rather than a silent mismatch downstream.
  for (const row of SNAPSHOT) {
    const loc = `Suite 11 ground-truth row testCaseId="${row.testCaseId}"`;
    assert(
      row.testCaseId.length > 0,
      `${loc}: testCaseId must not be empty`,
    );
    assert(
      row.invoiceNumber.length > 0,
      `${loc}: invoiceNumber must not be empty`,
    );
    assert(
      row.vendorRawName.length > 0,
      `${loc}: vendorRawName must not be empty`,
    );
    assert(
      isValidCalendarDate(row.invoiceDate),
      `${loc}: invoiceDate must be a valid M/D/YYYY calendar date (got "${row.invoiceDate}")`,
    );
    assert(
      isValidCalendarDate(row.dueDate),
      `${loc}: dueDate must be a valid M/D/YYYY calendar date (got "${row.dueDate}")`,
    );
    assert(
      row.paymentTerms.length > 0,
      `${loc}: paymentTerms must not be empty`,
    );
    // subtotal, taxAmount, and totalAmount are already guaranteed finite by
    // parseRequiredFinite (called during SNAPSHOT construction above), but
    // re-assert here so failures are reported with the row label rather than
    // as a thrown Error.
    assert(
      Number.isFinite(row.subtotal),
      `${loc}: subtotal must be a finite number (got "${row.subtotal}")`,
    );
    assert(
      Number.isFinite(row.taxAmount),
      `${loc}: taxAmount must be a finite number (got "${row.taxAmount}")`,
    );
    assert(
      Number.isFinite(row.totalAmount),
      `${loc}: totalAmount must be a finite number (got "${row.totalAmount}")`,
    );
    assert(
      /^[A-Za-z]{3}$/.test(row.currency),
      `${loc}: currency must be a 3-letter code (got "${row.currency}")`,
    );
  }

  // ── Uniqueness check: every testCaseId must appear exactly once ──────────────
  // A duplicated testCaseId would cause one test case to silently shadow another,
  // producing misleading accuracy scores.  Detect and reject duplicates before
  // any upload so that a CSV edit that introduces a collision fails loudly.
  {
    const seenAt = new Map(); // testCaseId → first CSV line number (1-based, header is line 1)
    for (let i = 0; i < SNAPSHOT.length; i++) {
      const id = SNAPSHOT[i].testCaseId;
      const lineNum = i + 2; // +1 for header, +1 for 0-based index
      if (seenAt.has(id)) {
        assert(
          false,
          `Suite 11: duplicate testCaseId "${id}" found at CSV rows ${seenAt.get(id)} and ${lineNum} — every testCaseId must be unique`,
        );
      }
      seenAt.set(id, lineNum);
    }
    assert(true, `Suite 11: all ${SNAPSHOT.length} testCaseId values are unique`);
  }

  console.log(`  → Snapshot loaded from ground-truth CSV: ${SNAPSHOT.length} test case(s) (${gtCsvPath})`);
  const ACCURACY_THRESHOLD = 95; // percent — fail if overall accuracy drops below this

  // ── Vendor-name normalization ────────────────────────────────────────────────
  // Strip ALL whitespace and punctuation so that minor AI formatting variations
  // ("AutomationDirect" vs "Automation Direct", "VAN METER INC" vs "Van Meter Inc.")
  // compare equal while still catching real regressions (null, completely wrong name).
  // Strip common TLD suffixes first (.com, .net, .org, .io) so that
  // "AutomationDirect.com" and "AutomationDirect" both normalize identically.
  const normVendor = (v) =>
    String(v ?? "").toLowerCase().replace(/\.(com|net|org|io)\b/g, "").replace(/[^a-z0-9]/g, "");

  // Strip a single trailing legal-entity token if present.
  // This allows "BzRhino Consulting" to match "BzRhino Consulting, LLC" when the
  // system prompt instructs the model to omit suffixes, while still requiring the
  // full core name — so a truncated value like "B" does NOT match "BDI".
  // Only one suffix is stripped (no chained removal).
  const LEGAL_SUFFIXES = ["llc", "inc", "corp", "ltd", "co", "lp", "llp", "plc"];
  const stripLegalSuffix = (s) => {
    for (const sfx of LEGAL_SUFFIXES) {
      if (s.endsWith(sfx) && s.length > sfx.length) {
        return s.slice(0, -sfx.length);
      }
    }
    return s;
  };

  // Core match: both sides are normalized then stripped of one legal suffix.
  // An empty or punctuation-only extracted value is ALWAYS a mismatch so that
  // null/blank vendorRawName regressions are caught.
  const vendorMatch = (extracted, expected) => {
    const e = stripLegalSuffix(normVendor(extracted));
    if (e.length === 0) return false; // null / empty / punctuation-only → regression
    const x = stripLegalSuffix(normVendor(expected));
    return e === x;
  };

  // ── Self-test the comparison logic before uploading anything ─────────────────
  // These run synchronously and fast; a failure here means the guard itself is
  // broken, not the extraction pipeline.
  const vmTests = [
    // null / empty / punctuation-only must always fail
    [null,                   "BDI - Princeton",               false, "null extracted → mismatch"],
    ["",                     "BDI - Princeton",               false, "empty string → mismatch"],
    ["...",                  "BDI - Princeton",               false, "punctuation-only → mismatch"],
    // one-character / severely truncated must fail
    ["B",                    "BDI - Princeton",               false, "single char 'B' → mismatch"],
    ["A",                    "AutomationDirect.com, Inc.",    false, "single char 'A' → mismatch"],
    ["Rice",                 "Rice Lake Weighing Systems",    false, "truncated 'Rice' → mismatch"],
    // legal-suffix omission should pass
    ["BzRhino Consulting",   "BzRhino Consulting, LLC",      true,  "missing LLC suffix → match"],
    ["Van Meter",            "Van Meter Inc.",                true,  "missing Inc suffix → match"],
    // spacing / case / TLD variations should pass
    ["AutomationDirect",     "AutomationDirect.com, Inc.",   true,  "no .com + no Inc suffix → match"],
    ["AutomationDirect.com", "AutomationDirect.com, Inc.",   true,  ".com TLD stripped → match"],
    ["VAN METER INC",        "Van Meter Inc.",                true,  "all-caps vs mixed → match"],
    // completely wrong names must fail
    ["Wrong Company",        "BDI - Princeton",              false, "wrong name → mismatch"],
    // dash-space variant normalizes identically (punctuation stripped)
    ["BDI Princeton",        "BDI - Princeton",              true,  "BDI Princeton matches BDI - Princeton after punctuation stripping"],
  ];
  for (const [ext, exp, want, label] of vmTests) {
    const got = vendorMatch(ext, exp);
    assert(got === want, `vendorMatch self-test: ${label} (got ${got}, want ${want})`);
  }

  // Invoice-number normalization: strip leading zeros from purely-numeric IDs.
  // The AI may add or drop leading zeros non-deterministically ("00215" vs "215");
  // alphanumeric IDs like "S014432461.002" keep their exact structure.
  const normInvNum = (v) => {
    const s = String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    return /^[0-9 ]+$/.test(s) ? s.replace(/^0+/, "") || "0" : s;
  };

  // ── Date normalization ────────────────────────────────────────────────────────
  // Convert any reasonable date string to YYYY-MM-DD for comparison.
  // Handles ISO (2026-05-21), M/D/YYYY (5/21/2026), and MM/DD/YYYY (05/21/2026).
  // Returns null for unparseable input so the comparison loop can flag it.
  const normDate = (v) => {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    // Already ISO: YYYY-MM-DD or YYYY-MM-DDT...
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    // M/D/YYYY or MM/DD/YYYY
    const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mdyMatch) {
      const mm = mdyMatch[1].padStart(2, "0");
      const dd = mdyMatch[2].padStart(2, "0");
      return `${mdyMatch[3]}-${mm}-${dd}`;
    }
    return null;
  };

  // ── Self-test normDate before uploading anything ──────────────────────────────
  const ndTests = [
    // ISO YYYY-MM-DD
    ["2026-05-21",           "2026-05-21", "ISO YYYY-MM-DD → canonical"],
    // ISO with time component
    ["2026-05-21T00:00:00Z", "2026-05-21", "ISO datetime → date-only"],
    // M/D/YYYY (single-digit month and day)
    ["5/21/2026",            "2026-05-21", "M/D/YYYY → canonical"],
    // MM/DD/YYYY (zero-padded)
    ["05/21/2026",           "2026-05-21", "MM/DD/YYYY → canonical"],
    // null and empty string → null
    [null,                   null,         "null → null"],
    ["",                     null,         "empty string → null"],
    // unparseable → null
    ["not-a-date",           null,         "unparseable string → null"],
  ];
  for (const [input, want, label] of ndTests) {
    const got = normDate(input);
    assert(got === want, `normDate self-test: ${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  }

  // ── Total-amount comparison (±0.02 tolerance) ─────────────────────────────────
  // Allow small floating-point rounding differences from extraction.
  // Returns true only for finite, non-NaN amounts within tolerance.
  // IMPORTANT: null, undefined, and blank strings are explicitly rejected BEFORE
  // Number() conversion — Number(null) and Number("") both coerce to 0, which
  // would silently mark a missing extracted amount as correct when expected is 0.
  const amountMatch = (extractedRaw, expectedNum) => {
    if (extractedRaw == null) return false;               // null or undefined
    if (typeof extractedRaw === "string" && extractedRaw.trim() === "") return false; // blank string
    const extracted = Number(extractedRaw);
    if (!isFinite(extracted)) return false;               // NaN, Infinity, -Infinity
    return Math.abs(extracted - expectedNum) <= 0.02;
  };

  // ── Self-test amountMatch before uploading anything ───────────────────────────
  const amTests = [
    // exact match
    [1234.56,        1234.56, true,  "exact match"],
    // within ±0.02 tolerance
    [1234.57,        1234.56, true,  "within +0.01 tolerance"],
    [1234.55,        1234.56, true,  "within -0.01 tolerance"],
    [1234.58,        1234.56, true,  "within +0.02 tolerance (boundary)"],
    [1234.54,        1234.56, true,  "within -0.02 tolerance (boundary)"],
    // out of tolerance
    [1234.59,        1234.56, false, "out of +0.03 tolerance"],
    [1234.53,        1234.56, false, "out of -0.03 tolerance"],
    [0,              1234.56, false, "zero vs non-zero → mismatch"],
    // null / undefined / blank vs nonzero expected → mismatch
    [null,           1234.56, false, "null extracted (nonzero expected) → mismatch"],
    [undefined,      1234.56, false, "undefined extracted (nonzero expected) → mismatch"],
    ["",             1234.56, false, "blank string extracted (nonzero expected) → mismatch"],
    // null / blank vs ZERO expected — must still be mismatch (regression guard)
    [null,           0,       false, "null extracted (zero expected) → mismatch"],
    ["",             0,       false, "blank string extracted (zero expected) → mismatch"],
    // non-finite / non-numeric
    [NaN,            1234.56, false, "NaN extracted → mismatch"],
    [Infinity,       1234.56, false, "Infinity extracted → mismatch"],
    ["not-a-number", 100,     false, "non-numeric string → mismatch"],
  ];
  for (const [extractedRaw, expectedNum, want, label] of amTests) {
    const got = amountMatch(extractedRaw, expectedNum);
    assert(got === want, `amountMatch self-test: ${label} (got ${got}, want ${want})`);
  }

  // Locate the UAT test PDF (two levels up from artifacts/api-server/).
  const uatPdfPath = path.resolve(__dirname, "../../uat/extraction-accuracy/pack/invoice_Ingestor_5_invoice_test_1786035375284.pdf");

  if (!existsSync(uatPdfPath)) {
    // Loud warning but not a hard failure — the file may not be committed in all
    // environments.  The test is skipped so it can't produce a false pass.
    warn(`Suite 11 SKIPPED — UAT test PDF not found at ${uatPdfPath}`);
    assert(false, `Suite 11: UAT test PDF present at expected path (${uatPdfPath})`);
  } else {
    const { readFileSync } = await import("node:fs");
    const uatPdf = readFileSync(uatPdfPath);
    console.log(`  → UAT PDF loaded: ${(uatPdf.length / 1024).toFixed(1)} KB`);

    // Stage 1: Request presigned upload URL.
    const s11UrlRes = await api("POST", "/storage/uploads/request-url", {
      name: "regression_guard_suite11.pdf",
      size: uatPdf.length,
      contentType: "application/pdf",
    });
    assert(
      s11UrlRes.ok,
      `Suite 11: storage presigned URL returned (status=${s11UrlRes.status}): ${JSON.stringify(s11UrlRes.json).slice(0, 200)}`,
    );
    const { uploadURL: s11UploadURL, objectPath: s11ObjectPath } = s11UrlRes.json;

    // Stage 2: Upload PDF.
    const s11PutRes = await fetch(s11UploadURL, {
      method: "PUT",
      body: uatPdf,
      headers: { "Content-Type": "application/pdf" },
    });
    assert(s11PutRes.ok, `Suite 11: UAT PDF uploaded via presigned PUT (status=${s11PutRes.status})`);
    orphanedObjectPaths.push(s11ObjectPath);

    // Stage 3: Create source document.
    const { status: s11csS, json: s11csJ } = await api("POST", "/source-documents", {
      fileObjectPath: s11ObjectPath,
      originalFileName: "regression_guard_suite11.pdf",
      contentType: "application/pdf",
    });
    assert(
      s11csS === 200 || s11csS === 201,
      `Suite 11: POST /source-documents returns 2xx (got ${s11csS}: ${JSON.stringify(s11csJ).slice(0, 200)})`,
    );
    const s11SourceId = s11csJ.source?.id;
    assert(typeof s11SourceId === "number", `Suite 11: source document id returned (id=${s11SourceId})`);
    createdSourceDocIds.push(s11SourceId);
    orphanedObjectPaths.splice(orphanedObjectPaths.indexOf(s11ObjectPath), 1);
    console.log(`  → source document id=${s11SourceId}`);

    // Stage 4: Poll until all expected invoices are detected.
    const s11AfterDetection = await poll(
      async () => {
        const { json: d } = await api("GET", `/source-documents/${s11SourceId}`);
        const s = d.source;
        console.log(`  … Suite 11 detect: proc=${s?.processingStatus} detected=${s?.detectedInvoiceCount} invoiceCount=${d?.invoiceCount}`);
        const done =
          (s.processingStatus === "COMPLETED" || s.processingStatus === "EXCEPTION") &&
          d.invoiceCount > 0;
        if (done) return d;
        const finishedEmpty =
          (s.processingStatus === "COMPLETED" || s.processingStatus === "EXCEPTION") &&
          s.detectedInvoiceCount === 0;
        if (finishedEmpty) return { _detectionEmpty: true, source: s };
        return false;
      },
      { timeoutMs: 90_000, label: "Suite 11 source document detection" },
    );

    if (s11AfterDetection._detectionEmpty) {
      assert(false, `Suite 11: detection finished with 0 invoices (proc=${s11AfterDetection.source?.processingStatus})`);
    }

    const s11Invoices = s11AfterDetection.invoices ?? [];
    assert(
      s11Invoices.length === SNAPSHOT.length,
      `Suite 11: detected ${s11Invoices.length} invoice(s) — expected ${SNAPSHOT.length} (one per TP test case)`,
    );
    console.log(`  → detected ${s11Invoices.length} invoices — waiting for extraction …`);
    for (const inv of s11Invoices) createdInvoiceIds.push(inv.id);

    // Stage 5: Wait for extraction to complete on all invoices.
    const s11Finals = [];
    for (const inv of s11Invoices) {
      const fin = await waitForExtraction(inv.id, 120_000);
      s11Finals.push(fin);
      console.log(
        `  → invoice ${inv.id}: status=${fin.status}` +
        ` invoiceNumber=${fin.invoiceNumber ?? "(none)"}` +
        ` vendorRawName=${fin.vendorRawName ?? "(none)"}` +
        ` invoiceDate=${fin.invoiceDate ?? "(none)"}` +
        ` dueDate=${fin.dueDate ?? "(none)"}` +
        ` subtotal=${fin.subtotal ?? "(none)"}` +
        ` taxAmount=${fin.taxAmount ?? "(none)"}` +
        ` totalAmount=${fin.totalAmount ?? "(none)"}` +
        ` currency=${fin.currency ?? "(none)"}`,
      );
    }

    // Stage 6: Check every invoice against the snapshot.
    // Match by normalized invoiceNumber; anything unmatched counts as missing.
    // Guarded fields: vendorRawName, invoiceNumber, invoiceDate, dueDate, subtotal, taxAmount, totalAmount, currency.
    let s11Correct = 0;
    let s11Total = 0;
    const s11Diffs = [];

    for (const snap of SNAPSHOT) {
      const match = s11Finals.find(
        (inv) => normInvNum(inv.invoiceNumber ?? "") === normInvNum(snap.invoiceNumber),
      );

      // — vendorRawName —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} vendorRawName: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}" (expected "${snap.vendorRawName}")`);
      } else {
        if (vendorMatch(match.vendorRawName ?? "", snap.vendorRawName)) {
          s11Correct++;
        } else {
          s11Diffs.push(`${snap.testCaseId} vendorRawName: expected "${snap.vendorRawName}" got "${match.vendorRawName ?? "(null)"}"`);
        }
      }

      // — invoiceNumber —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} invoiceNumber: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}"`);
      } else {
        // Match itself proves invoiceNumber is correct — it was used to find the row.
        s11Correct++;
      }

      // — invoiceDate —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} invoiceDate: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}" (expected "${snap.invoiceDate}")`);
      } else {
        const extractedDate = normDate(match.invoiceDate);
        const expectedDate  = normDate(snap.invoiceDate);
        if (extractedDate !== null && extractedDate === expectedDate) {
          s11Correct++;
        } else {
          s11Diffs.push(`${snap.testCaseId} invoiceDate: expected "${snap.invoiceDate}" got "${match.invoiceDate ?? "(null)"}"`);
        }
      }

      // — dueDate —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} dueDate: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}" (expected "${snap.dueDate}")`);
      } else {
        const extractedDueDate = normDate(match.dueDate);
        const expectedDueDate  = normDate(snap.dueDate);
        if (extractedDueDate !== null && extractedDueDate === expectedDueDate) {
          s11Correct++;
        } else {
          s11Diffs.push(`${snap.testCaseId} dueDate: expected "${snap.dueDate}" got "${match.dueDate ?? "(null)"}"`);
        }
      }

      // — subtotal —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} subtotal: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}" (expected ${snap.subtotal})`);
      } else {
        // Allow ±0.02 tolerance for floating-point rounding in extraction.
        if (amountMatch(match.subtotal, snap.subtotal)) {
          s11Correct++;
        } else {
          s11Diffs.push(`${snap.testCaseId} subtotal: expected ${snap.subtotal} got "${match.subtotal ?? "(null)"}"`);
        }
      }

      // — taxAmount —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} taxAmount: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}" (expected ${snap.taxAmount})`);
      } else {
        // Allow ±0.02 tolerance for floating-point rounding in extraction.
        if (amountMatch(match.taxAmount, snap.taxAmount)) {
          s11Correct++;
        } else {
          s11Diffs.push(`${snap.testCaseId} taxAmount: expected ${snap.taxAmount} got "${match.taxAmount ?? "(null)"}"`);
        }
      }

      // — totalAmount —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} totalAmount: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}" (expected ${snap.totalAmount})`);
      } else {
        // Allow ±0.02 tolerance for floating-point rounding in extraction.
        if (amountMatch(match.totalAmount, snap.totalAmount)) {
          s11Correct++;
        } else {
          s11Diffs.push(`${snap.testCaseId} totalAmount: expected ${snap.totalAmount} got "${match.totalAmount ?? "(null)"}"`);
        }
      }

      // — currency —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} currency: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}" (expected "${snap.currency}")`);
      } else {
        const extractedCurrency = String(match.currency ?? "").trim().toUpperCase();
        const expectedCurrency  = snap.currency.toUpperCase();
        if (extractedCurrency === expectedCurrency) {
          s11Correct++;
        } else {
          s11Diffs.push(`${snap.testCaseId} currency: expected "${snap.currency}" got "${match.currency ?? "(null)"}"`);
        }
      }

      // — paymentTerms —
      s11Total++;
      if (!match) {
        s11Diffs.push(`${snap.testCaseId} paymentTerms: no extracted invoice matched invoiceNumber="${snap.invoiceNumber}" (expected "${snap.paymentTerms}")`);
      } else {
        const extractedTerms = String(match.paymentTerms ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const expectedTerms  = snap.paymentTerms.trim().toLowerCase().replace(/\s+/g, " ");
        if (extractedTerms !== "" && extractedTerms === expectedTerms) {
          s11Correct++;
        } else {
          s11Diffs.push(`${snap.testCaseId} paymentTerms: expected "${snap.paymentTerms}" got "${match.paymentTerms ?? "(null)"}"`);
        }
      }
    }

    const s11Accuracy = s11Total > 0 ? (s11Correct / s11Total) * 100 : 0;
    console.log(`\n  Suite 11 accuracy: ${s11Correct}/${s11Total} fields correct (${s11Accuracy.toFixed(1)}%)`);

    if (s11Diffs.length > 0) {
      console.error("  ✗ Extraction regression detected — field drift from known-correct snapshot:");
      for (const d of s11Diffs) console.error(`    • ${d}`);
    }

    assert(
      s11Diffs.length === 0,
      `Suite 11: vendorRawName/invoiceNumber/invoiceDate/dueDate/paymentTerms/subtotal/taxAmount/totalAmount/currency match known-correct snapshot for all TP-001–TP-005 (${s11Diffs.length} drift(s): ${s11Diffs.join("; ")})`,
    );
    assert(
      s11Accuracy >= ACCURACY_THRESHOLD,
      `Suite 11: overall extraction accuracy ${s11Accuracy.toFixed(1)}% >= ${ACCURACY_THRESHOLD}% threshold`,
    );
    console.log(`  ✓ All TP-001–TP-005 fields (vendorRawName, invoiceNumber, invoiceDate, dueDate, paymentTerms, subtotal, taxAmount, totalAmount, currency) match snapshot, accuracy=${s11Accuracy.toFixed(1)}%`);
  }
}

// ─── Suite 12: Actor attribution end-to-end — GET /source-documents/:id/audit ─
//
// Verifies that actorClerkId and actorName survive the full stack from DB write
// through the API response shape.  Uses the source document created in Suite 4,
// which accumulates audit rows from:
//   • "system-pipeline" — written by detection, vendor-matching, and extraction
//   • "smoke-test"      — written by the approve and voucher actions in Suite 4
//
// A regression at any serialization layer (Drizzle select → Zod parse → JSON)
// that strips or overwrites either field will fail this suite.

console.log("\n══════════════════════════════════════════");
console.log("SUITE 12: Actor attribution end-to-end");
console.log("  GET /source-documents/:id/audit → actorClerkId + actorName");
console.log("  Covers system-pipeline case and human-actor (smoke-test) case");
console.log("══════════════════════════════════════════");

if (suite4SourceId == null) {
  // Suite 4 failed to create the source document — skip gracefully rather than
  // producing a misleading 404.
  assert(false, "Suite 12 SKIPPED — suite4SourceId not set (Suite 4 must have failed earlier)");
} else {
  const { status: auditS, json: auditJ } = await api("GET", `/source-documents/${suite4SourceId}/audit`);
  assert(auditS === 200, `GET /source-documents/${suite4SourceId}/audit returns 200 (got ${auditS})`);
  assert(Array.isArray(auditJ), `audit response is an array (got ${typeof auditJ})`);
  assert(auditJ.length >= 1, `audit trail has at least one entry (got ${auditJ.length})`);

  // Every row must carry actorClerkId (non-empty string) and actorName (key present).
  for (const row of auditJ) {
    assert(
      typeof row.actorClerkId === "string" && row.actorClerkId.length > 0,
      `audit row id=${row.id} action=${row.action}: actorClerkId is a non-empty string (got ${JSON.stringify(row.actorClerkId)})`,
    );
    assert(
      Object.prototype.hasOwnProperty.call(row, "actorName"),
      `audit row id=${row.id} action=${row.action}: actorName key present in response (field not stripped)`,
    );
  }

  // System-pipeline case: at least one row written by the automated pipeline.
  const sysPipelineRows = auditJ.filter((r) => r.actorClerkId === "system-pipeline");
  assert(
    sysPipelineRows.length >= 1,
    `At least one audit row has actorClerkId="system-pipeline" (detection/extraction writes these; got ${sysPipelineRows.length})`,
  );
  console.log(`  → system-pipeline rows: ${sysPipelineRows.length} (actions: ${sysPipelineRows.map((r) => r.action).join(", ")})`);

  // Human-actor case: at least one row written by the smoke-test user (approve/voucher).
  const humanRows = auditJ.filter((r) => r.actorClerkId === "smoke-test");
  assert(
    humanRows.length >= 1,
    `At least one audit row has actorClerkId="smoke-test" (approve/voucher in Suite 4 Stage 4/5; got ${humanRows.length})`,
  );
  console.log(`  → smoke-test (human) rows: ${humanRows.length} (actions: ${humanRows.map((r) => r.action).join(", ")})`);

  // actorName is nullable for system actions but must be the correct type when set.
  for (const row of auditJ) {
    if (row.actorName !== null && row.actorName !== undefined) {
      assert(
        typeof row.actorName === "string",
        `audit row id=${row.id}: actorName is string when non-null (got ${typeof row.actorName})`,
      );
    }
  }

  console.log(`  → actor attribution verified: ${auditJ.length} total rows, actorClerkId + actorName present on all`);
}

// ─── Suite 13: vendor_audit_log ON DELETE CASCADE integrity check ─────────────
//
// Verifies two things:
//   (a) No orphaned vendor_audit_log rows currently exist (vendorId refers to a
//       vendor_id row that has already been deleted outside the API).
//   (b) The ON DELETE CASCADE FK is active: deleting a vendor via the API
//       automatically removes its audit-log rows so the orphan count stays at 0.
//
// This is the runtime companion to the startup fkCoverageCheck — where that
// check asserts FK schema coverage at boot, this suite asserts observed cascade
// behaviour on every run.

console.log("\n══════════════════════════════════════════");
console.log("SUITE 13: vendor_audit_log ON DELETE CASCADE integrity");
console.log("  (a) Zero orphaned audit rows before this run");
console.log("  (b) Deleting a vendor via API leaves zero orphaned rows");
console.log("══════════════════════════════════════════");

{
  // ── (a) Baseline: no orphaned rows should exist ───────────────────────────
  const { status: baseS, json: baseJ } = await api("GET", "/vendors/orphaned-audit-count");
  assert(
    baseS === 200,
    `GET /vendors/orphaned-audit-count returns 200 (got ${baseS}: ${JSON.stringify(baseJ).slice(0, 200)})`,
  );
  assert(
    typeof baseJ.orphanedRows === "number",
    `orphanedRows is a number (got ${JSON.stringify(baseJ.orphanedRows)})`,
  );
  assert(
    baseJ.orphanedRows === 0,
    `No orphaned vendor_audit_log rows at baseline (got ${baseJ.orphanedRows} — vendors were deleted outside the API, bypassing ON DELETE CASCADE)`,
  );
  console.log(`  → baseline orphaned rows: ${baseJ.orphanedRows} ✓`);

  // ── (b) Create vendor → delete via API → cascade verified ─────────────────
  // The vendor creation automatically inserts a VENDOR_CREATED audit row.
  // Deleting via the API should trigger the ON DELETE CASCADE and remove it.
  const cascadeVendorCode = `CASC-${RUN_ID}`;
  const cascadeVendorName = `Cascade Test Vendor ${RUN_ID}`;

  const { status: cvS, json: cvJ } = await api("POST", "/vendors", {
    vendorCode: cascadeVendorCode,
    vendorName: cascadeVendorName,
    paymentTerms: "Net 30",
    isActive: true,
  });
  assert(cvS === 201, `Suite 13: POST /vendors returns 201 (got ${cvS}: ${JSON.stringify(cvJ).slice(0, 200)})`);
  const cascadeVendorId = cvJ.id;
  // Track for cleanup in case the delete assertion below fails.
  createdVendorIds.push(cascadeVendorId);
  console.log(`  → created vendor id=${cascadeVendorId} (has VENDOR_CREATED audit row)`);

  // Confirm the audit row was written.
  const { status: auditBeforeS, json: auditBeforeJ } = await api("GET", `/vendors/${cascadeVendorId}/audit`);
  assert(auditBeforeS === 200, `Suite 13: GET /vendors/:id/audit returns 200 before delete (got ${auditBeforeS})`);
  assert(
    Array.isArray(auditBeforeJ) && auditBeforeJ.length >= 1,
    `Suite 13: vendor has at least 1 audit row before delete (got ${auditBeforeJ?.length ?? "non-array"})`,
  );
  console.log(`  → audit rows before delete: ${auditBeforeJ.length}`);

  // Delete the vendor via the API (cascade removes audit rows).
  const { status: delS, json: delJ } = await api("DELETE", `/vendors/${cascadeVendorId}`, { confirm: true });
  assert(
    delS === 200,
    `Suite 13: DELETE /vendors/:id returns 200 (got ${delS}: ${JSON.stringify(delJ).slice(0, 200)})`,
  );
  assert(
    delJ.deleted === true,
    `Suite 13: vendor was hard-deleted (got deleted=${delJ.deleted}, deactivated=${delJ.deactivated})`,
  );
  // Remove from cleanup list — already deleted.
  const idx = createdVendorIds.indexOf(cascadeVendorId);
  if (idx !== -1) createdVendorIds.splice(idx, 1);
  console.log(`  → vendor ${cascadeVendorId} deleted via API`);

  // Verify orphan count is still zero after the delete.
  const { status: afterS, json: afterJ } = await api("GET", "/vendors/orphaned-audit-count");
  assert(
    afterS === 200,
    `Suite 13: GET /vendors/orphaned-audit-count returns 200 after delete (got ${afterS})`,
  );
  assert(
    afterJ.orphanedRows === 0,
    `Suite 13: ON DELETE CASCADE removed audit rows — orphanedRows=0 after vendor delete (got ${afterJ.orphanedRows})`,
  );
  console.log(`  → orphaned rows after delete: ${afterJ.orphanedRows} ✓ — cascade is active`);
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
