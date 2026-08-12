// ─────────────────────────────────────────────────────────────────────────────
// Baseline-corrections preflight module
//
// The accuracy scorer must never produce a misleading result because someone
// manually patched the database rows that back the five test-pack invoices.
// This module encodes the three field values that indicate such a patch has
// been applied — values that appear in the database ONLY when the DB has been
// manually corrected, never as a result of natural extraction.
//
// Checks are scoped to PACK_FILE so that production records from the same
// vendors or with similar amounts cannot trigger a false-positive that blocks
// a legitimate run.
//
// If any of these "patched" values are detected in the fetched actuals the
// harness exits before scoring, because the resulting figure would not reflect
// the true behaviour of the extraction pipeline.
//
// checkBaselineCorrections() scans the fetched actuals array and returns a
// list of violation strings — one per failing check.  An empty return means
// the test-pack rows have not been patched and the run is safe to score.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The source PDF shared by every invoice in the designated accuracy test pack.
 * Preflight checks are scoped to this file so that production records with the
 * same vendors or amount values cannot trigger false positives.
 */
export const PACK_FILE = "invoice_Ingestor_5_invoice_test_1786035375284.pdf";

// Normalised form used for file-name matching (lower-case, non-alphanumeric → space)
const _norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const PACK_FILE_NORM = _norm(PACK_FILE);

/**
 * Each entry describes one known-patched DB value that cannot arise from
 * natural extraction and would produce a misleading accuracy figure.
 *
 * check(packActuals) receives only invoices already filtered to PACK_FILE, so
 * individual predicates do not need to re-filter by source file.
 *
 * @property {string} id          Short identifier shown in violation messages.
 * @property {string} description Human-readable description of the violation.
 * @property {(packActuals: object[]) => boolean} check
 *   Returns true when the patched value is detected in the pack-scoped actuals.
 */
