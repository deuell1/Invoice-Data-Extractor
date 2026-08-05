/**
 * Dev-only mock for @clerk/themes.
 * Loaded ONLY when VITE_E2E_BYPASS=true (via Vite alias).
 * The real package exports pre-built Clerk appearance themes — we just
 * export an empty object so the app doesn't crash when it references `shadcn`.
 */

export const shadcn = {};
