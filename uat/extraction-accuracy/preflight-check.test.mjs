// ─────────────────────────────────────────────────────────────────────────────
// preflight-check.test.mjs
//
// Unit tests for checkBaselineCorrections(), BASELINE_PREFLIGHT,
// CORRECTIONS_REGISTRY, and validateCorrectionsCoverage().
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
// The CORRECTIONS_REGISTRY coverage suite uses validateCorrectionsCoverage()
// both with real filesystem data and with fabricated inputs (negative tests)
// to prove the data-contract enforcement actually works.
//
// Run with:
//   node --test uat/extraction-accuracy/preflight-check.test.mjs
// or via the workspace test suite:
//   pnpm --filter @workspace/tests test
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  BASELINE_PREFLIGHT,
  checkBaselineCorrections,
  CORRECTIONS_REGISTRY,
  PACK_FILE,
  validateCorrectionsCoverage,
} from "./preflight.mjs";

// Absolute path to this directory so we can scan it for corrections files.
const DIR = path.dirname(fileURLToPath(import.meta.url));

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
  // TP-002 — BzRhino: leading-zero invoice number; Claude Haiku naturally extracts 0 for tax/freight
  {
    invoiceNumber: "00215",
    vendorRawName: "BzRhino Consulting, LLC",
    originalFileName: PACK_FILE,
    taxAmount: 0,
    freightAmount: 0,
  },
  // TP-003 — Van Meter: Claude Haiku naturally extracts 0 for taxAmount
  {
    invoiceNumber: "S014432461.002",
    vendorRawName: "Van Meter, Inc.",
    originalFileName: PACK_FILE,
    taxAmount: 0,
    freightAmount: 0,
  },
  // TP-004 — Rice Lake: Claude Haiku naturally extracts 0 for taxAmount
  {
    invoiceNumber: "5438211",
    vendorRawName: "Rice Lake Weighing Systems",
    originalFileName: PACK_FILE,
    taxAmount: 0,
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
  test("has exactly 3 entries", () => {
    assert.equal(BASELINE_PREFLIGHT.length, 3);
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

describe("checkBaselineCorrections — all three patches applied simultaneously", () => {
  test("reports all 3 violated entries when every remaining DB patch is present", () => {
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
      3,
      `Expected 3 violations; got ${violations.length}:\n${violations.join("\n")}`,
    );
    for (const pf of BASELINE_PREFLIGHT) {
      assert.ok(
        violations.some((v) => v.includes(pf.id)),
        `Missing violation for ${pf.id}`,
      );
    }
  });
});

// ─── CORRECTIONS_REGISTRY live coverage ──────────────────────────────────────
// Cross-references the registry against files that actually exist on disk.
// Fails if any apply-*-corrections file on disk is unregistered, or if any
// registered entry names a file that no longer exists or has no valid preflight
// ids.

describe("CORRECTIONS_REGISTRY — live filesystem coverage", () => {
  /** Basenames in this directory that match the corrections naming convention. */
  async function findCorrectionsFiles() {
    const entries = await readdir(DIR);
    return entries.filter((name) => /^apply-.*-corrections\.(sql|mjs)$/i.test(name));
  }

  test("no violations between CORRECTIONS_REGISTRY, BASELINE_PREFLIGHT, and files on disk", async () => {
    const filesOnDisk = await findCorrectionsFiles();
    const violations = validateCorrectionsCoverage(
      CORRECTIONS_REGISTRY,
      BASELINE_PREFLIGHT,
      filesOnDisk,
    );
    assert.deepEqual(
      violations,
      [],
      `CORRECTIONS_REGISTRY coverage violations detected:\n${violations.join("\n")}\n\n` +
        `For every apply-*-corrections file on disk:\n` +
        `  1. Add its basename as a key in CORRECTIONS_REGISTRY in preflight.mjs\n` +
        `  2. List every BASELINE_PREFLIGHT id that guards against its patches\n` +
        `  3. Add the corresponding BASELINE_PREFLIGHT entries if new ids are needed`,
    );
  });
});

// ─── validateCorrectionsCoverage — negative (unit) tests ─────────────────────
// These tests use fabricated inputs — no filesystem access — to prove the
// validation logic catches each failure mode.  A developer who adds a
// corrections file and registers it correctly but lists zero preflight ids, a
// non-existent id, or forgets to register it at all must see a failure here.

describe("validateCorrectionsCoverage — negative scenarios (pure unit tests)", () => {
  /** A minimal but valid preflight array for use in fabricated scenarios. */
  const FAKE_PREFLIGHT = [
    { id: "PF-99", description: "fake entry", check: () => false },
  ];

  test("reports UNREGISTERED when a corrections file on disk has no registry entry", () => {
    const violations = validateCorrectionsCoverage(
      {},                              // empty registry
      FAKE_PREFLIGHT,
      ["apply-new-corrections.sql"],   // file exists on disk
    );
    assert.ok(
      violations.some((v) => v.includes("UNREGISTERED")),
      `Expected UNREGISTERED violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("reports STALE when a registry entry names a file that does not exist on disk", () => {
    const violations = validateCorrectionsCoverage(
      { "apply-old-corrections.sql": ["PF-99"] }, // registered but not on disk
      FAKE_PREFLIGHT,
      [],                                          // nothing on disk
    );
    assert.ok(
      violations.some((v) => v.includes("STALE")),
      `Expected STALE violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("reports EMPTY_COVERAGE when a registered entry maps to an empty id array", () => {
    const violations = validateCorrectionsCoverage(
      { "apply-new-corrections.sql": [] }, // registered with no preflight ids
      FAKE_PREFLIGHT,
      ["apply-new-corrections.sql"],
    );
    assert.ok(
      violations.some((v) => v.includes("EMPTY_COVERAGE")),
      `Expected EMPTY_COVERAGE violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("reports UNKNOWN_ID when a registered entry lists a preflight id that does not exist", () => {
    const violations = validateCorrectionsCoverage(
      { "apply-new-corrections.sql": ["PF-DOES-NOT-EXIST"] },
      FAKE_PREFLIGHT,                          // only PF-99 is real
      ["apply-new-corrections.sql"],
    );
    assert.ok(
      violations.some((v) => v.includes("UNKNOWN_ID")),
      `Expected UNKNOWN_ID violation; got: ${JSON.stringify(violations)}`,
    );
  });

  test("passes when registry is empty and no corrections files exist on disk", () => {
    const violations = validateCorrectionsCoverage({}, FAKE_PREFLIGHT, []);
    assert.deepEqual(violations, [], `Expected no violations; got: ${JSON.stringify(violations)}`);
  });

  test("passes when a corrections file is correctly registered with a valid preflight id", () => {
    const violations = validateCorrectionsCoverage(
      { "apply-new-corrections.sql": ["PF-99"] },
      FAKE_PREFLIGHT,
      ["apply-new-corrections.sql"],
    );
    assert.deepEqual(violations, [], `Expected no violations; got: ${JSON.stringify(violations)}`);
  });
});
