#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# ── Playwright Chromium fallback ──────────────────────────────────────────────
# The system Chromium from replit.nix (pkgs.chromium) is the preferred browser.
# resolveChromiumPath() in tests/playwright.config.ts picks it up via `which chromium`.
# If the Nix env is rebuilt before its packages are fully linked, the system binary
# may be temporarily absent. In that case, install Playwright's bundled Chromium so
# tests can still run.
if ! which chromium > /dev/null 2>&1 && ! which chromium-browser > /dev/null 2>&1; then
  echo "System Chromium not found — installing Playwright's bundled Chromium..."
  pnpm --filter @workspace/tests exec playwright install chromium
fi
