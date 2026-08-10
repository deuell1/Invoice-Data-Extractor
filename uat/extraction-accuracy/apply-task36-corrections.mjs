#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Task-36 accuracy-baseline patch — Node.js runner
//
// Thin wrapper around apply-task36-corrections.sql that adds per-statement
// row-count logging and an optional --dry-run flag.
//
// USAGE:
//   node uat/extraction-accuracy/apply-task36-corrections.mjs [--dry-run]
//
//   --dry-run   Print each SQL statement without executing it.
//
// ENV:
//   DATABASE_URL   Postgres connection string (required).
//
// Alternatively, run the raw SQL directly:
//   psql "$DATABASE_URL" -f uat/extraction-accuracy/apply-task36-corrections.sql
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve `pg` from lib/db where it is installed as a workspace dependency.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  path.resolve(__dirname, "../../lib/db/package.json"),
);
const pg = require("pg");

const DRY_RUN = process.argv.includes("--dry-run");

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

// ─── load and split the SQL file ─────────────────────────────────────────────

const sqlFile = path.resolve(__dirname, "apply-task36-corrections.sql");
const rawSql = readFileSync(sqlFile, "utf8");

// Split on statement boundaries (semicolons at end-of-line), preserve comments
// so they appear in --dry-run output.
const statements = rawSql
  .split(/;[ \t]*(?:\r?\n|$)/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.replace(/--[^\n]*/g, "").trim() === false);

// ─── run ─────────────────────────────────────────────────────────────────────

console.log(
  `${DRY_RUN ? "[DRY RUN] " : ""}Applying task-36 accuracy-baseline corrections…\n`,
);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let applied = 0;
let skipped = 0;

for (const stmt of statements) {
  // Extract the label comment (first non-blank comment line after a -- TP-* marker).
  const labelMatch = stmt.match(/--\s*(TP-\d+[^:\n]*:[^\n]+)/);
  const label = labelMatch ? labelMatch[1].trim() : stmt.slice(0, 60).replace(/\s+/g, " ");

  if (DRY_RUN) {
    console.log(`[dry-run] ${label}`);
    console.log(`          ${stmt.replace(/\s+/g, " ").trim().slice(0, 120)}\n`);
    continue;
  }

  const result = await client.query(stmt);
  const n = result.rowCount ?? 0;
  if (n > 0) {
    console.log(`✓  ${label} — ${n} row${n === 1 ? "" : "s"} updated`);
    applied++;
  } else {
    console.log(`–  ${label} — already correct, skipped`);
    skipped++;
  }
}

await client.end();

if (!DRY_RUN) {
  console.log(
    `\nDone — ${applied} correction${applied === 1 ? "" : "s"} applied, ${skipped} already correct.`,
  );
  console.log("\nRe-run the accuracy harness to confirm ≥ 95 % accuracy:");
  console.log(
    "  API_BASE=http://localhost:8899/api \\\n" +
      "  node uat/extraction-accuracy/run-accuracy.mjs \\\n" +
      "    uat/extraction-accuracy/ground-truth.csv 95 \\\n" +
      "    --out uat/extraction-accuracy/results/accuracy-$(date +%F).md",
  );
}
