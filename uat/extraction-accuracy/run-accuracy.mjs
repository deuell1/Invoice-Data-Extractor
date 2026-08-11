#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 UAT — Extraction Accuracy Scorer
//
// Repeatable harness that scores the invoice extraction pipeline against a
// LABELED ground-truth test pack. It reads a CSV of expected values, fetches the
// actually-extracted invoices from the running API, normalizes and compares each
// required field, and prints a field-level accuracy table plus the summary
// metrics required by the Phase 1 exit gate.
//
// USAGE:
//   node uat/extraction-accuracy/run-accuracy.mjs <ground-truth.csv> [threshold] [--out <file.md>]
//
//   <ground-truth.csv>   Labeled expected values (see ground-truth.template.csv).
//   [threshold]          PASS threshold as a percent (default 95).
//   --out <file.md>      Optional: also write the report to this markdown file.
//
// ENV:
//   API_BASE             API base URL (default http://localhost:8080/api).
//
// EXIT CODE: 0 if overall accuracy >= threshold, else 1.
//
// PROCESS (see README.md): upload the labeled pack through the app, fill in the
// ground-truth CSV, then run this scorer.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { checkBaselineCorrections } from "./preflight.mjs";

const API_BASE = process.env.API_BASE || "http://localhost:8080/api";

// ─── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let outFile = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") {
    outFile = argv[++i];
  } else {
    positional.push(argv[i]);
  }
}
const csvPath = positional[0];
const threshold = positional[1] != null ? Number(positional[1]) : 95;

if (!csvPath) {
  console.error("ERROR: ground-truth CSV path required.");
  console.error("Usage: node run-accuracy.mjs <ground-truth.csv> [threshold] [--out <file.md>]");
  process.exit(2);
}

// ─── minimal CSV parser (handles quoted fields with commas/quotes) ───────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

const REQUIRED_ALWAYS = ["vendorRawName", "invoiceNumber", "invoiceDate", "totalAmount", "currency"];

// Validate that each row carries the always-required ground-truth values. A blank
// required expected cell would otherwise be silently skipped and could inflate the
// accuracy into a false PASS, so these are reported and block the verdict.
function validateGroundTruth(rows) {
  const errors = [];
  rows.forEach((gt, idx) => {
    const id = gt.testCaseId || gt.sourceFileName || `row ${idx + 2}`;
    if (empty(gt.sourceFileName)) errors.push(`${id}: missing 'sourceFileName' (needed to match the extracted invoice)`);
    for (const col of REQUIRED_ALWAYS) {
      if (empty(gt[col])) errors.push(`${id}: missing required '${col}'`);
    }
    if (empty(gt.dueDate) && empty(gt.paymentTerms)) {
      errors.push(`${id}: missing required 'dueDate' or 'paymentTerms' (one is required)`);
    }
  });
  return errors;
}

function loadGroundTruth(path) {
  const raw = readFileSync(path, "utf8");
  // strip comment lines beginning with '#'
  const cleaned = raw
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  const rows = parseCsv(cleaned);
  if (rows.length < 2) throw new Error("Ground-truth CSV has no data rows.");
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => (obj[h] = (r[i] ?? "").trim()));
    return obj;
  });
}

// ─── normalization & comparison ──────────────────────────────────────────────
const empty = (v) => v == null || String(v).trim() === "";

function normStr(v) {
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normAmount(v) {
  if (empty(v)) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normDate(v) {
  if (empty(v)) return null;
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/))) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  return s.toLowerCase();
}

// kind: 'string' | 'amount' | 'date' | 'currency'
// Returns 'correct' | 'incorrect' | 'missing'
function compareField(expected, actual, kind) {
  const expEmpty = empty(expected);
  const actEmpty = empty(actual);
  if (expEmpty) return null; // not tested
  if (actEmpty) return "missing";
  let e, a;
  if (kind === "amount") {
    e = normAmount(expected);
    a = normAmount(actual);
    if (e == null || a == null) return "incorrect";
    return Math.abs(e - a) <= 0.01 ? "correct" : "incorrect";
  }
  if (kind === "date") {
    e = normDate(expected);
    a = normDate(actual);
  } else if (kind === "currency") {
    e = String(expected).trim().toUpperCase();
    a = String(actual).trim().toUpperCase();
  } else {
    e = normStr(expected);
    a = normStr(actual);
  }
  return e === a ? "correct" : "incorrect";
}

// ─── fetch actual extracted invoices (paginated — never truncate) ─────────────
async function fetchActuals() {
  const all = [];
  const limit = 200;
  for (let page = 1; ; page++) {
    const res = await fetch(`${API_BASE}/invoices?limit=${limit}&page=${page}`);
    if (!res.ok) throw new Error(`GET /invoices failed: ${res.status}`);
    const body = await res.json();
    const list = Array.isArray(body) ? body : body.data ?? [];
    all.push(...list);
    const total = Array.isArray(body) ? all.length : body.total ?? all.length;
    // Stop on a non-paged response, an empty page, or once we've collected all.
    if (Array.isArray(body) || list.length === 0 || all.length >= total) break;
  }
  return all;
}

