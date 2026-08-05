import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that enforces Clerk authentication.
 * Attaches the Clerk userId to req for downstream handlers.
 * Returns 401 JSON if no valid session is found.
 *
 * SMOKE_TEST_API_KEY bypass: if SMOKE_TEST_API_KEY is set in the environment,
 * requests carrying `Authorization: Bearer <key>` are allowed through without a
 * Clerk session. This is intentionally limited to a randomly-generated dev key
 * so the smoke test suite can validate the full pipeline without a browser session.
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
  next();
}
