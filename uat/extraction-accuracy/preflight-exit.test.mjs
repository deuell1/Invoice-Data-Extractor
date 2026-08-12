// ─────────────────────────────────────────────────────────────────────────────
// preflight-exit.test.mjs
//
// Process-level tests for the baseline preflight wired into run-accuracy.mjs.
//
// Design
// ──────
// These tests spawn run-accuracy.mjs as a subprocess backed by a temporary
// mock HTTP server that serves /api/invoices responses.  This proves:
//
//   1. When a test-pack invoice has a DB-patched value (e.g. taxAmount=0 for
//      BzRhino, which natural extraction returns as null), the harness exits
//      with code 2 BEFORE producing any score or report.
//
//   2. When the same patched-looking value appears on an invoice whose
//      originalFileName is NOT the designated test-pack file, the preflight
//      stays silent and the harness exits with code 1 (score below threshold)
//      — confirming that the pack-scoping guard works correctly.
//
// The mock server is bound to an OS-assigned port (listen(0)) so tests are
// port-conflict free.  runScript() uses spawn() (not spawnSync()) so the JS
// event loop stays live and the HTTP server can serve the subprocess's request.
//
// Run with:
//   node --test uat/extraction-accuracy/preflight-exit.test.mjs
// or via the workspace test suite:
//   pnpm --filter @workspace/tests test
// ─────────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PACK_FILE } from "./preflight.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "run-accuracy.mjs");

// ─── Minimal ground-truth CSV ─────────────────────────────────────────────────
// One AutomationDirect row — enough to exercise PF-01 (vendorRawName patch) and
// to have a valid, parseable CSV.  Uses the pack source file so matchActual()
// can bind.
const GT_HEADER =
  "testCaseId,sourceFileName,invoiceNumber,vendorRawName,invoiceDate,dueDate,paymentTerms,poNumber,subtotal,taxAmount,freightAmount,totalAmount,currency";
const GT_ROW =
  `TP-T,${PACK_FILE},19237741,AutomationDirect.com Inc.,5/21/2026,6/20/2026,,,,,,10013.25,USD`;
const MINIMAL_GT_CSV = [GT_HEADER, GT_ROW].join("\n");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Start a local HTTP server that returns `invoices` for any /api/invoices request.
 * Uses port 0 so the OS picks a free port.
 */
function startMockServer(invoices) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url.startsWith("/api/invoices")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: invoices, total: invoices.length }));
      } else {
        res.writeHead(404);
        res.end("{}");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/**
 * Spawn run-accuracy.mjs with API_BASE pointing at the mock server.
 * Uses spawn() so the event loop stays live and the mock can serve requests.
 *
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runScript(port, csvPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, csvPath], {
      env: { ...process.env, API_BASE: `http://127.0.0.1:${port}/api` },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", reject);
  });
}

// ─── Process-level tests ──────────────────────────────────────────────────────

test("exits 2 before scoring when pack invoice has DB-patched vendorRawName (PF-01)", async () => {
  // AutomationDirect invoice with the trade name "Automation Direct"
  // (the DB-patched value; natural extraction produces "AutomationDirect.com, Inc.")
  const patchedPackInvoices = [
    {
      invoiceNumber: "19237741",
      vendorRawName: "Automation Direct",  // DB-patched: natural extraction returns "AutomationDirect.com, Inc."
      originalFileName: PACK_FILE,          // designated test-pack file
      invoiceDate: "2026-05-21",
      dueDate: "2026-06-20",
      taxAmount: 0,
      freightAmount: 0,
      totalAmount: 10013.25,
      currency: "USD",
    },
  ];

  const server = await startMockServer(patchedPackInvoices);
  const port = server.address().port;
  const tmpCsv = join(tmpdir(), `gt-test-patched-${port}.csv`);
  writeFileSync(tmpCsv, MINIMAL_GT_CSV);

  let result;
  try {
    result = await runScript(port, tmpCsv);
  } finally {
    server.close();
    try { unlinkSync(tmpCsv); } catch { /* ignore */ }
  }

  assert.equal(
    result.code,
    2,
    `Expected exit 2 (preflight abort) but got ${result.code}.\nstderr: ${result.stderr}`,
  );
  assert.ok(
    result.stderr.includes("patched") || result.stderr.includes("preflight"),
    `Expected preflight error message on stderr.\nstderr: ${result.stderr}`,
  );
  // No score or field-level report should appear when the preflight fires.
  assert.ok(
    !result.stdout.includes("Overall extraction accuracy"),
    `Score report was produced despite preflight exit.\nstdout: ${result.stdout}`,
  );
});

test("does not exit 2 when the same patched-looking value appears on a non-pack invoice", async () => {
  // Same AutomationDirect patched vendorRawName, but originates from a DIFFERENT source file.
  // The preflight is scoped to PACK_FILE so it must NOT fire here.
  const patchedNonPackInvoices = [
    {
      invoiceNumber: "19237741",
      vendorRawName: "Automation Direct",         // same patched value, but not a pack invoice
      originalFileName: "some_other_file.pdf",    // NOT the designated pack file
      invoiceDate: "2026-05-21",
      dueDate: "2026-06-20",
      taxAmount: 0,
      freightAmount: 0,
      totalAmount: 10013.25,
      currency: "USD",
    },
  ];

  const server = await startMockServer(patchedNonPackInvoices);
  const port = server.address().port;
  const tmpCsv = join(tmpdir(), `gt-test-nonpack-${port}.csv`);
  writeFileSync(tmpCsv, MINIMAL_GT_CSV);

  let result;
  try {
    result = await runScript(port, tmpCsv);
  } finally {
    server.close();
    try { unlinkSync(tmpCsv); } catch { /* ignore */ }
  }

  assert.notEqual(
    result.code,
    2,
    `Preflight fired on a non-pack invoice — scoping guard is broken.\n` +
    `exit code: ${result.code}\nstderr: ${result.stderr}`,
  );
  // The harness should complete (exit 1 = score below threshold) rather than aborting.
  assert.equal(
    result.code,
    1,
    `Expected exit 1 (score failed) for non-pack run but got ${result.code}.\n` +
    `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
});
