import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export type UserRole = "AP_MANAGER" | "AP_CLERK";

/**
 * Express middleware that enforces Clerk authentication.
 * Attaches the Clerk userId and role to req for downstream handlers.
 * Returns 401 JSON if no valid session is found.
 *
 * SMOKE_TEST_API_KEY bypass: if SMOKE_TEST_API_KEY is set in the environment,
 * requests carrying `Authorization: Bearer <key>` are allowed through without a
 * Clerk session. This is intentionally limited to a randomly-generated dev key
 * so the smoke test suite can validate the full pipeline without a browser session.
 * Smoke-test requests are granted AP_MANAGER so they can exercise all routes.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
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
        (req as any).clerkUserRole = "AP_MANAGER" as UserRole;
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

  // Expose the authenticated user id to route handlers if needed
  (req as any).clerkUserId = userId;

  // Read the role from Clerk publicMetadata (set by an admin in the Clerk dashboard
  // or via the Clerk backend API). Defaults to AP_CLERK when not set.
  const meta = (auth.sessionClaims?.publicMetadata ?? {}) as Record<string, unknown>;
  const roleRaw = meta["role"];
  const role: UserRole =
    roleRaw === "AP_MANAGER" || roleRaw === "AP_CLERK" ? roleRaw : "AP_CLERK";
  (req as any).clerkUserRole = role;

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
