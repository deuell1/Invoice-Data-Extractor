// ─────────────────────────────────────────────────────────────────────────────
// preflight-check.test.mjs
//
// Unit tests for checkBaselineCorrections() and BASELINE_PREFLIGHT.
//
// Design
// ──────
// The preflight fires when test-pack invoices (those originating from PACK_FILE)
// contain DB-patched values — values that appear only after a manual correction
// script is applied, not from natural extraction.  Running against a patched
// database produces a misleading accuracy figure.
//
// Baseline ("clean") actuals = the five invoices as natural extraction returns
// them, including originalFileName=PACK_FILE so the pack-scoping filter works.
// These must NOT trigger any violation; the preflight must stay silent for a
// legitimate run.
//
// Each violation test introduces exactly one patched value into the clean set
// (keeping originalFileName=PACK_FILE) and asserts the corresponding entry fires.
//
// The non-pack scoping test uses an invoice with the same patched values but
// a different originalFileName; the preflight must NOT fire.
//
// Run with:
//   node --test uat/extraction-accuracy/preflight-check.test.mjs
// or via the workspace test suite:
//   pnpm --filter @workspace/tests test
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { BASELINE_PREFLIGHT, checkBaselineCorrections, PACK_FILE } from "./preflight.mjs";

// ─── Unpatched baseline actuals (legitimate control-run state) ────────────────
// These represent the five test-pack invoices exactly as the extraction pipeline
// naturally produces them.  originalFileName is set to PACK_FILE so the pack-
// scoping filter inside checkBaselineCorrections() can match them.
// checkBaselineCorrections() must return [] against this set.

