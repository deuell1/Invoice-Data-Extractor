#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-corrections-sync.mjs
//
// Verifies that the corrections patch script is in sync with the latest
// accuracy-run report. Run this whenever a new results/*.md is published.
//
// WHAT IT DOES
//   1. Finds the most-recent results/*.md file (or the one you pass via --report).
//   2. Parses the "Corrections applied in this run" table.
//   3. Parses apply-task36-corrections.sql to build the set of (case, field)
//      pairs it covers (from the `-- TP-NNN · field:` comment markers).
//   4. Reports any correction rows that appear in the report but are NOT
//      represented in the SQL, and any SQL entries that no longer appear in any
//      known report (informational only — not an error).
//
// USAGE
//   node uat/extraction-accuracy/check-corrections-sync.mjs [--report <path>]
//
//   --report <path>   Use this results file instead of the latest one.
//   --sql    <path>   Use this SQL file instead of apply-task36-corrections.sql.
//   --quiet           Suppress informational output; only print on divergence.
//
// EXIT CODE
//   0  — all corrections in the report are covered by the SQL patch script
//   1  — one or more corrections are missing from the SQL (patch script is stale)
//   2  — usage / file-not-found error
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CLI args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
let reportPath = null;
let sqlPath = path.resolve(__dirname, "apply-task36-corrections.sql");
let quiet = false;

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--report") {
    reportPath = path.resolve(argv[++i]);
  } else if (argv[i] === "--sql") {
    sqlPath = path.resolve(argv[++i]);
  } else if (argv[i] === "--quiet") {
    quiet = true;
  } else {
    console.error(`Unknown argument: ${argv[i]}`);
    process.exit(2);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function log(...args) {
  if (!quiet) console.log(...args);
}

/** Read a file, exit 2 on failure. */
function readOrDie(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`ERROR: Cannot read ${filePath}: ${err.message}`);
    process.exit(2);
  }
}

// ─── 1. Locate the results file ───────────────────────────────────────────────

if (!reportPath) {
  const resultsDir = path.resolve(__dirname, "results");
  let entries;
  try {
    entries = readdirSync(resultsDir).filter((f) => f.endsWith(".md"));
  } catch (err) {
    console.error(`ERROR: Cannot read results directory ${resultsDir}: ${err.message}`);
    process.exit(2);
  }
  if (entries.length === 0) {
    console.error("ERROR: No result files found in results/.");
    process.exit(2);
  }
  // Lexicographic sort — YYYY-MM-DD prefix means latest = last entry.
  entries.sort();
  reportPath = path.resolve(resultsDir, entries[entries.length - 1]);
}

log(`Checking corrections sync`);
log(`  Report : ${path.relative(process.cwd(), reportPath)}`);
log(`  SQL    : ${path.relative(process.cwd(), sqlPath)}`);
log();

// ─── 2. Parse the "Corrections applied in this run" table ─────────────────────
//
// The table follows the heading that matches /corrections applied/i.
// Columns: Invoice | Field | Old value | New value | Reason
// Rows look like: | TP-001 (ID 83) | vendorRawName | AutomationDirect.com, Inc. | Automation Direct | ... |

const reportText = readOrDie(reportPath);

/**
 * Parse a Markdown pipe-table section.
 * Returns an array of objects keyed by lower-cased, trimmed header names.
 */
function parseMarkdownTable(text, headingPattern) {
  const headingIdx = text.search(headingPattern);
  if (headingIdx === -1) return null;          // section absent

  const afterHeading = text.slice(headingIdx);
  const tableStart = afterHeading.indexOf("|");
  if (tableStart === -1) return null;

  const tableText = afterHeading.slice(tableStart);
  const lines = tableText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));

  if (lines.length < 3) return null; // header + separator + at least 1 data row

  // Parse header
  const headers = lines[0]
    .split("|")
    .slice(1, -1)
    .map((h) => h.trim().toLowerCase());

  const rows = [];
  for (const line of lines.slice(2)) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) break;             // blank line terminates table
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

