/**
 * Sign-in Theme Tests — Mission Control Retheme Visual Verification
 *
 * Navigates to /sign-in using a real (non-bypassed) Clerk instance so the
 * sign-in card actually renders with the Mission Control appearance config.
 * Asserts that key Mission Control tokens are applied correctly:
 *
 *   - Card background  → dark surface  (~#0e1017, hsl 227 24% 7%)
 *   - Primary button   → electric blue (~#58a6ff)
 *   - Input borders    → dark border   (~#242530)
 *
 * Runs via the "sign-in-theme" Playwright project, which starts a separate
 * Vite dev server on port 8090 WITHOUT VITE_E2E_BYPASS so the real @clerk/react
 * package loads and renders the card inline.
 *
 * Prerequisites:
 *   - VITE_CLERK_PUBLISHABLE_KEY must be present in the environment.
 *   - The API server does NOT need to be running (this test only hits /sign-in).
 */

import { test, expect } from "@playwright/test";

// ─── Color helpers ────────────────────────────────────────────────────────────

/**
 * Parse a CSS rgb/rgba string like "rgb(14, 16, 23)" into [r, g, b].
 * Returns [0, 0, 0] for unrecognised formats so assertions fail loudly.
 */
function parseRgb(color: string): [number, number, number] {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("sign-in page has dark gradient background", async ({ page }) => {
  // Clerk's JS initialises asynchronously — give it extra time.
  test.setTimeout(45_000);

  await page.goto("/sign-in");

  // The outer wrapper div is always rendered (independent of Clerk load).
  // It carries  bg-gradient-to-br from-slate-900 to-slate-800  (both very dark).
  const wrapper = page
    .locator("div.flex.min-h-screen.items-center.justify-center")
    .first();
  await expect(wrapper).toBeVisible({ timeout: 15_000 });

  const bgImage = await wrapper.evaluate(
    (el) => window.getComputedStyle(el).backgroundImage,
  );
  // Both Tailwind slate-900 and slate-800 are very dark; we just confirm a
  // gradient was applied (not the default "none" of an un-themed white page).
  expect(bgImage, "outer wrapper should have a CSS gradient").toContain(
    "linear-gradient",
  );
});

test("sign-in card renders with Mission Control dark surface", async ({
  page,
}) => {
  test.setTimeout(45_000);

  await page.goto("/sign-in");

  // Wait for Clerk's root container — confirms Clerk JS has initialised and
  // rendered at least the outer shell.
  const rootBox = page.locator(".cl-rootBox").first();
  await expect(rootBox).toBeVisible({ timeout: 30_000 });

  // The card box is the visible rounded card.  Its appearance is driven by
  // clerkAppearance.elements.cardBox = "bg-card …" and
  // clerkAppearance.variables.colorBackground = "hsl(227 24% 7%)".
  // Either way it must NOT be white or light.
  const cardBox = page.locator(".cl-cardBox").first();
  await expect(cardBox).toBeVisible({ timeout: 15_000 });

  const rawCardBg = await cardBox.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );

  // If the computed value is fully transparent Clerk may be using a child
  // element for the visual background — fall back to the inner card.
  const effectiveBg =
    rawCardBg === "rgba(0, 0, 0, 0)" || rawCardBg === "transparent"
      ? await page
          .locator(".cl-card")
          .first()
          .evaluate((el) => window.getComputedStyle(el).backgroundColor)
      : rawCardBg;

  const [cr, cg, cb] = parseRgb(effectiveBg);

  // Dark surface: all channels well below the midpoint (128).
  // Target is rgb(14, 16, 23) — accept up to ~80 to tolerate minor theme drift.
  expect(
    cr,
    `card red channel should be dark — got background: ${effectiveBg}`,
  ).toBeLessThan(80);
  expect(
    cg,
    `card green channel should be dark — got background: ${effectiveBg}`,
  ).toBeLessThan(80);
  expect(
    cb,
    `card blue channel should be dark — got background: ${effectiveBg}`,
  ).toBeLessThan(100);
});

test("sign-in primary button is electric blue", async ({ page }) => {
  test.setTimeout(45_000);

  await page.goto("/sign-in");

  // Wait for Clerk to render the interactive form.
  const primaryBtn = page.locator(".cl-formButtonPrimary").first();
  await expect(primaryBtn).toBeVisible({ timeout: 30_000 });

  const btnBg = await primaryBtn.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  const [br, bg, bb] = parseRgb(btnBg);

  // Electric blue: blue channel dominates, all channels > zero (not black),
  // and the button is clearly not dark/unstyled grey.
  // Target: hsl(221.2 83.2% 53.3%) ≈ rgb(66, 133, 244) or #58a6ff = rgb(88, 166, 255).
  expect(
    bb,
    `primary button blue channel should be high — got background: ${btnBg}`,
  ).toBeGreaterThan(100);
  expect(
    bb,
    `primary button blue channel should exceed red — got background: ${btnBg}`,
  ).toBeGreaterThan(br);
});

test("sign-in input fields have dark border", async ({ page }) => {
  test.setTimeout(45_000);

  await page.goto("/sign-in");

  // Wait for the email input field to appear.
  const inputField = page.locator(".cl-formFieldInput").first();
  await expect(inputField).toBeVisible({ timeout: 30_000 });

  const borderColor = await inputField.evaluate(
    (el) => window.getComputedStyle(el).borderTopColor,
  );
  const [ir, ig, ib] = parseRgb(borderColor);

  // Dark border: #242530 = rgb(36, 37, 48).
  // Accept up to 120 on any channel — anything above that would be a bright
  // (light-theme) colour indicating the retheme did not apply.
  const maxChannel = Math.max(ir, ig, ib);
  expect(
    maxChannel,
    `input border should be dark — got border-color: ${borderColor}`,
  ).toBeLessThan(120);
});

test("sign-in page screenshot — Mission Control theme visual snapshot", async ({
  page,
}) => {
  // Visual regression guard: captures a full-viewport screenshot and compares
  // it against a stored baseline (tests/tests/sign-in-theme.spec.ts-snapshots/).
  // The baseline was generated with --update-snapshots on the first passing run.
  // A wide pixel-ratio tolerance (~15 %) avoids false failures from font
  // anti-aliasing differences, while still catching gross regressions such as
  // a white page, missing card, or reverted light theme.
  test.setTimeout(45_000);

  await page.goto("/sign-in");

  const rootBox = page.locator(".cl-rootBox").first();
  await expect(rootBox).toBeVisible({ timeout: 30_000 });

  // Brief settle period for animations / web-font loading.
  await page.waitForTimeout(1_000);

  await expect(page).toHaveScreenshot("sign-in-mission-control.png", {
    maxDiffPixelRatio: 0.15,
    fullPage: false,
  });
});
