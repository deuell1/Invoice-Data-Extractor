import rateLimit from "express-rate-limit";
import type { Request } from "express";

// Per-user rate limiter for AI extraction endpoints.
//
// Keyed by clerkUserId (not IP) — this is a Clerk-authenticated app and
// Replit's infra means all requests share the same egress IP, making IP-keying
// useless.
//
// Smoke-test requests (clerkUserId === "smoke-test") are skipped entirely.
// Suite 11 re-extracts the same invoice pack an unbounded number of times
// across a run; a numeric ceiling is a magic number waiting to be tripped.
// The limiter is a production guard against real users hammering the AI
// endpoint — smoke-test runs don't need it.
//
// Env vars (optional — safe defaults apply if unset):
//   EXTRACTION_RATE_LIMIT_MAX        max requests per window (default: 30)
//   EXTRACTION_RATE_LIMIT_WINDOW_MS  window duration in ms   (default: 300000 = 5 min)

const max = process.env.EXTRACTION_RATE_LIMIT_MAX
  ? parseInt(process.env.EXTRACTION_RATE_LIMIT_MAX, 10)
  : 30;

const windowMs = process.env.EXTRACTION_RATE_LIMIT_WINDOW_MS
  ? parseInt(process.env.EXTRACTION_RATE_LIMIT_WINDOW_MS, 10)
  : 5 * 60 * 1000; // 5 minutes

export const extractionRateLimit = rateLimit({
  windowMs,
  max,
  standardHeaders: "draft-7", // RateLimit header (RFC 9110 draft)
  legacyHeaders: false,

  // Key on the authenticated user, not the IP address.
  keyGenerator: (req: Request): string => {
    return (req as any).clerkUserId as string;
  },

  // Exempt the smoke-test identity entirely so Suite 11 never trips this.
  skip: (req: Request): boolean => {
    return (req as any).clerkUserId === "smoke-test";
  },

  // Return a clear 429 — do not throw.
  handler: (_req, res) => {
    res.status(429).json({
      error: `Extraction rate limit exceeded. Maximum ${max} requests per ${windowMs / 1000} seconds per user.`,
    });
  },
});