const CLEAN_ACTUALS = [
  // TP-001 — AutomationDirect: extractor returns the URL-domain form
  {
    invoiceNumber: "19237741",
    vendorRawName: "AutomationDirect.com, Inc.",
    originalFileName: PACK_FILE,
    taxAmount: 0,
    freightAmount: 0,
  },
  // TP-002 — BzRhino: leading-zero invoice number; tax and freight are null
  {
    invoiceNumber: "00215",
    vendorRawName: "BzRhino Consulting, LLC",
    originalFileName: PACK_FILE,
    taxAmount: null,
    freightAmount: null,
  },
  // TP-003 — Van Meter: taxAmount is null from natural extraction
  {
    invoiceNumber: "S014432461.002",
    vendorRawName: "Van Meter, Inc.",
    originalFileName: PACK_FILE,
    taxAmount: null,
    freightAmount: 0,
  },
  // TP-004 — Rice Lake: taxAmount is null from natural extraction
  {
    invoiceNumber: "5438211",
    vendorRawName: "Rice Lake Weighing Systems",
    originalFileName: PACK_FILE,
    taxAmount: null,
    freightAmount: 142.03,
  },
  // TP-005 — BDI: extractor returns the branch-location form
  {
    invoiceNumber: "9504895965",
    vendorRawName: "BDI - Princeton",
    originalFileName: PACK_FILE,
    taxAmount: 0,
    freightAmount: 339.12,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return a copy of CLEAN_ACTUALS with one invoice patched. */
function withPatch(matchFn, patch) {
  return CLEAN_ACTUALS.map((a) => (matchFn(a) ? { ...a, ...patch } : a));
}

// ─── Structural checks ────────────────────────────────────────────────────────

describe("BASELINE_PREFLIGHT structure", () => {
  test("has exactly 7 entries", () => {
    assert.equal(BASELINE_PREFLIGHT.length, 7);
  });

  test("every entry has a non-empty id, description, and a check function", () => {
    for (const pf of BASELINE_PREFLIGHT) {
      assert.ok(typeof pf.id === "string" && pf.id.length > 0, `Entry missing id: ${JSON.stringify(pf)}`);
      assert.ok(
        typeof pf.description === "string" && pf.description.length > 0,
        `Entry ${pf.id} missing description`,
      );
      assert.equal(typeof pf.check, "function", `Entry ${pf.id} missing check function`);
    }
  });

  test("all entry ids are unique", () => {
    const ids = BASELINE_PREFLIGHT.map((pf) => pf.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, `Duplicate ids found: ${ids}`);
  });
});

// ─── Clean-actuals baseline ───────────────────────────────────────────────────
// Preflight must stay silent for a legitimate (unpatched) database.

describe("checkBaselineCorrections — unpatched (legitimate) actuals", () => {
  test("returns no violations when actuals reflect natural extraction output", () => {
    const violations = checkBaselineCorrections(CLEAN_ACTUALS);
    assert.deepEqual(
      violations,
      [],
      `Expected no violations against clean actuals but got:\n${violations.join("\n")}`,
    );
  });

  test("returns no violations for an empty actuals list", () => {
    const violations = checkBaselineCorrections([]);
    assert.deepEqual(violations, []);
  });
});

// ─── Pack-scoping guard ───────────────────────────────────────────────────────
// Even when all patched values are present, the preflight must NOT fire if the
// invoices belong to a different source file (not PACK_FILE).

describe("checkBaselineCorrections — pack-scoping (non-pack invoices are ignored)", () => {
  test("does not fire when patched values appear on a non-pack originalFileName", () => {
    const allPatchedNonPack = [
      { invoiceNumber: "19237741",    vendorRawName: "Automation Direct",         originalFileName: "other.pdf", taxAmount: 0,    freightAmount: 0 },
      { invoiceNumber: "215",         vendorRawName: "BzRhino Consulting, LLC",   originalFileName: "other.pdf", taxAmount: 0,    freightAmount: 0 },
      { invoiceNumber: "S014432461.002", vendorRawName: "Van Meter, Inc.",        originalFileName: "other.pdf", taxAmount: 0,    freightAmount: 0 },
      { invoiceNumber: "5438211",     vendorRawName: "Rice Lake Weighing Systems",originalFileName: "other.pdf", taxAmount: 0,    freightAmount: 142.03 },
      { invoiceNumber: "9504895965",  vendorRawName: "BDI",                       originalFileName: "other.pdf", taxAmount: 0,    freightAmount: 339.12 },
    ];
    const violations = checkBaselineCorrections(allPatchedNonPack);
    assert.deepEqual(
      violations,
      [],
      `Expected no violations for non-pack invoices but got:\n${violations.join("\n")}`,
    );
  });
});

// ─── Per-entry violation tests ────────────────────────────────────────────────
// Each test introduces exactly one DB-patched value into CLEAN_ACTUALS (while
// keeping originalFileName=PACK_FILE) and confirms the entry fires.

describe("PF-01 — TP-001 vendorRawName patched to trade name", () => {
  test("fires when invoice 19237741 has the patched vendorRawName 'Automation Direct'", () => {
    const actuals = withPatch(
      (a) => a.invoiceNumber === "19237741",
      { vendorRawName: "Automation Direct" },
    );
    const violations = checkBaselineCorrections(actuals);
    assert.ok(
      violations.some((v) => v.includes("PF-01")),
      `Expected PF-01 violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("does not fire when vendorRawName is the natural 'AutomationDirect.com, Inc.'", () => {
    const violations = checkBaselineCorrections(CLEAN_ACTUALS);
    assert.ok(
      !violations.some((v) => v.includes("PF-01")),
      `Unexpected PF-01 violation against clean actuals: ${JSON.stringify(violations)}`,
    );
  });
});

describe("PF-02 — TP-002 invoiceNumber patched to strip leading zeros", () => {
  test("fires when BzRhino has the patched invoiceNumber '215'", () => {
    const actuals = withPatch(
      (a) => /bzrhino/i.test(a.vendorRawName),
      { invoiceNumber: "215" },
    );
    const violations = checkBaselineCorrections(actuals);
    assert.ok(
      violations.some((v) => v.includes("PF-02")),
      `Expected PF-02 violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("does not fire when BzRhino invoiceNumber is the natural '00215'", () => {
    const violations = checkBaselineCorrections(CLEAN_ACTUALS);
    assert.ok(
      !violations.some((v) => v.includes("PF-02")),
      `Unexpected PF-02 violation against clean actuals: ${JSON.stringify(violations)}`,
    );
  });
});

describe("PF-03 — TP-002 BzRhino taxAmount patched from null to 0", () => {
  test("fires when BzRhino (pack file) has patched taxAmount of 0", () => {
    const actuals = withPatch(
      (a) => /bzrhino/i.test(a.vendorRawName),
      { taxAmount: 0 },
    );
    const violations = checkBaselineCorrections(actuals);
    assert.ok(
      violations.some((v) => v.includes("PF-03")),
      `Expected PF-03 violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("does not fire when BzRhino (pack file) taxAmount is the natural null", () => {
    const violations = checkBaselineCorrections(CLEAN_ACTUALS);
    assert.ok(
      !violations.some((v) => v.includes("PF-03")),
      `Unexpected PF-03 violation against clean actuals: ${JSON.stringify(violations)}`,
    );
  });
});

describe("PF-04 — TP-002 BzRhino freightAmount patched from null to 0", () => {
  test("fires when BzRhino (pack file) has patched freightAmount of 0", () => {
    const actuals = withPatch(
      (a) => /bzrhino/i.test(a.vendorRawName),
      { freightAmount: 0 },
    );
    const violations = checkBaselineCorrections(actuals);
    assert.ok(
      violations.some((v) => v.includes("PF-04")),
      `Expected PF-04 violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("does not fire when BzRhino (pack file) freightAmount is the natural null", () => {
    const violations = checkBaselineCorrections(CLEAN_ACTUALS);
    assert.ok(
      !violations.some((v) => v.includes("PF-04")),
      `Unexpected PF-04 violation against clean actuals: ${JSON.stringify(violations)}`,
    );
  });
});

describe("PF-05 — TP-003 Van Meter taxAmount patched from null to 0", () => {
  test("fires when Van Meter (pack file) has patched taxAmount of 0", () => {
    const actuals = withPatch(
      (a) => /van meter/i.test(a.vendorRawName),
      { taxAmount: 0 },
    );
    const violations = checkBaselineCorrections(actuals);
    assert.ok(
      violations.some((v) => v.includes("PF-05")),
      `Expected PF-05 violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("does not fire when Van Meter (pack file) taxAmount is the natural null", () => {
    const violations = checkBaselineCorrections(CLEAN_ACTUALS);
    assert.ok(
      !violations.some((v) => v.includes("PF-05")),
      `Unexpected PF-05 violation against clean actuals: ${JSON.stringify(violations)}`,
    );
  });
});

describe("PF-06 — TP-004 Rice Lake taxAmount patched from null to 0", () => {
  test("fires when Rice Lake (pack file) has patched taxAmount of 0", () => {
    const actuals = withPatch(
      (a) => /rice lake/i.test(a.vendorRawName),
      { taxAmount: 0 },
    );
    const violations = checkBaselineCorrections(actuals);
    assert.ok(
      violations.some((v) => v.includes("PF-06")),
      `Expected PF-06 violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("does not fire when Rice Lake (pack file) taxAmount is the natural null", () => {
    const violations = checkBaselineCorrections(CLEAN_ACTUALS);
    assert.ok(
      !violations.some((v) => v.includes("PF-06")),
      `Unexpected PF-06 violation against clean actuals: ${JSON.stringify(violations)}`,
    );
  });
});

describe("PF-07 — TP-005 BDI vendorRawName patched to short form", () => {
  test("fires when BDI invoice 9504895965 (pack file) has the patched vendorRawName 'BDI'", () => {
    const actuals = withPatch(
      (a) => a.invoiceNumber === "9504895965",
      { vendorRawName: "BDI" },
    );
    const violations = checkBaselineCorrections(actuals);
    assert.ok(
      violations.some((v) => v.includes("PF-07")),
      `Expected PF-07 violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("does not fire when BDI (pack file) vendorRawName is the natural 'BDI - Princeton'", () => {
    const violations = checkBaselineCorrections(CLEAN_ACTUALS);
    assert.ok(
      !violations.some((v) => v.includes("PF-07")),
      `Unexpected PF-07 violation against clean actuals: ${JSON.stringify(violations)}`,
    );
  });
});

// ─── Multi-violation test ─────────────────────────────────────────────────────

describe("checkBaselineCorrections — all seven patches applied simultaneously", () => {
  test("reports all 7 violated entries when every DB patch is present", () => {
    const allPatched = [
      { invoiceNumber: "19237741",      vendorRawName: "Automation Direct",          originalFileName: PACK_FILE, taxAmount: 0,    freightAmount: 0 },
      { invoiceNumber: "215",           vendorRawName: "BzRhino Consulting, LLC",    originalFileName: PACK_FILE, taxAmount: 0,    freightAmount: 0 },
      { invoiceNumber: "S014432461.002",vendorRawName: "Van Meter, Inc.",            originalFileName: PACK_FILE, taxAmount: 0,    freightAmount: 0 },
      { invoiceNumber: "5438211",       vendorRawName: "Rice Lake Weighing Systems", originalFileName: PACK_FILE, taxAmount: 0,    freightAmount: 142.03 },
      { invoiceNumber: "9504895965",    vendorRawName: "BDI",                        originalFileName: PACK_FILE, taxAmount: 0,    freightAmount: 339.12 },
    ];
    const violations = checkBaselineCorrections(allPatched);
    assert.equal(
      violations.length,
      7,
      `Expected 7 violations; got ${violations.length}:\n${violations.join("\n")}`,
    );
    for (const pf of BASELINE_PREFLIGHT) {
      assert.ok(
        violations.some((v) => v.includes(pf.id)),
        `Missing violation for ${pf.id}`,
      );
    }
  });
});
