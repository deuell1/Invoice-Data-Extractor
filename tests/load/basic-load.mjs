/**
 * Basic load test — read-only endpoints only.
 *
 * Targets four side-effect-free endpoints sequentially (not concurrently) so
 * results are not confounded by endpoints competing for pool connections.
 * Each endpoint is run at modest concurrency (10 connections, 30 s) to
 * establish a latency baseline for future comparison.
 *
 * DO NOT add POST /invoices/:id/extract or POST /source-documents here —
 * those trigger real Anthropic API calls and cost money per request.
 *
 * Usage:
 *   SMOKE_TEST_API_KEY=<key> node load/basic-load.mjs
 *   API_BASE_URL=http://localhost:8080/api  (default)
 */

import autocannon from "autocannon";

// ── Auth ──────────────────────────────────────────────────────────────────────
const SMOKE_API_KEY = process.env.SMOKE_TEST_API_KEY ?? "";
if (!SMOKE_API_KEY) {
  console.error(
    "\nERROR: SMOKE_TEST_API_KEY is not set.\n" +
    "Set it to the server's smoke-test API key before running the load test.\n" +
    "Running without it would silently record 401s as latency data.\n"
  );
  process.exit(1);
}

const BASE = process.env.API_BASE_URL ?? "http://localhost:8080/api";
const baseUrl = new URL(BASE);
const origin = baseUrl.origin; // e.g. http://localhost:8080
const apiPrefix = baseUrl.pathname.replace(/\/$/, ""); // e.g. /api

// ── Endpoints under test ──────────────────────────────────────────────────────
const ENDPOINTS = [
  { label: "GET /api/invoices",       path: `${apiPrefix}/invoices` },
  { label: "GET /api/invoices/stats", path: `${apiPrefix}/invoices/stats` },
  { label: "GET /api/exceptions",     path: `${apiPrefix}/exceptions` },
  { label: "GET /api/vendors",        path: `${apiPrefix}/vendors` },
];

// ── Load-test config ──────────────────────────────────────────────────────────
const CONNECTIONS = 10;
const DURATION_SECS = 30;

// ── Runner ────────────────────────────────────────────────────────────────────
function runEndpoint({ label, path }) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: origin,
      connections: CONNECTIONS,
      duration: DURATION_SECS,
      requests: [
        {
          method: "GET",
          path,
          headers: {
            Authorization: `Bearer ${SMOKE_API_KEY}`,
          },
        },
      ],
      // Suppress per-request output — we only want the summary.
      silent: true,
    });

    autocannon.track(instance, { renderProgressBar: true });

    instance.on("done", (result) => {
      resolve({ label, result });
    });

    instance.on("error", reject);
  });
}

function fmtLatency(ms) {
  return ms === undefined || ms === null ? "—" : `${ms} ms`;
}

function fmtErrorRate(result) {
  const total = result.requests.total;
  const errors = (result["4xx"] ?? 0) + (result["5xx"] ?? 0) + (result.errors ?? 0);
  if (total === 0) return "100% (no requests sent)";
  const pct = ((errors / total) * 100).toFixed(2);
  return `${errors}/${total} (${pct}%)`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("=".repeat(60));
console.log("Basic load test — read-only endpoints");
console.log(`  Base URL    : ${BASE}`);
console.log(`  Connections : ${CONNECTIONS}`);
console.log(`  Duration    : ${DURATION_SECS}s per endpoint`);
console.log("=".repeat(60));
console.log();

const summary = [];

for (const endpoint of ENDPOINTS) {
  console.log(`▶ ${endpoint.label}`);
  const { label, result } = await runEndpoint(endpoint);
  const lat = result.latency;
  const row = {
    label,
    p50: fmtLatency(lat.p50),
    p99: fmtLatency(lat.p99),
    rps: result.requests.average?.toFixed(1) ?? "—",
    errors: fmtErrorRate(result),
  };
  summary.push(row);
  console.log();
}

// ── Results table ─────────────────────────────────────────────────────────────
const colW = [28, 10, 10, 10, 26];
const header = ["Endpoint", "p50", "p99", "req/s", "errors"];
const sep = colW.map((w) => "-".repeat(w)).join("-+-");

function row(cells) {
  return cells.map((c, i) => String(c).padEnd(colW[i])).join(" | ");
}

console.log("=".repeat(60));
console.log("RESULTS");
console.log("=".repeat(60));
console.log(row(header));
console.log(sep);
for (const r of summary) {
  console.log(row([r.label, r.p50, r.p99, r.rps, r.errors]));
}
console.log();
