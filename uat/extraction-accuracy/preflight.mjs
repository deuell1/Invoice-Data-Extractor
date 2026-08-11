// ─────────────────────────────────────────────────────────────────────────────
// Baseline-corrections preflight module
//
// The accuracy scorer must never produce a misleading result because someone
// manually patched the database rows that back the five test-pack invoices.
// This module encodes the seven field values that indicate such a patch has
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
    id: "PF-03",
    description:
      "TP-002 BzRhino taxAmount is 0 from a DB patch; " +
      "natural extraction returns null — the true accuracy gap is hidden when this patch is present",
    check: (packActuals) =>
      packActuals.some(
        (a) =>
          /bzrhino/i.test(String(a.vendorRawName ?? "")) &&
          a.taxAmount === 0,
      ),
  },
  {
    id: "PF-04",
    description:
      "TP-002 BzRhino freightAmount is 0 from a DB patch; " +
      "natural extraction returns null",
    check: (packActuals) =>
      packActuals.some(
        (a) =>
          /bzrhino/i.test(String(a.vendorRawName ?? "")) &&
          a.freightAmount === 0,
      ),
  },
  {
    id: "PF-05",
    description:
      "TP-003 Van Meter taxAmount is 0 from a DB patch; " +
      "natural extraction returns null",
    check: (packActuals) =>
      packActuals.some(
        (a) =>
          /van meter/i.test(String(a.vendorRawName ?? "")) &&
          a.taxAmount === 0,
      ),
  },
  {
    id: "PF-06",
    description:
      "TP-004 Rice Lake taxAmount is 0 from a DB patch; " +
      "natural extraction returns null",
    check: (packActuals) =>
      packActuals.some(
        (a) =>
          /rice lake/i.test(String(a.vendorRawName ?? "")) &&
          a.taxAmount === 0,
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
