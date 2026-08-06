import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Resolve system Chromium (NixOS) ─────────────────────────────────────────
// Playwright's pre-downloaded chromium-headless-shell cannot load glib/nss from
// NixOS's /nix/store paths. We use the system `chromium` installed via nix instead.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var overrides this at runtime.
function resolveChromiumPath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    try {
      return execFileSync("which", ["chromium-browser"], {
        encoding: "utf8",
      }).trim();
    } catch {
      return undefined; // fall back to Playwright's own download
    }
  }
}

const systemChromium = resolveChromiumPath();

/**
 * Port for the E2E test dev server (Clerk bypassed — used by ui-smoke tests).
 * Must not clash with the managed workflows (8080 = API, 8081 = UI, 20658 = mockup).
 */
const E2E_UI_PORT = 8089;

/**
 * Port for the sign-in theme dev server (real Clerk — used by sign-in-theme tests).
 * Must not clash with the managed workflows or the bypass server above.
 */
const E2E_SIGNIN_PORT = 8090;

/**
 * The API server is assumed to be running at its standard port (started by
 * the managed `artifacts/api-server` workflow). The Vite proxy in
 * invoice-capture's vite.config.ts forwards /api → http://localhost:8080.
 */
const BASE_URL = `http://localhost:${E2E_UI_PORT}`;
const SIGNIN_BASE_URL = `http://localhost:${E2E_SIGNIN_PORT}`;

const chromiumLaunchOptions = {
  executablePath: systemChromium,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};

export default defineConfig({
  testDir: "./tests",

  // Each test gets its own timeout.
  timeout: 30_000,

  // Fail fast in CI so we get quick feedback.
  forbidOnly: !!process.env.CI,

  // Single retry on flaky network operations.
  retries: process.env.CI ? 1 : 0,

  // Run tests sequentially to avoid port conflicts and reduce DB noise.
  workers: 1,

  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  use: {
    baseURL: BASE_URL,

    // Capture a screenshot and trace on failure.
    screenshot: "only-on-failure",
    trace: "on-first-retry",

    // Allow the test server to respond from 0.0.0.0.
    ignoreHTTPSErrors: true,
  },

  projects: [
    /**
     * Main smoke tests — Clerk bypassed so pages render without a real session.
     * Only runs tests in ui-smoke.spec.ts.
     */
    {
      name: "chromium",
      testMatch: /ui-smoke\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: BASE_URL,
        launchOptions: chromiumLaunchOptions,
      },
    },

    /**
     * Sign-in theme tests — real Clerk so the sign-in card actually renders.
     * Uses a separate dev server without VITE_E2E_BYPASS so Clerk loads its UI.
     */
    {
      name: "sign-in-theme",
      testMatch: /sign-in-theme\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: SIGNIN_BASE_URL,
        launchOptions: chromiumLaunchOptions,
      },
    },
  ],

  webServer: [
    /**
     * Bypass server for ui-smoke tests.
     *
     * Key flags:
     *   VITE_E2E_BYPASS=true   — aliases @clerk/react to a local mock so the app
     *                            renders without a real Clerk session.
     *   BASE_PATH=/            — required by vite.config.ts validation.
     *   PORT=<E2E_UI_PORT>     — required by vite.config.ts validation.
     */
    {
      command: [
        `PORT=${E2E_UI_PORT}`,
        `BASE_PATH=/`,
        `VITE_E2E_BYPASS=true`,
        `pnpm --filter @workspace/invoice-capture run dev`,
      ].join(" "),
      port: E2E_UI_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      cwd: path.resolve(__dirname, ".."),
    },

    /**
     * Real-Clerk server for sign-in-theme tests.
     *
     * VITE_E2E_BYPASS is intentionally absent so the real @clerk/react package
     * is used and the sign-in card renders with the Mission Control appearance.
     * The VITE_CLERK_PUBLISHABLE_KEY secret must be present in the environment.
     */
    {
      command: [
        `PORT=${E2E_SIGNIN_PORT}`,
        `BASE_PATH=/`,
        `pnpm --filter @workspace/invoice-capture run dev`,
      ].join(" "),
      port: E2E_SIGNIN_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      cwd: path.resolve(__dirname, ".."),
    },
  ],
});
