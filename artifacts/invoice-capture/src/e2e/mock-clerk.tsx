/**
 * Dev-only mock for @clerk/react and @clerk/react/internal.
 *
 * Loaded ONLY when the Vite build/serve is started with VITE_E2E_BYPASS=true.
 * Vite aliases @clerk/react and @clerk/react/internal to this file.
 *
 * Provides enough of the Clerk API surface for the app to render without a
 * real Clerk session:
 *   - ClerkProvider    — passthrough, no auth gates
 *   - Show             — "signed-in" always renders, "signed-out" never does
 *   - useUser          — returns a fake user object
 *   - useClerk         — returns a no-op signOut and addListener
 *   - SignIn / SignUp  — render nothing (auth routes are never visited)
 *   - publishableKeyFromHost — returns a safe fake key
 */

import React from "react";

// ─── Fake user ────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: "e2e-smoke-user",
  firstName: "Smoke",
  lastName: "Test",
  primaryEmailAddress: { emailAddress: "smoke@test.e2e" },
  // Grant AP_MANAGER so smoke tests can exercise approve/export routes.
  publicMetadata: { role: "AP_MANAGER" },
};

// ─── ClerkProvider ────────────────────────────────────────────────────────────

export function ClerkProvider({
  children,
}: {
  children: React.ReactNode;
  [key: string]: unknown;
}) {
  return <>{children}</>;
}

// ─── Show ─────────────────────────────────────────────────────────────────────

export function Show({
  when,
  children,
}: {
  when: "signed-in" | "signed-out" | string;
  children: React.ReactNode;
}) {
  if (when === "signed-in") return <>{children}</>;
  // "signed-out" → never render in bypass mode
  return null;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useUser() {
  return { user: MOCK_USER, isLoaded: true, isSignedIn: true };
}

export function useClerk() {
  return {
    signOut: () => Promise.resolve(),
    // addListener must return an unsubscribe function
    addListener: (_listener: unknown) => () => {},
    session: { id: "e2e-session" },
  };
}

export function useAuth() {
  return { isSignedIn: true, isLoaded: true, userId: MOCK_USER.id };
}

// ─── SignIn / SignUp ──────────────────────────────────────────────────────────

export function SignIn(_props: Record<string, unknown>) {
  return null;
}

export function SignUp(_props: Record<string, unknown>) {
  return null;
}

// ─── @clerk/react/internal ────────────────────────────────────────────────────

/**
 * The real implementation derives the publishable key from the hostname.
 * In E2E mode we skip Clerk entirely, so any truthy string works.
 */
export function publishableKeyFromHost(
  _hostname: string,
  fallback?: string,
): string {
  return fallback ?? "pk_test_e2e_mock_000000000000000000000000000000000000000000";
}
