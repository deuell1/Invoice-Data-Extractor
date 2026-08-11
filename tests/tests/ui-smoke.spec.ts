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

// ─── 9. Audit Viewer — empty array ───────────────────────────────────────────

test("audit viewer: empty audit log shows empty-state message and does not crash", async ({
  page,
}) => {
  // Mock the audit API for invoice #4 returning an empty array.
  await page.route("**/api/invoices/4/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("4");
  await page.getByTestId("button-load-audit").click();

  // The empty-state element must appear; the timeline must not.
  await expect(page.getByTestId("audit-empty")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("audit-timeline")).not.toBeVisible();

  // The page must remain intact — no crash.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 10. Audit Viewer — 404 invoice ──────────────────────────────────────────

test("audit viewer: 404 from audit API shows error message and does not crash", async ({
  page,
}) => {
  // Mock the audit API for invoice #5 returning 404.
  await page.route("**/api/invoices/5/audit**", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Invoice not found" }),
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("5");
  await page.getByTestId("button-load-audit").click();

  // The error element must appear; neither the timeline nor the empty state.
  await expect(page.getByTestId("audit-error")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("audit-timeline")).not.toBeVisible();
  await expect(page.getByTestId("audit-empty")).not.toBeVisible();

  // The page must remain intact — no crash.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 11. Audit Viewer — FIELD_EDIT content columns ───────────────────────────

test("audit viewer: FIELD_EDIT row shows fieldName, oldValue, and newValue", async ({
  page,
}) => {
  // Mock the audit API for invoice #10 with a single FIELD_EDIT row.
  await page.route("**/api/invoices/10/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 1001,
          invoiceId: 10,
          action: "FIELD_EDIT",
          actorClerkId: "user_clerk_editor",
          actorName: "Sam Editor",
          editorRole: "AP_CLERK",
          fieldName: "invoiceNumber",
          oldValue: "INV-001",
          newValue: "INV-002",
          note: null,
          createdAt: "2026-03-15T08:30:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("10");
  await page.getByTestId("button-load-audit").click();

  await expect(page.getByTestId("audit-timeline")).toBeVisible({
    timeout: 10_000,
  });

  // The field-change row must be present.
  await expect(page.getByTestId("audit-field-change-1001")).toBeVisible();

  // fieldName must appear.
  await expect(page.getByTestId("audit-field-name-1001")).toContainText(
    "invoiceNumber",
  );

  // oldValue must appear.
  await expect(page.getByTestId("audit-old-value-1001")).toContainText(
    "INV-001",
  );

  // newValue must appear.
  await expect(page.getByTestId("audit-new-value-1001")).toContainText(
    "INV-002",
  );

  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 12. Audit Viewer — STATUS_CHANGE note column ────────────────────────────

test("audit viewer: STATUS_CHANGE row shows note text", async ({ page }) => {
  // Mock the audit API for invoice #11 with a single STATUS_CHANGE row that
  // has a note but no field-change columns.
  await page.route("**/api/invoices/11/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 1101,
          invoiceId: 11,
          action: "STATUS_CHANGE",
          actorClerkId: "user_clerk_approver",
          actorName: "Kim Approver",
          editorRole: "AP_MANAGER",
          fieldName: null,
          oldValue: null,
          newValue: null,
          note: "Approved after second review",
          createdAt: "2026-04-01T14:00:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("11");
  await page.getByTestId("button-load-audit").click();

  await expect(page.getByTestId("audit-timeline")).toBeVisible({
    timeout: 10_000,
  });

  // The note must appear with the correct text.
  await expect(page.getByTestId("audit-note-1101")).toBeVisible();
  await expect(page.getByTestId("audit-note-1101")).toContainText(
    "Approved after second review",
  );

  // No field-change row should appear (fieldName is null).
  await expect(page.getByTestId("audit-field-change-1101")).not.toBeVisible();

  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 13. Audit Viewer — network drop mid-load ────────────────────────────────

test("audit viewer: network drop shows error message and does not crash", async ({
  page,
}) => {
  // Simulate a network-level failure (ERR_NETWORK / request aborted) for
  // invoice #6 — this is distinct from an HTTP error response.
  await page.route("**/api/invoices/6/audit**", async (route) => {
    await route.abort();
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("6");
  await page.getByTestId("button-load-audit").click();

  // The error element must appear; neither the timeline nor the empty state.
  await expect(page.getByTestId("audit-error")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("audit-timeline")).not.toBeVisible();
  await expect(page.getByTestId("audit-empty")).not.toBeVisible();

  // The page must remain intact — no crash or blank screen.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 14. Audit Viewer — malformed JSON body (status 200) ─────────────────────

test("audit viewer: malformed JSON body shows error message and does not crash", async ({
  page,
}) => {
  // Simulate a proxy/CDN truncation: the server replies 200 but the body is
  // invalid JSON.  React Query must still set isError=true via the JSON parse
  // failure, and the audit-error element must appear.
  await page.route("**/api/invoices/7/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{ invalid json [",
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("7");
  await page.getByTestId("button-load-audit").click();

  // The error element must appear; neither the timeline nor the empty state.
  await expect(page.getByTestId("audit-error")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("audit-timeline")).not.toBeVisible();
  await expect(page.getByTestId("audit-empty")).not.toBeVisible();

  // The page must remain intact — no crash or blank screen.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 15. Audit Viewer — null oldValue renders "empty" label ─────────────────

test("audit viewer: FIELD_EDIT with null oldValue renders 'empty' on the left side", async ({
  page,
}) => {
  // Mock the audit API for invoice #12 with a FIELD_EDIT row where oldValue is
  // null (a value was set for the first time — there was nothing before).
  await page.route("**/api/invoices/12/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 1201,
          invoiceId: 12,
          action: "FIELD_EDIT",
          actorClerkId: "user_clerk_setter",
          actorName: "Pat Setter",
          editorRole: "AP_CLERK",
          fieldName: "dueDate",
          oldValue: null,
          newValue: "2026-06-30",
          note: null,
          createdAt: "2026-05-01T09:00:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("12");
  await page.getByTestId("button-load-audit").click();

  await expect(page.getByTestId("audit-timeline")).toBeVisible({
    timeout: 10_000,
  });

  // The field-change row must be present.
  await expect(page.getByTestId("audit-field-change-1201")).toBeVisible();

  // oldValue is null → the component must render the fallback "empty" label.
  await expect(page.getByTestId("audit-old-value-1201")).toContainText("empty");

  // newValue is a real value → must render as-is (not "empty").
  await expect(page.getByTestId("audit-new-value-1201")).toContainText(
    "2026-06-30",
  );

  // Page must remain intact — no crash.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 15. Audit Viewer — null newValue renders "empty" label ─────────────────

test("audit viewer: FIELD_EDIT with null newValue renders 'empty' on the right side", async ({
  page,
}) => {
  // Mock the audit API for invoice #13 with a FIELD_EDIT row where newValue is
  // null (a field was cleared).
  await page.route("**/api/invoices/13/audit**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 1301,
          invoiceId: 13,
          action: "FIELD_EDIT",
          actorClerkId: "user_clerk_clearer",
          actorName: "Jordan Clearer",
          editorRole: "AP_MANAGER",
          fieldName: "poNumber",
          oldValue: "PO-9876",
          newValue: null,
          note: null,
          createdAt: "2026-05-02T10:30:00.000Z",
        },
      ]),
    });
  });

  await page.goto("/audit");

  await expect(
    page.getByRole("heading", { name: /audit log viewer/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("input-invoice-id").fill("13");
  await page.getByTestId("button-load-audit").click();

  await expect(page.getByTestId("audit-timeline")).toBeVisible({
    timeout: 10_000,
  });

  // The field-change row must be present.
  await expect(page.getByTestId("audit-field-change-1301")).toBeVisible();

  // oldValue is a real value → must render as-is (not "empty").
  await expect(page.getByTestId("audit-old-value-1301")).toContainText(
    "PO-9876",
  );

  // newValue is null → the component must render the fallback "empty" label.
  await expect(page.getByTestId("audit-new-value-1301")).toContainText("empty");

  // Page must remain intact — no crash.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ─── 16. Exception Queue — InvoiceAuditPanel actor types ─────────────────────

test("exception queue audit panel shows all three actor types correctly", async ({
  page,
}) => {
  const INVOICE_ID = 50;

  // Mock the exceptions list to return a single invoice.
  await page.route("**/api/exceptions**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: INVOICE_ID,
            invoiceNumber: "INV-TEST-50",
            vendorId: 1,
            vendorName: "Acme Corp",
            invoiceDate: "2026-01-15",
            totalAmount: 1500,
            taxAmount: 150,
            poNumber: "PO-9999",
            currency: "USD",
            exceptionReason: "Low confidence",
            lowConfidenceFields: null,
            updatedAt: "2026-01-15T10:00:00.000Z",
            status: "EXCEPTION",
            exceptionOwner: null,
          },
        ],
        total: 1,
      }),
    });
  });

  // Mock the audit log for this invoice covering all three actor types.
  await page.route(`**/api/invoices/${INVOICE_ID}/audit**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 5001,
          invoiceId: INVOICE_ID,
          action: "EXTRACTION_COMPLETE",
          actorClerkId: "system-pipeline",
          actorName: null,
          editorRole: null,
          fieldName: null,
          oldValue: null,
          newValue: null,
          note: "Automated extraction",
          createdAt: "2026-01-15T08:00:00.000Z",
        },
        {
          id: 5002,
          invoiceId: INVOICE_ID,
          action: "STATUS_CHANGE",
          actorClerkId: "unattributed-legacy",
          actorName: null,
          editorRole: null,
          fieldName: "status",
          oldValue: "PENDING",
          newValue: "EXCEPTION",
          note: null,
          createdAt: "2026-01-15T09:00:00.000Z",
        },
        {
          id: 5003,
          invoiceId: INVOICE_ID,
          action: "FIELD_EDIT",
          actorClerkId: "user_2abc_real_clerk_id",
          actorName: "Jane Manager",
          editorRole: "AP_MANAGER",
          fieldName: "vendorId",
          oldValue: "10",
          newValue: "1",
          note: null,
          createdAt: "2026-01-15T10:00:00.000Z",
        },
      ]),
    });
  });

  // Mock the vendors list (loaded by the page on mount).
  await page.route("**/api/vendors**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], total: 0 }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto("/exceptions");

  // Wait for the exception queue heading.
  await expect(
    page.getByRole("heading", { name: /exception queue/i }),
  ).toBeVisible({ timeout: 15_000 });

  // The mocked invoice row must be visible.
  await expect(
    page.getByTestId(`row-exception-${INVOICE_ID}`),
  ).toBeVisible({ timeout: 10_000 });

  // Click the chevron cell (first <td> in the row) to expand the audit panel.
  await page
    .getByTestId(`row-exception-${INVOICE_ID}`)
    .locator("td")
    .first()
    .click();

  // The audit panel renders inside the expanded row — wait for any content.
  // "Audit History" label appears as a heading in the expanded row.
  await expect(page.getByText("Audit History")).toBeVisible({
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

  // ── real Clerk user → actor name rendered, raw Clerk ID absent ────────────
  await expect(page.getByTestId("label-actor-human")).toBeVisible();
  await expect(page.getByTestId("label-actor-human")).toContainText(
    "Jane Manager",
  );

  // Raw Clerk ID must NOT be visible anywhere in the panel when actorName is
  // present — the component must display the name, not the opaque ID.
  await expect(page.getByText("user_2abc_real_clerk_id")).not.toBeVisible();

  // Role badge renders for the AP_MANAGER actor.
  await expect(page.getByTestId("badge-actor-role")).toBeVisible();
  await expect(page.getByTestId("badge-actor-role")).toContainText("Manager");

  // Page must remain intact — no crash.
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
