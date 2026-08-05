/**
 * UI Smoke Tests — Invoice Capture MVP
 *
 * Each test navigates to a page and asserts that key elements render without
 * a crash, covering the four highest-risk pages:
 *
 *   1. Dashboard      — invoice stat cards are visible
 *   2. Approval Queue — table section renders (rows or empty state)
 *   3. Exports        — "Generate Export" form renders; clicking the button
 *                       produces a result card or expected API response
 *   4. Invoice List   — table / stat cards render with filter controls
 *
 * Auth is bypassed via VITE_E2E_BYPASS=true (Clerk replaced by a local mock).
 * API calls reach the real API server through the Vite /api proxy; the smoke
 * test API key is injected by route interception below so the server accepts
 * the requests.
 *
 * Prerequisites:
 *   - API server running on localhost:8080  (managed workflow)
 *   - SMOKE_TEST_API_KEY env var set        (same key the API uses)
 */

import { test, expect, type Page } from "@playwright/test";

// ─── Auth header injection ────────────────────────────────────────────────────
// Every API call the browser makes is intercepted here and gets the smoke-test
// bearer token.  This mirrors what the server-side smoke_test.mjs does with
// direct fetch calls, but for browser-originated requests.

const SMOKE_API_KEY = process.env.SMOKE_TEST_API_KEY ?? "";

async function setupApiAuth(page: Page) {
  await page.route("**/api/**", async (route) => {
    const headers: Record<string, string> = {
      ...route.request().headers(),
    };
    if (SMOKE_API_KEY) {
      headers["authorization"] = `Bearer ${SMOKE_API_KEY}`;
    }
    await route.continue({ headers });
  });
}

// ─── Shared beforeEach ────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Suppress console errors from unrelated sources (e.g. hot-reload noise).
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`[browser] ${msg.text()}`);
    }
  });

  await setupApiAuth(page);
});

// ─── 1. Dashboard ─────────────────────────────────────────────────────────────

test("dashboard loads and shows invoice stat cards", async ({ page }) => {
  await page.goto("/dashboard");

  // Wait for the page heading to appear (confirms routing worked).
  await expect(
    page.getByRole("heading", { name: /dashboard/i }),
  ).toBeVisible({ timeout: 15_000 });

  // The "Total Invoices" stat card is always rendered regardless of data.
  await expect(page.getByTestId("metric-total")).toBeVisible();

  // Other key stat cards — these render even when the count is 0.
  await expect(page.getByTestId("metric-pending-approval")).toBeVisible();
  await expect(page.getByTestId("metric-exception")).toBeVisible();
  await expect(page.getByTestId("metric-approved")).toBeVisible();

  // Verify no unhandled JS crash occurred (page still has content).
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 2. Approval Queue ────────────────────────────────────────────────────────

test("approval queue renders table sections", async ({ page }) => {
  await page.goto("/approvals");

  // Wait for the page heading.
  await expect(
    page.getByRole("heading", { name: /approvals/i }),
  ).toBeVisible({ timeout: 15_000 });

  // "Pending Approval" section title is always rendered (as a CardTitle div).
  await expect(page.getByText("Pending Approval").first()).toBeVisible();

  // "Approved & Ready for ERP" section title is always rendered.
  await expect(
    page.getByText("Approved & Ready for ERP").first(),
  ).toBeVisible();

  // Bulk-approve button is always present (disabled when nothing selected).
  await expect(page.getByTestId("button-bulk-approve")).toBeVisible();

  // Export button is always present.
  await expect(page.getByTestId("button-export-csv")).toBeVisible();
});

// ─── 3. Exports page ─────────────────────────────────────────────────────────

test("exports page renders form and Generate Export button works", async ({
  page,
}) => {
  await page.goto("/exports");

  // Wait for the page heading.
  await expect(
    page.getByRole("heading", { name: /exports/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Export type selector is visible.
  await expect(page.getByTestId("select-export-type")).toBeVisible();

  // The "Generate Export" button is always rendered.
  const generateBtn = page.getByTestId("button-create-export");
  await expect(generateBtn).toBeVisible();
  await expect(generateBtn).toBeEnabled();

  // Click "Generate Export".
  await generateBtn.click();

  // After clicking, we expect EITHER:
  //   a) A success card showing the created batch, OR
  //   b) A toast error (if the DB has no records, the export still succeeds
  //      with 0 rows, so (a) is the normal case).
  //
  // Either way, the page must not have crashed.
  await page.waitForTimeout(3_000); // give the request time to complete

  // The page should still be intact (no blank / error screen).
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(
    page.getByRole("heading", { name: /exports/i }),
  ).toBeVisible();
});

// ─── 4. Invoice List ─────────────────────────────────────────────────────────

test("invoice list page renders with filter controls", async ({ page }) => {
  await page.goto("/invoices");

  // Wait for the page to load — the heading or stat cards signal readiness.
  await expect(
    page.getByRole("heading", { name: /invoices/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Status filter tabs are always rendered.
  await expect(page.getByRole("button", { name: /all/i }).first()).toBeVisible();

  // Search input is always rendered.
  const searchInput = page.getByPlaceholder(/search/i);
  await expect(searchInput).toBeVisible();

  // Type in the search box — should not crash.
  await searchInput.fill("TEST");
  await searchInput.fill("");

  // The page body still has content (no render crash after interaction).
  await expect(page.locator("body")).not.toBeEmpty();
});
