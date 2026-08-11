/**
 * smoke_cleanup_fixture.mjs
 *
 * Process-level fixture used by smoke_cleanup_exit.test.mjs to verify that
 * the smoke-test exit-code wiring fires correctly when cleanup fails.
 *
 * Imports runCleanup() from smoke_cleanup.mjs — the same function used by
 * production smoke_test.mjs — so any regression in the real cleanup code
 * will break both this fixture and the live smoke run.
 *
 * Environment variables
 * ─────────────────────
 *   MOCK_STEP    — which cleanup step the mock api should fail:
 *                  "void_invoice" | "delete_invoice" | "delete_source_doc" |
 *                  "delete_orphan" | "delete_export" | "delete_vendor" | "none"
 *   MOCK_STATUS  — HTTP status the failing step returns (default: 500)
 *   MOCK_THROW   — if "1", the failing step throws instead of returning a status
 *
 * All other steps return 200 (accepted).
 *
 * Exit codes
 * ──────────
 *   0 — runCleanup() reported failed === 0
 *   1 — runCleanup() reported failed > 0
 *
 * This mirrors the final line of smoke_test.mjs:
 *   process.exit(failed > 0 ? 1 : 0)
 */

import { runCleanup } from "./smoke_cleanup.mjs";

const MOCK_STEP   = process.env.MOCK_STEP   ?? "none";
const MOCK_STATUS = Number(process.env.MOCK_STATUS ?? "500");
const MOCK_THROW  = process.env.MOCK_THROW === "1";

// ── Step-routing helpers ──────────────────────────────────────────────────────

function classifyCall(method, urlPath) {
  if (method === "POST"   && /\/invoices\/\d+\/void/.test(urlPath))  return "void_invoice";
  if (method === "DELETE" && /\/invoices\/\d+/.test(urlPath))        return "delete_invoice";
  if (method === "DELETE" && /\/source-documents\/\d+/.test(urlPath)) return "delete_source_doc";
  if (method === "DELETE" && /\/storage\/objects\//.test(urlPath))   return "delete_orphan";
  if (method === "DELETE" && /\/exports\/\d+/.test(urlPath))         return "delete_export";
  if (method === "DELETE" && /\/vendors\/\d+/.test(urlPath))         return "delete_vendor";
  return "other";
}

/** Mock api — never hits the network. */
async function mockApi(method, urlPath /*, body */) {
  const step = classifyCall(method, urlPath);

  if (step === MOCK_STEP) {
    if (MOCK_THROW) {
      throw new Error(`Simulated network error for step "${step}"`);
    }
    return { status: MOCK_STATUS, ok: MOCK_STATUS >= 200 && MOCK_STATUS < 300, json: {}, headers: new Headers() };
  }

  // All other calls succeed.
  return { status: 200, ok: true, json: {}, headers: new Headers() };
}

// ── Pre-populated tracking arrays (one entry each, matching smoke_test.mjs) ───

const createdInvoiceIds     = [7];
const createdVendorIds      = [42];
const createdSourceDocIds   = [3];
const createdExportBatchIds = [9];
const orphanedObjectPaths   = ["/objects/smoke/orphan.pdf"];

// ── Run and exit with the same wiring as smoke_test.mjs ──────────────────────

const { failed } = await runCleanup({
  api: mockApi,
  createdInvoiceIds,
  createdVendorIds,
  createdSourceDocIds,
  createdExportBatchIds,
  orphanedObjectPaths,
});

process.exit(failed > 0 ? 1 : 0);