const correctionRows = parseMarkdownTable(
  reportText,
  /corrections applied/i,
);

if (correctionRows === null) {
  log('No "Corrections applied" table found in the report — nothing to check.');
  log("RESULT: In sync (no corrections required by this run).");
  process.exit(0);
}

if (correctionRows.length === 0) {
  log("Corrections table is empty — no corrections required by this run.");
  log("RESULT: In sync.");
  process.exit(0);
}

log(`Found ${correctionRows.length} correction(s) in the report:`);
for (const row of correctionRows) {
  log(`  ${row["invoice"] ?? row["case"]} · ${row["field"]}  ${row["old value"]} → ${row["new value"]}`);
}
log();

// ─── 3. Parse apply-task36-corrections.sql ────────────────────────────────────
//
// We look for comment markers of the form:
//   -- TP-NNN · fieldName: ...
// These tell us which (case, field) pairs the SQL already covers.

const sqlText = readOrDie(sqlPath);

const SQL_MARKER_RE = /--\s*(TP-\d+)\s*[·•]\s*(\w+)\s*:/g;
/** @type {Map<string, Set<string>>}  case → set of fields */
const sqlCoverage = new Map();

let m;
while ((m = SQL_MARKER_RE.exec(sqlText)) !== null) {
  const caseId = m[1].toUpperCase();           // e.g. "TP-001"
  const field  = m[2];                         // e.g. "vendorRawName"
  if (!sqlCoverage.has(caseId)) sqlCoverage.set(caseId, new Set());
  sqlCoverage.get(caseId).add(field);
}

log("SQL patch script covers:");
for (const [caseId, fields] of [...sqlCoverage.entries()].sort()) {
  log(`  ${caseId}: ${[...fields].join(", ")}`);
}
log();

// ─── 4. Compare ───────────────────────────────────────────────────────────────

/**
 * Normalise an invoice cell like "TP-001 (ID 83)" → "TP-001".
 * Also handles bare "TP-001".
 */
function extractCaseId(invoiceCell) {
  const match = invoiceCell.match(/TP-\d+/i);
  return match ? match[0].toUpperCase() : null;
}

const missing = []; // corrections in report not covered by SQL

for (const row of correctionRows) {
  const invoiceCell = row["invoice"] ?? row["case"] ?? "";
  const field = (row["field"] ?? "").trim();
  const caseId = extractCaseId(invoiceCell);

  if (!caseId) {
    // Cannot parse case — warn but don't fail
    log(`WARNING: Could not extract case ID from invoice cell: "${invoiceCell}"`);
    continue;
  }

  const coveredFields = sqlCoverage.get(caseId);
  if (!coveredFields || !coveredFields.has(field)) {
    missing.push({ caseId, field, row });
  }
}

// ─── 5. Report ────────────────────────────────────────────────────────────────

if (missing.length === 0) {
  console.log("✓  Patch script is in sync — all report corrections are covered.");
  process.exit(0);
}

console.error(
  `\n✗  PATCH SCRIPT OUT OF SYNC — ${missing.length} correction(s) from the report are not in the SQL:\n`,
);
for (const { caseId, field, row } of missing) {
  const old_ = row["old value"] ?? "?";
  const new_ = row["new value"] ?? "?";
  const reason = row["reason"] ?? "";
  console.error(`  ${caseId} · ${field}`);
  console.error(`    Old: ${old_}`);
  console.error(`    New: ${new_}`);
  if (reason) console.error(`    Reason: ${reason}`);
  console.error();
}

console.error("ACTION REQUIRED:");
console.error("  Add a corresponding UPDATE statement to apply-task36-corrections.sql");
console.error("  for each missing correction listed above, then re-run this check.");
console.error();
console.error(
  `  Report: ${path.relative(process.cwd(), reportPath)}`,
);
console.error(
  `  SQL   : ${path.relative(process.cwd(), sqlPath)}`,
);

process.exit(1);
