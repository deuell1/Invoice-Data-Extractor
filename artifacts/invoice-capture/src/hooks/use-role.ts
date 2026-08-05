import { useUser } from "@clerk/react";

export type UserRole = "AP_MANAGER" | "AP_CLERK";

/**
 * Returns the current user's role from Clerk publicMetadata.
 * Defaults to "AP_CLERK" when no role is set (least-privilege default).
 *
 * In E2E/smoke mode the mock user has publicMetadata.role = "AP_MANAGER"
 * so all UI actions remain exercisable in tests.
 */
export function useRole(): UserRole {
  const { user } = useUser();
  if (!user) return "AP_CLERK";
  const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;
  const role = meta["role"];
  if (role === "AP_MANAGER" || role === "AP_CLERK") return role;
  return "AP_CLERK";
}

/** Convenience: true when the current user is an AP_MANAGER. */
export function useIsManager(): boolean {
  return useRole() === "AP_MANAGER";
}
