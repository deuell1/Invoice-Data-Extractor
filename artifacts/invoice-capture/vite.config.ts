import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// ─── E2E bypass: redirect Clerk imports to local mocks ───────────────────────
// Activated by starting the dev server with VITE_E2E_BYPASS=true.
// NEVER set in production — this env var is only injected by the Playwright
// web-server command in tests/playwright.config.ts.
const e2eBypass = process.env.VITE_E2E_BYPASS === "true";

// When using string aliases, Vite does prefix matching — "@clerk/react" would
// also match "@clerk/react/internal".  Use RegExp entries for exact matching.
const e2eAliasEntries = e2eBypass
  ? [
      {
        find: /^@clerk\/react$/,
        replacement: path.resolve(import.meta.dirname, "src/e2e/mock-clerk.tsx"),
      },
      {
        find: /^@clerk\/react\/internal$/,
        replacement: path.resolve(import.meta.dirname, "src/e2e/mock-clerk.tsx"),
      },
      {
        find: /^@clerk\/themes$/,
        replacement: path.resolve(
          import.meta.dirname,
          "src/e2e/mock-clerk-themes.tsx",
        ),
      },
    ]
  : [];

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "src") },
      {
        find: "@assets",
        replacement: path.resolve(
          import.meta.dirname,
          "..",
          "..",
          "attached_assets",
        ),
      },
      ...e2eAliasEntries,
    ],
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Proxy /api to the API server so the Playwright-started dev server
    // (which is not behind Replit's routing layer) can reach the backend.
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
