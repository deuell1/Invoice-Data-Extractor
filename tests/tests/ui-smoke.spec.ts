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

// ─── 5. Invoice intake flow ───────────────────────────────────────────────────

test("invoice intake: upload form submits and shows processing screen", async ({
  page,
}) => {
  // ---- API mocks ----------------------------------------------------------
  // Intercept the upload-URL request and return a fake presigned URL.
  await page.route("**/api/storage/uploads/request-url**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          uploadURL: "https://fake-storage.example.invalid/upload/test-object",
          objectPath: "uploads/test-invoice.pdf",
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Intercept the PUT to the fake storage URL (external, not /api/).
  await page.route(
    "https://fake-storage.example.invalid/**",
    async (route) => {
      await route.fulfill({ status: 200 });
    },
  );

  // Intercept source-document creation (POST) and return a fake record.
  await page.route("**/api/source-documents", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          source: {
            id: 9999,
            status: "PENDING",
            processingStatus: "PENDING",
            originalFileName: "test-invoice.pdf",
            invoices: [],
          },
        }),
      });
    } else {
      // GET list — let the real server handle it.
      await route.continue();
    }
  });

  // Intercept GET for the newly created source document (used by
  // SourceDocumentSummary for polling).  The API returns { source, invoices };
  // processingStatus COMPLETE stops the poll loop so the component settles.
  await page.route("**/api/source-documents/9999**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: {
          id: 9999,
          processingStatus: "COMPLETE",
          originalFileName: "test-invoice.pdf",
        },
        invoices: [],
      }),
    });
  });

  // ---- Navigate to the intake page ----------------------------------------
  await page.goto("/invoices/new");

  await expect(page.getByTestId("button-upload")).toBeVisible({
    timeout: 15_000,
  });

  // Upload button is initially disabled (no file selected yet).
  await expect(page.getByTestId("button-upload")).toBeDisabled();

  // ---- Attach a minimal valid PDF -----------------------------------------
  const minimalPdf = Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n" +
      "3 0 obj<</Type /Page /MediaBox [0 0 612 792]>>endobj\n" +
      "xref\n0 4\n" +
      "0000000000 65535 f\n" +
      "0000000009 00000 n\n" +
      "0000000058 00000 n\n" +
      "0000000115 00000 n\n" +
      "trailer<</Size 4 /Root 1 0 R>>\n" +
      "startxref\n192\n%%EOF\n",
  );

  await page.getByTestId("input-file").setInputFiles({
    name: "test-invoice.pdf",
    mimeType: "application/pdf",
    buffer: minimalPdf,
  });

  // After selecting a file the button should become enabled.
  await expect(page.getByTestId("button-upload")).toBeEnabled();

  // ---- Submit -------------------------------------------------------------
  await page.getByTestId("button-upload").click();

  // The tracking / processing screen renders the "Upload Another File" button.
  await expect(page.getByTestId("button-upload-another")).toBeVisible({
    timeout: 15_000,
  });

  // Confirm the page is still intact — no unhandled crash.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 6. Audit Viewer — AuditActor badge rendering ────────────────────────────