function matchActual(actuals, gt) {
  const wantFile = normStr(gt.sourceFileName || "");
  const wantNum = normStr(gt.invoiceNumber || "");
  const byFile = actuals.filter((a) => normStr(a.originalFileName || "") === wantFile);
  if (byFile.length === 0) return null;
  // When the ground truth specifies an invoice number, require it to match — this
  // both disambiguates multi-invoice PDFs and prevents binding to the wrong
  // invoice when a file name is reused across runs.
  if (wantNum) {
    return byFile.find((a) => normStr(a.invoiceNumber || "") === wantNum) ?? null;
  }
  return byFile.length === 1 ? byFile[0] : null;
}

// ─── field map: gt column -> { actual key, kind, category, conditional } ──────
const FIELDS = [
  { col: "vendorRawName", key: "vendorRawName", kind: "string", cat: "vendor" },
  { col: "invoiceNumber", key: "invoiceNumber", kind: "string", cat: "invoiceNumber" },
  { col: "invoiceDate", key: "invoiceDate", kind: "date", cat: "date" },
  { col: "poNumber", key: "poNumber", kind: "string", cat: "po", conditional: true },
  { col: "subtotal", key: "subtotal", kind: "amount", cat: "amount", conditional: true },
  { col: "taxAmount", key: "taxAmount", kind: "amount", cat: "amount", conditional: true },
  { col: "freightAmount", key: "freightAmount", kind: "amount", cat: "amount", conditional: true },
  { col: "totalAmount", key: "totalAmount", kind: "amount", cat: "amount" },
  { col: "currency", key: "currency", kind: "currency", cat: "currency" },
];

// ─── scoring ─────────────────────────────────────────────────────────────────
function scoreCase(gt, actual) {
  const results = [];
  for (const f of FIELDS) {
    const verdict = compareField(gt[f.col], actual?.[f.key], f.kind);
    if (verdict == null) continue; // not tested
    results.push({ field: f.col, cat: f.cat, expected: gt[f.col], actual: actual?.[f.key] ?? "", verdict });
  }
  // dueDate OR paymentTerms — scored as one combined "date" field
  const expDue = gt.dueDate;
  const expTerms = gt.paymentTerms;
  if (!empty(expDue) || !empty(expTerms)) {
    let verdict;
    if (!empty(expDue)) {
      verdict = compareField(expDue, actual?.dueDate, "date");
    } else {
      verdict = compareField(expTerms, actual?.paymentTerms, "string");
    }
    results.push({
      field: "dueDateOrTerms",
      cat: "date",
      expected: !empty(expDue) ? expDue : expTerms,
      actual: !empty(expDue) ? actual?.dueDate ?? "" : actual?.paymentTerms ?? "",
      verdict: verdict ?? "missing",
    });
  }
  return results;
}

// ─── main ────────────────────────────────────────────────────────────────────
let gtRows;
try {
  gtRows = loadGroundTruth(csvPath);
} catch (e) {
  console.error(`ERROR: could not read ground-truth CSV '${csvPath}': ${e.message}`);
  process.exit(2);
}
const gtErrors = validateGroundTruth(gtRows);
let actuals;
try {
  actuals = await fetchActuals();
} catch (e) {
  console.error(`ERROR: could not fetch actual invoices from ${API_BASE}: ${e.message}`);
  process.exit(2);
}

// ─── baseline-corrections preflight ──────────────────────────────────────────
// Abort before scoring if any known pre-correction values are still present in
// the database.  Scoring against uncorrected data produces an inflated result
// that cannot be relied upon as a Phase 1 accuracy measurement.
const preflightViolations = checkBaselineCorrections(actuals);
if (preflightViolations.length > 0) {
  console.error("ERROR: Baseline preflight failed — the database appears to contain manually patched values.");
  console.error("Scoring against patched data produces a misleading accuracy figure.");
  console.error("");
  for (const v of preflightViolations) console.error(`  • ${v}`);
  console.error("");
  console.error("Restore the database to its unpatched state (re-extraction output) before re-running the scorer.");
  process.exit(2);
}

const tableRows = [];
const catTotals = {};
let totalTested = 0;
let totalCorrect = 0;
let totalIncorrect = 0;
let totalMissing = 0;
let unmatched = 0;

