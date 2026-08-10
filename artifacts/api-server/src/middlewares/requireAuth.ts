import { getAuth } from "@clerk/express";
import { createClerkClient } from "@clerk/backend";
import type { Request, Response, NextFunction } from "express";

export type UserRole = "AP_MANAGER" | "AP_CLERK";

// ─── Actor name resolution ────────────────────────────────────────────────────

/**
 * Format a Clerk user object into a display name string.
 * Returns null when neither firstName nor lastName is available.
 *
 * Exported so unit tests can verify the formatting logic directly.
 */
export function formatActorName(user: {
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  const parts = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * A minimal subset of the Clerk users API needed for name resolution.
 * Exposed as a type so tests can inject a mock without importing the full SDK.
 */
export interface ClerkUsersClient {
  getUser(userId: string): Promise<{ firstName?: string | null; lastName?: string | null }>;
}

/**
 * Look up a Clerk user by userId and return their display name.
 *
 * Returns null (never throws) when:
 *   • userId is a known system actor ("system-pipeline", "smoke-test", etc.)
 *   • CLERK_SECRET_KEY is not set in the environment
 *   • The Clerk API call fails for any reason
 *
 * Exported so unit tests can call it with a mock ClerkUsersClient and verify
 * that a real authenticated user's name is never silently dropped.
 */
export async function resolveActorName(
  userId: string,
  /**
   * Optional Clerk users client override.  Pass a mock in tests; omit in
   * production (the function creates a real client from CLERK_SECRET_KEY).
   */
  clerkUsers?: ClerkUsersClient,
): Promise<string | null> {
  // System actors have no Clerk profile — skip the API call.
  if (
    !userId ||
    userId === "system-pipeline" ||
    userId === "smoke-test" ||
    userId.startsWith("system")
  ) {
    return null;
  }

  try {
    let users: ClerkUsersClient | null = clerkUsers ?? null;

    if (!users) {
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) return null; // Not configured — skip silently.
      users = createClerkClient({ secretKey }).users as unknown as ClerkUsersClient;
    }

    const user = await users.getUser(userId);
    return formatActorName(user);
  } catch {
    // Never let name resolution fail a request.
    return null;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that enforces Clerk authentication.
 * Attaches the Clerk userId, role, and resolved display name to req for
 * downstream handlers.
 * Returns 401 JSON if no valid session is found.
 *
 * SMOKE_TEST_API_KEY bypass: if SMOKE_TEST_API_KEY is set in the environment,
 * requests carrying `Authorization: Bearer <key>` are allowed through without a
 * Clerk session. This is intentionally limited to a randomly-generated dev key
 * so the smoke test suite can validate the full pipeline without a browser session.
 * Smoke-test requests are granted AP_MANAGER so they can exercise all routes.
 * Their actorName is always null (no Clerk user profile to look up).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Smoke-test API key bypass — only active outside production.
  // The key MUST be stored as a Replit Secret (never a plaintext env var in .replit).
  // Fail closed: if NODE_ENV is production this branch is never entered.
  if (process.env.NODE_ENV !== "production") {
    const smokeKey = process.env.SMOKE_TEST_API_KEY;
    if (smokeKey) {
      const authHeader = req.headers["authorization"] ?? "";
      const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (bearer === smokeKey) {
        (req as any).clerkUserId = "smoke-test";
        // Allow role override for role-guard smoke tests: send X-Smoke-Role: AP_CLERK
        // to simulate a clerk session without a real Clerk token.
        // Only respected outside production alongside a valid smoke key.
        const smokeRoleHeader = req.headers["x-smoke-role"];
        const clerkRole: UserRole =
          smokeRoleHeader === "AP_CLERK" ? "AP_CLERK" : "AP_MANAGER";
        (req as any).clerkUserRole = clerkRole;
        // Smoke-test actor has no Clerk user profile — actorName is always null.
        (req as any).clerkActorName = null;
        next();
        return;
      }
    }
  }

  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Expose the authenticated user id to route handlers if needed.
  (req as any).clerkUserId = userId;

  // Read the role from Clerk publicMetadata (set by an admin in the Clerk dashboard
  // or via the Clerk backend API). Defaults to AP_CLERK when not set.
  const meta = (auth.sessionClaims?.publicMetadata ?? {}) as Record<string, unknown>;
  const roleRaw = meta["role"];
  const role: UserRole =
    roleRaw === "AP_MANAGER" || roleRaw === "AP_CLERK" ? roleRaw : "AP_CLERK";
  (req as any).clerkUserRole = role;

  // Resolve the display name from the Clerk backend API.
  // Stored on req so route handlers can pass it to appendAudit without
  // making additional API calls.  Fails silently — never blocks auth.
  (req as any).clerkActorName = await resolveActorName(String(userId));

  next();
}

/**
 * Middleware factory that enforces a minimum role level.
 * Must be used AFTER requireAuth (which populates req.clerkUserRole).
 * Returns 403 if the authenticated user does not have the required role.
 *
 * Usage:
 *   router.post("/invoices/:id/approve", requireRole("AP_MANAGER"), handler);
 */
export function requireRole(role: UserRole) {
  return function (req: Request, res: Response, next: NextFunction) {
    const userRole = (req as any).clerkUserRole as UserRole | undefined;
    if (userRole !== role) {
      res.status(403).json({
        error: `Forbidden: ${role} role required`,
        yourRole: userRole ?? "unknown",
      });
      return;
    }
    next();
  };
}