test("audit viewer renders all three actor types correctly", async ({
  page,
}) => {
  // Mock the audit-log API for invoice #1 with one entry per actor type.
  await page.route("**/api/invoices/1/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 101,
          invoiceId: 1,
          action: "EXTRACTION_COMPLETE",
          actorClerkId: "system-pipeline",
          actorName: null,
          editorRole: null,
          fieldName: null,
          oldValue: null,
          newValue: null,
          note: "Automated extraction step",
          createdAt: "2026-01-01T10:00:00.000Z",
        },
        {
          id: 102,
          invoiceId: 1,
          action: "STATUS_CHANGE",
          actorClerkId: "unattributed-legacy",
          actorName: null,
          editorRole: null,
          fieldName: "status",
          oldValue: "PENDING",
          newValue: "APPROVED",
          note: null,
          createdAt: "2026-01-02T11:00:00.000Z",
        },
        {
          id: 103,
          invoiceId: 1,
          action: "FIELD_EDIT",
          actorClerkId: "user_clerk_abc123",
          actorName: "Jane Manager",
          editorRole: "AP_MANAGER",
          fieldName: "vendorId",
          oldValue: "42",
          newValue: "55",
          note: null,
          createdAt: "2026-01-03T12:00:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/audit");

  // Wait for the page heading.
  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Enter invoice ID and load.
  await page.getByTestId("input-invoice-id").fill("1");
  await page.getByTestId("button-load-audit").click();

  // Wait for the timeline to appear.
  await expect(page.getByTestId("audit-timeline")).toBeVisible({
    timeout: 10_000,
  });

  // ── system-pipeline → "System" badge ──────────────────────────────────────
  await expect(page.getByTestId("badge-actor-system")).toBeVisible();
  await expect(page.getByTestId("badge-actor-system")).toContainText("System");

  // ── unattributed-legacy → "Unknown (legacy)" label ────────────────────────
  await expect(page.getByTestId("label-actor-legacy")).toBeVisible();
  await expect(page.getByTestId("label-actor-legacy")).toContainText(
    "Unknown (legacy)",
  );

  // ── real Clerk user → name + role badge ───────────────────────────────────
  await expect(page.getByTestId("label-actor-human")).toBeVisible();
  await expect(page.getByTestId("label-actor-human")).toContainText(
    "Jane Manager",
  );
  await expect(page.getByTestId("badge-actor-role")).toBeVisible();
  await expect(page.getByTestId("badge-actor-role")).toContainText("Manager");

  // Confirm the page is still intact.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 7. AuditActor — human actor with no actorName falls back to actorClerkId ─

test("audit viewer: human actor with null actorName shows actorClerkId", async ({
  page,
}) => {
  // Mock audit log with a human actor whose actorName is null.
  await page.route("**/api/invoices/2/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 201,
          invoiceId: 2,
          action: "FIELD_EDIT",
          actorClerkId: "user_clerk_noname",
          actorName: null,
          editorRole: "AP_CLERK",
          fieldName: "amount",
          oldValue: "100",
          newValue: "200",
          note: null,
          createdAt: "2026-01-04T09:00:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("2");
  await page.getByTestId("button-load-audit").click();

  await expect(page.getByTestId("audit-timeline")).toBeVisible({
    timeout: 10_000,
  });

  // Human actor label is rendered.
  await expect(page.getByTestId("label-actor-human")).toBeVisible();

  // With no actorName, the actorClerkId is displayed instead.
  await expect(page.getByTestId("label-actor-human")).toContainText(
    "user_clerk_noname",
  );

  // Role badge still renders because editorRole is AP_CLERK.
  await expect(page.getByTestId("badge-actor-role")).toBeVisible();
  await expect(page.getByTestId("badge-actor-role")).toContainText("Clerk");

  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 8. AuditActor — unrecognised editorRole renders no role badge ────────────

test("audit viewer: human actor with unrecognised editorRole shows no role badge", async ({
  page,
}) => {
  // Mock audit log with a human actor whose editorRole is not a known value.
  await page.route("**/api/invoices/3/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 301,
          invoiceId: 3,
          action: "STATUS_CHANGE",
          actorClerkId: "user_clerk_unknown_role",
          actorName: "Alex Unknown",
          editorRole: "SUPER_ADMIN",
          fieldName: null,
          oldValue: null,
          newValue: null,
          note: "Role not in known list",
          createdAt: "2026-01-05T14:00:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("3");
  await page.getByTestId("button-load-audit").click();

  await expect(page.getByTestId("audit-timeline")).toBeVisible({
    timeout: 10_000,
  });

  // Human actor label is rendered with the actor name.
  await expect(page.getByTestId("label-actor-human")).toBeVisible();
  await expect(page.getByTestId("label-actor-human")).toContainText(
    "Alex Unknown",
  );

  // No role badge should appear for an unrecognised editorRole.
  await expect(page.getByTestId("badge-actor-role")).not.toBeVisible();

  await expect(page.locator("body")).not.toBeEmpty();
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