for (const gt of gtRows) {
  const actual = matchActual(actuals, gt);
  if (!actual) {
    unmatched++;
    tableRows.push({ caseId: gt.testCaseId || gt.sourceFileName, field: "(no extracted invoice matched)", expected: "", actual: "", verdict: "missing" });
    // count every provided field as missing
    for (const f of FIELDS) if (!empty(gt[f.col])) { totalTested++; totalMissing++; bump(catTotals, f.cat, "tested"); bump(catTotals, f.cat, "missing"); }
    if (!empty(gt.dueDate) || !empty(gt.paymentTerms)) { totalTested++; totalMissing++; bump(catTotals, "date", "tested"); bump(catTotals, "date", "missing"); }
    continue;
  }
  const results = scoreCase(gt, actual);
  for (const r of results) {
    totalTested++;
    bump(catTotals, r.cat, "tested");
    if (r.verdict === "correct") { totalCorrect++; bump(catTotals, r.cat, "correct"); }
    else if (r.verdict === "incorrect") { totalIncorrect++; bump(catTotals, r.cat, "incorrect"); }
    else { totalMissing++; bump(catTotals, r.cat, "missing"); }
    tableRows.push({ caseId: gt.testCaseId || gt.sourceFileName, field: r.field, expected: r.expected, actual: r.actual, verdict: r.verdict });
  }
}

function bump(obj, cat, key) {
  obj[cat] = obj[cat] || { tested: 0, correct: 0, incorrect: 0, missing: 0 };
  obj[cat][key]++;
}

const manualCorrections = totalIncorrect + totalMissing;
const overall = totalTested ? (totalCorrect / totalTested) * 100 : 0;
const catPct = (c) => {
  const t = catTotals[c];
  return t && t.tested ? ((t.correct / t.tested) * 100).toFixed(1) + "%" : "n/a";
};

// ─── render ──────────────────────────────────────────────────────────────────
const pass = totalTested > 0 && overall >= threshold && gtErrors.length === 0;
const lines = [];
lines.push(`# Extraction Accuracy Results`);
lines.push("");
lines.push(`- Date: ${new Date().toISOString().slice(0, 10)}`);
lines.push(`- API: ${API_BASE}`);
lines.push(`- Ground-truth file: \`${csvPath}\``);
lines.push(`- Test cases: ${gtRows.length} (unmatched: ${unmatched})`);
lines.push(`- PASS threshold: ${threshold}%`);
lines.push("");
lines.push(`## Field-Level Detail`);
lines.push("");
lines.push(`| Case | Field | Expected | Actual | Verdict |`);
lines.push(`|---|---|---|---|---|`);
for (const r of tableRows) {
  lines.push(`| ${r.caseId} | ${r.field} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.verdict.toUpperCase()} |`);
}
lines.push("");
lines.push(`## Summary Metrics`);
lines.push("");
lines.push(`| Metric | Value |`);
lines.push(`|---|---|`);
lines.push(`| Total required fields tested | ${totalTested} |`);
lines.push(`| Correct fields | ${totalCorrect} |`);
lines.push(`| Incorrect fields | ${totalIncorrect} |`);
lines.push(`| Missing fields | ${totalMissing} |`);
lines.push(`| Manual corrections required | ${manualCorrections} |`);
lines.push(`| **Overall extraction accuracy** | **${overall.toFixed(1)}%** |`);
lines.push(`| Vendor name accuracy | ${catPct("vendor")} |`);
lines.push(`| Invoice number accuracy | ${catPct("invoiceNumber")} |`);
lines.push(`| Date accuracy | ${catPct("date")} |`);
lines.push(`| Amount accuracy | ${catPct("amount")} |`);
lines.push(`| PO accuracy | ${catPct("po")} |`);
lines.push(`| Currency accuracy | ${catPct("currency")} |`);
lines.push("");
if (gtErrors.length) {
  lines.push(`## Ground-Truth Validation`);
  lines.push("");
  lines.push(`${gtErrors.length} required ground-truth value(s) are missing. Fix these before trusting the result:`);
  lines.push("");
  for (const e of gtErrors) lines.push(`- ${e}`);
  lines.push("");
}
lines.push(`## Verdict`);
lines.push("");
if (gtErrors.length) {
  lines.push(`**BLOCKED — ground-truth incomplete.** Fix the ${gtErrors.length} issue(s) above and re-run; accuracy cannot be certified from an incomplete ground truth.`);
} else if (totalTested === 0) {
  lines.push(`**Not measured — labeled test pack required.** No ground-truth fields were scored.`);
} else {
  lines.push(`**Phase 1 extraction accuracy: ${pass ? "PASS" : "FAIL"}** (${overall.toFixed(1)}% vs ${threshold}% threshold).`);
}

function esc(v) {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const report = lines.join("\n");
console.log(report);
if (outFile) {
  writeFileSync(outFile, report + "\n");
  console.error(`\n(Report written to ${outFile})`);
}

process.exit(pass ? 0 : 1);