export const BASELINE_PREFLIGHT = [
  {
    id: "PF-01",
    description:
      'TP-001 vendorRawName is the DB-patched trade name "Automation Direct"; ' +
      'natural extraction produces "AutomationDirect.com, Inc." — the score will be wrong if this patch is present',
    check: (packActuals) =>
      packActuals.some(
        (a) =>
          String(a.invoiceNumber ?? "").trim() === "19237741" &&
          /^automation\s+direct$/i.test(String(a.vendorRawName ?? "").trim()),
      ),
  },
  {
    id: "PF-02",
    description:
      'TP-002 invoiceNumber is the DB-patched "215" (leading zeros stripped); ' +
      'natural extraction produces "00215"',
    check: (packActuals) =>
      packActuals.some(
        (a) =>
          /bzrhino/i.test(String(a.vendorRawName ?? "")) &&
          String(a.invoiceNumber ?? "").trim() === "215",
      ),
  },
  {
    id: "PF-07",
    description:
      'TP-005 vendorRawName is the DB-patched short form "BDI"; ' +
      'natural extraction produces "BDI - Princeton"',
    check: (packActuals) =>
      packActuals.some(
        (a) =>
          String(a.invoiceNumber ?? "").trim() === "9504895965" &&
          /^bdi$/i.test(String(a.vendorRawName ?? "").trim()),
      ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE CHECKLIST — read this before applying a new round of DB
// corrections to the test-pack invoices.
//
// Every corrections file added to this directory (matching the naming pattern
// apply-*-corrections.{sql,mjs}) MUST be accompanied by:
//
//   1. New BASELINE_PREFLIGHT entries — one per patched DB value that would
//      produce a misleading accuracy figure.  Follow the pattern of the existing
//      entries: scope by PACK_FILE, include the patched value and the natural
//      extraction value in the description, and return true only when the patched
//      value is detected.
//
//   2. A corresponding entry in CORRECTIONS_REGISTRY (just below) — keyed by
//      the basename of the corrections file (e.g. "apply-task56-corrections.sql")
//      and mapping to the array of BASELINE_PREFLIGHT ids that cover its patches
//      (e.g. ["PF-01", "PF-02", ...]).
//
// The test suite (preflight-check.test.mjs) enforces this contract by checking:
//   • every corrections file on disk is a key in CORRECTIONS_REGISTRY
//   • every CORRECTIONS_REGISTRY key maps to at least one valid BASELINE_PREFLIGHT id
//   • every listed preflight id actually exists in BASELINE_PREFLIGHT
//   • no stale entries (keys whose files no longer exist on disk)
//
// The tests will FAIL until all three steps are complete for each corrections
// file: the file on disk, an entry in CORRECTIONS_REGISTRY, and the preflight
// entries for every listed id.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps each corrections file basename to the BASELINE_PREFLIGHT ids that guard
 * against its DB-patched values.
 *
 * When you add apply-*-corrections.{sql,mjs} to this directory:
 *   1. Add its basename as a key here.
 *   2. List every BASELINE_PREFLIGHT id that covers a value it patches.
 *   3. Add the corresponding BASELINE_PREFLIGHT entries (if new ids are needed).
 *
 * The preflight-check.test.mjs suite enforces all three constraints
 * automatically on every test run.
 *
 * @type {Record<string, string[]>}
 */
export const CORRECTIONS_REGISTRY = {
  // Example (uncomment and complete when a corrections file is added):
  // "apply-task56-corrections.sql": ["PF-01", "PF-02", "PF-03", "PF-04", "PF-05", "PF-06", "PF-07"],
};

/**
 * Validate the coverage contract between CORRECTIONS_REGISTRY, BASELINE_PREFLIGHT,
 * and the corrections files that physically exist on disk.
 *
 * This is a pure function — it takes all three inputs — so it can be called both
 * from the live test suite (with real FS data) and from unit tests with
 * fabricated inputs.
 *
 * Returns an array of human-readable violation strings; an empty array means
 * the contract is fully satisfied.
 *
 * @param {Record<string, string[]>} registry     CORRECTIONS_REGISTRY value.
 * @param {object[]}                 preflight    BASELINE_PREFLIGHT array.
 * @param {string[]}                 filesOnDisk  Basenames of corrections files
 *                                                found in the directory.
 * @returns {string[]}
 */
export function validateCorrectionsCoverage(registry, preflight, filesOnDisk) {
  const violations = [];
  const knownIds = new Set(preflight.map((p) => p.id));

  // 1. Every corrections file on disk must be a key in the registry.
  for (const file of filesOnDisk) {
    if (!Object.prototype.hasOwnProperty.call(registry, file)) {
      violations.push(
        `UNREGISTERED: "${file}" is present on disk but has no entry in ` +
          `CORRECTIONS_REGISTRY — add the key and list the BASELINE_PREFLIGHT ids it requires`,
      );
    }
  }

  for (const [file, ids] of Object.entries(registry)) {
    // 2. Every key in the registry must correspond to a file on disk.
    if (!filesOnDisk.includes(file)) {
      violations.push(
        `STALE: CORRECTIONS_REGISTRY lists "${file}" but that file does not exist on disk — ` +
          `remove the stale entry`,
      );
    }

    // 3. Every registered entry must map to at least one preflight id.
    if (!Array.isArray(ids) || ids.length === 0) {
      violations.push(
        `EMPTY_COVERAGE: "${file}" is registered but lists no BASELINE_PREFLIGHT ids — ` +
          `add the ids for every DB value patched by this corrections file`,
      );
    } else {
      // 4. Every listed id must actually exist in BASELINE_PREFLIGHT.
      for (const id of ids) {
        if (!knownIds.has(id)) {
          violations.push(
            `UNKNOWN_ID: "${file}" references preflight id "${id}" which does not exist in ` +
              `BASELINE_PREFLIGHT — add the entry or correct the id`,
          );
        }
      }
    }
  }

  return violations;
}

/**
 * Inspect fetched actuals for known DB-patched values that would produce a
 * misleading accuracy figure.
 *
 * Only invoices originating from PACK_FILE are inspected; production records
 * with similar vendor names or zero amounts are not examined.
 *
 * @param {object[]} actuals  All extracted invoice objects returned by the API.
 * @returns {string[]}  Violation description strings; empty means all clear.
 */
export function checkBaselineCorrections(actuals) {
  // Scope to the designated test-pack source file only.
  const packActuals = actuals.filter(
    (a) => _norm(a.originalFileName ?? "") === PACK_FILE_NORM,
  );

  const violations = [];
  for (const pf of BASELINE_PREFLIGHT) {
    if (pf.check(packActuals)) {
      violations.push(`[${pf.id}] ${pf.description}`);
    }
  }
  return violations;
}
