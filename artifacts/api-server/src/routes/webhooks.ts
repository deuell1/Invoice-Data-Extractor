/**
 * POST /webhooks/clerk
 *
 * Receives Clerk webhook events, verifies the Svix signature, and handles
 * user.updated by evicting the matching userId from actorNameCache so that
 * audit-log entries immediately reflect the renamed user on the next request.
 *
 * Mounting notes
 * ──────────────
 * This router MUST be mounted with express.raw({ type: "application/json" })
 * BEFORE the global express.json() body parser so that Svix can verify the
 * raw request body against its signature.  See app.ts for the mount point.
 *
 * Environment variable
 * ────────────────────
 * CLERK_WEBHOOK_SECRET — the "Signing Secret" shown in the Clerk dashboard for
 *   this webhook endpoint (starts with "whsec_…").  When not set the handler
 *   returns 500 so misconfiguration is visible immediately.
 */

import { Router } from "express";
import { Webhook } from "svix";
import type { Request, Response } from "express";
import { actorNameCache } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";

const webhooksRouter = Router();

webhooksRouter.post("/clerk", async (req: Request, res: Response) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("CLERK_WEBHOOK_SECRET is not set — cannot verify Clerk webhook");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  // Svix requires the raw body as a string or Buffer.
  // express.raw() stores it in req.body as a Buffer.
  const rawBody: Buffer | string =
    Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body));

  const svixId = req.headers["svix-id"];
  const svixTimestamp = req.headers["svix-timestamp"];
  const svixSignature = req.headers["svix-signature"];

  if (
    typeof svixId !== "string" ||
    typeof svixTimestamp !== "string" ||
    typeof svixSignature !== "string"
  ) {
    res.status(400).json({ error: "Missing Svix signature headers" });
    return;
  }

  let payload: unknown;
  try {
    const wh = new Webhook(secret);
    payload = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (err) {
    logger.warn({ err }, "Clerk webhook signature verification failed");
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  const event = payload as { type?: string; data?: { id?: string } };

  if (event.type === "user.updated") {
    const userId = event.data?.id;
    if (userId && typeof userId === "string") {
      const evicted = actorNameCache.delete(userId);
      logger.info(
        { userId, evicted },
        "Clerk user.updated: evicted display-name cache entry",
      );
    } else {
      logger.warn({ event }, "Clerk user.updated event missing data.id — cache not evicted");
    }
  }

  // Return 200 for all recognised events (including unhandled types — we don't
  // want Clerk to retry events we intentionally ignore).
  res.status(200).json({ received: true });
});

export default webhooksRouter;
