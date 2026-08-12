/**
 * smoke_cleanup_exit.test.mjs
 *
 * Verifies that the cleanup phase of the smoke test correctly surfaces
 * failures and that the exit-code wiring fires accordingly.
 *
 * Design
 * ──────
 * The test imports runCleanup() directly from smoke_cleanup.mjs — the same
 * module used by production smoke_test.mjs — so any regression in the real
 * cleanup code will break these tests immediately.
 *
 * Two layers of verification:
 *
 *   1. Direct-import tests (fast, most cases)
 *      Import runCleanup, inject a mock api, call the function, and assert
 *      that { failed } matches expectation.  This tests the cleanup logic.
 *
 *   2. Exit-code subprocess tests (per-step, verifies wiring)
 *      Spawn smoke_cleanup_fixture.mjs — which imports the same runCleanup
 *      and exits via `process.exit(failed > 0 ? 1 : 0)` — and assert the
 *      OS-visible exit code.  This tests that the wiring fires correctly and
 *      that the fixture path round-trips through the real module.
 *
 * Run with:
 *   node --test artifacts/api-server/smoke_cleanup_exit.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runCleanup } from "./smoke_cleanup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE   = path.join(__dirname, "smoke_cleanup_fixture.mjs");

// ── One tracking item per array so every step is exercised ───────────────────

const ONE_OF_EACH = {
  createdInvoiceIds:     [7],
  createdVendorIds:      [42],
  createdSourceDocIds:   [3],
  createdExportBatchIds: [9],
  orphanedObjectPaths:   ["/objects/smoke/orphan.pdf"],
};

/** Build a mock api where `failStep` returns `failStatus`; everything else 200. */
function makeMockApi({ failStep = null, failStatus = 500, shouldThrow = false } = {}) {
  return async function mockApi(method, urlPath) {
    let step = "other";
    if (method === "POST"   && /\/invoices\/\d+\/void/.test(urlPath))     step = "void_invoice";
    else if (method === "DELETE" && /\/invoices\/\d+/.test(urlPath))       step = "delete_invoice";
    else if (method === "DELETE" && /\/source-documents\/\d+/.test(urlPath)) step = "delete_source_doc";
    else if (method === "DELETE" && /\/storage\/objects\//.test(urlPath))  step = "delete_orphan";
    else if (method === "DELETE" && /\/exports\/\d+/.test(urlPath))        step = "delete_export";
    else if (method === "DELETE" && /\/vendors\/\d+/.test(urlPath))        step = "delete_vendor";

    if (step === failStep) {
      if (shouldThrow) throw new Error(`Simulated network error on step "${step}"`);
      return { status: failStatus, ok: false, json: {}, headers: new Headers() };
    }
    return { status: 200, ok: true, json: {}, headers: new Headers() };
  };
}

/** Spawn the fixture and return { code, stdout, stderr }. */
function runFixture(env = {}) {
  const result = spawnSync(process.execPath, [FIXTURE], {
    env: { ...process.env, ...env },
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code:   result.status,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 1 — direct-import tests (verify runCleanup() return value)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Happy path ────────────────────────────────────────────────────────────────

test("all steps return 200 → failed === 0", async () => {
  const { failed } = await runCleanup({ api: makeMockApi(), ...ONE_OF_EACH });
  assert.equal(failed, 0);
});

test("all steps return 404 (already gone) → failed === 0", async () => {
  // 404 is explicitly accepted by every step — "already gone" is a valid outcome.
  const api = async () => ({ status: 404, ok: false, json: {}, headers: new Headers() });
  const { failed } = await runCleanup({ api, ...ONE_OF_EACH });
  assert.equal(failed, 0);
});

test("nothing to clean up → failed === 0 (early return)", async () => {
  const api = makeMockApi({ failStep: "void_invoice", failStatus: 500 });
  const { failed } = await runCleanup({
    api,
    createdInvoiceIds:     [],
    createdVendorIds:      [],
    createdSourceDocIds:   [],
    createdExportBatchIds: [],
    orphanedObjectPaths:   [],
  });
  // No items → cleanup skips all steps; api is never called; failed stays 0.
  assert.equal(failed, 0);
});

// ── Unexpected HTTP status — each step ───────────────────────────────────────

test("void-invoice returns 500 → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "void_invoice", failStatus: 500 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("void-invoice returns 409 (conflict) → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "void_invoice", failStatus: 409 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-invoice returns 500 → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_invoice", failStatus: 500 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-invoice returns 403 (forbidden) → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_invoice", failStatus: 403 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-source-doc returns 500 → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_source_doc", failStatus: 500 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-source-doc returns 422 (unprocessable) → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_source_doc", failStatus: 422 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-orphan returns 500 → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_orphan", failStatus: 500 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-orphan returns 400 (bad request) → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_orphan", failStatus: 400 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-export returns 500 → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_export", failStatus: 500 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-export returns 501 (not implemented) → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_export", failStatus: 501 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-vendor returns 500 → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_vendor", failStatus: 500 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-vendor returns 409 (FK constraint) → failed === 1", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_vendor", failStatus: 409 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

// ── Thrown errors (network / timeout simulation) ──────────────────────────────

test("void-invoice throws → failed === 1 (catch branch)", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "void_invoice", shouldThrow: true }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-invoice throws → failed === 1 (catch branch)", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_invoice", shouldThrow: true }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-source-doc throws → failed === 1 (catch branch)", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_source_doc", shouldThrow: true }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-orphan throws → failed === 1 (catch branch)", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_orphan", shouldThrow: true }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-export throws → failed === 1 (catch branch)", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_export", shouldThrow: true }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

test("delete-vendor throws → failed === 1 (catch branch)", async () => {
  const { failed } = await runCleanup({
    api: makeMockApi({ failStep: "delete_vendor", shouldThrow: true }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
});

// ── Multiple thrown errors — loop continues after first throw ─────────────────

test("void-invoice throws AND delete-vendor throws → failed === 2, failures.length === 2", async () => {
  // Custom mock that throws on two distinct steps.
  const throwSteps = new Set(["void_invoice", "delete_vendor"]);
  async function twoThrowApi(method, urlPath) {
    let step = "other";
    if (method === "POST"   && /\/invoices\/\d+\/void/.test(urlPath))       step = "void_invoice";
    else if (method === "DELETE" && /\/invoices\/\d+/.test(urlPath))         step = "delete_invoice";
    else if (method === "DELETE" && /\/source-documents\/\d+/.test(urlPath)) step = "delete_source_doc";
    else if (method === "DELETE" && /\/storage\/objects\//.test(urlPath))    step = "delete_orphan";
    else if (method === "DELETE" && /\/exports\/\d+/.test(urlPath))          step = "delete_export";
    else if (method === "DELETE" && /\/vendors\/\d+/.test(urlPath))          step = "delete_vendor";

    if (throwSteps.has(step)) throw new Error(`Simulated network error on step "${step}"`);
    return { status: 200, ok: true, json: {}, headers: new Headers() };
  }

  const { failed, failures } = await runCleanup({ api: twoThrowApi, ...ONE_OF_EACH });

  assert.equal(failed, 2, `expected failed === 2 but got ${failed}`);
  assert.equal(failures.length, 2, `expected 2 failure messages but got ${failures.length}: ${failures}`);

  // Both thrown-step messages should be present in the failures array.
  assert.ok(
    failures.some((f) => /void invoice 7/.test(f)),
    `expected a "void invoice 7" failure message; got: ${failures}`,
  );
  assert.ok(
    failures.some((f) => /delete vendor 42/.test(f)),
    `expected a "delete vendor 42" failure message; got: ${failures}`,
  );
});

// ── A single failing step does not suppress other steps ───────────────────────

test("only void-invoice fails — failures array contains exactly one entry", async () => {
  const { failed, failures } = await runCleanup({
    api: makeMockApi({ failStep: "void_invoice", failStatus: 500 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /void invoice 7/);
});

test("only delete-vendor fails — all other steps run without error", async () => {
  const { failed, failures } = await runCleanup({
    api: makeMockApi({ failStep: "delete_vendor", failStatus: 500 }),
    ...ONE_OF_EACH,
  });
  assert.equal(failed, 1);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /delete vendor 42/);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 2 — subprocess tests (verify exit-code wiring via fixture)
//
// smoke_cleanup_fixture.mjs imports runCleanup from smoke_cleanup.mjs and
// exits with process.exit(failed > 0 ? 1 : 0).  Spawning it here confirms
// that the OS-visible exit code matches the cleanup outcome — a regression
// that detaches failed from the exit call (e.g. a stray `process.exit(0)`)
// would be caught only at this layer.
// ═══════════════════════════════════════════════════════════════════════════════

test("[exit-code] all steps succeed → exit 0", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "none" });
  assert.equal(code, 0, `Expected exit 0 but got ${code}.\n${stderr}`);
});

test("[exit-code] void-invoice returns 500 → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "void_invoice", MOCK_STATUS: "500" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-invoice returns 500 → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_invoice", MOCK_STATUS: "500" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-source-doc returns 500 → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_source_doc", MOCK_STATUS: "500" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-orphan returns 500 → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_orphan", MOCK_STATUS: "500" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-export returns 500 → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_export", MOCK_STATUS: "500" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-vendor returns 500 → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_vendor", MOCK_STATUS: "500" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] void-invoice throws (network error) → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "void_invoice", MOCK_THROW: "1" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-vendor throws (network error) → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_vendor", MOCK_THROW: "1" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-invoice throws (network error) → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_invoice", MOCK_THROW: "1" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-source-doc throws (network error) → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_source_doc", MOCK_THROW: "1" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-orphan throws (network error) → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_orphan", MOCK_THROW: "1" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});

test("[exit-code] delete-export throws (network error) → exit 1", () => {
  const { code, stderr } = runFixture({ MOCK_STEP: "delete_export", MOCK_THROW: "1" });
  assert.equal(code, 1, `Expected exit 1 but got ${code}.\n${stderr}`);
});
