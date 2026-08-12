/**
 * Unit tests for POST /webhooks/clerk
 *
 * The webhook handler must:
 *   1. Reject requests whose Svix signature headers are missing (400).
 *   2. Reject requests whose Svix signature is invalid (400).
 *   3. On user.updated, evict the matching userId from actorNameCache and
 *      return 200.
 *   4. Ignore other event types (e.g. user.created) gracefully and return 200.
 *   5. Return 500 when CLERK_WEBHOOK_SECRET is not set.
 *
 * Run via:
 *   node --test --import tsx/esm src/routes/__tests__/webhooks.test.ts
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// ─── Module imports (must come before dynamic import of the route module) ──────

// We import actorNameCache directly so tests can seed / inspect it.
import { actorNameCache } from "../../middlewares/requireAuth.js";
// Import the replay-tracking map so tests can reset it between runs.
import { seenMessageIds } from "../webhooks.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock Express req/res pair.
 * `body` is a raw JSON Buffer (mimicking express.raw()).
 */
function buildReqRes(
  body: Buffer,
  headers: Record<string, string>,
): {
  req: Record<string, unknown>;
  res: {
    statusCode: number | null;
    body: unknown;
    status(code: number): { json(b: unknown): void };
    json(b: unknown): void;
  };
} {
  const res = {
    statusCode: null as number | null,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return { json: (b: unknown) => { res.body = b; } };
    },
    json(b: unknown) {
      res.statusCode = res.statusCode ?? 200;
      res.body = b;
    },
  };

  return {
    req: { body, headers },
    res,
  };
}

/**
 * Build valid Svix signature headers for a given payload and secret.
 *
 * Svix HMAC-SHA256 message format:
 *   `<msgId>.<timestamp>.<rawBody>`
 *
 * The signature header value is:
 *   `v1,<base64(hmac-sha256(secret_bytes, message))>`
 */
function buildSvixHeaders(
  msgId: string,
  timestampSec: number,
  rawBody: Buffer,
  secret: string, // "whsec_<base64>" format
): Record<string, string> {
  // Decode the base64 secret bytes (strip the "whsec_" prefix).
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const toSign = `${msgId}.${timestampSec}.${rawBody.toString("utf8")}`;
  const sig = createHmac("sha256", secretBytes).update(toSign).digest("base64");

  return {
    "svix-id": msgId,
    "svix-timestamp": String(timestampSec),
    "svix-signature": `v1,${sig}`,
  };
}

// ─── Fixed test secret and timestamp ─────────────────────────────────────────

// A deterministic whsec_ secret for all tests.
const TEST_SECRET = "whsec_" + Buffer.from("test-webhook-secret-32-bytes!!!!").toString("base64");
const NOW_SEC = Math.floor(Date.now() / 1000);

// ─── Dynamic import of the handler ───────────────────────────────────────────

// We need the handler function from the router, not the router itself.
// Extract it by reaching into the route stack after importing the module.

// Because this test runs with tsx/esm, a top-level import of the router is fine.
import webhooksRouter from "../webhooks.js";

/**
 * Call the registered POST /webhooks/clerk handler directly.
 * This avoids spinning up a real Express server.
 */
async function callHandler(
  req: Record<string, unknown>,
  res: ReturnType<typeof buildReqRes>["res"],
): Promise<void> {
  // Find the single POST layer registered by webhooksRouter.
  const layer = (webhooksRouter as any).stack.find(
    (l: any) => l.route?.path === "/clerk",
  );
  assert.ok(layer, "POST /clerk must be registered on webhooksRouter (mounted at /webhooks → /webhooks/clerk)");
  const handler = layer.route.stack[0].handle;
  // Call the async handler and await it.
  await handler(req, res, () => {});
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /webhooks/clerk", () => {
  let savedSecret: string | undefined;

  beforeEach(() => {
    // Seed a fresh secret before each test.
    savedSecret = process.env.CLERK_WEBHOOK_SECRET;
    process.env.CLERK_WEBHOOK_SECRET = TEST_SECRET;
    // Clear the actor name cache so tests don't bleed into each other.
    actorNameCache.clear();
    // Clear the replay-tracking map so message IDs don't bleed between tests.
    seenMessageIds.clear();
  });

  after(() => {
    // Restore original env var after the suite.
    if (savedSecret !== undefined) {
      process.env.CLERK_WEBHOOK_SECRET = savedSecret;
    } else {
      delete process.env.CLERK_WEBHOOK_SECRET;
    }
  });

  // ── 1. Missing secret env var ─────────────────────────────────────────────

  it("returns 500 when CLERK_WEBHOOK_SECRET is not set", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;

    const body = Buffer.from(JSON.stringify({ type: "user.updated", data: { id: "user_abc" } }));
    const { req, res } = buildReqRes(body, {
      "svix-id": "msg_1",
      "svix-timestamp": String(NOW_SEC),
      "svix-signature": "v1,fakesig",
    });

    await callHandler(req, res);

    assert.strictEqual(res.statusCode, 500);
  });

  // ── 2. Missing Svix headers ───────────────────────────────────────────────

  it("returns 400 when Svix headers are absent", async () => {
    const body = Buffer.from(JSON.stringify({ type: "user.updated", data: { id: "user_abc" } }));
    const { req, res } = buildReqRes(body, {});

    await callHandler(req, res);

    assert.strictEqual(res.statusCode, 400);
  });

  it("returns 400 when only some Svix headers are present", async () => {
    const body = Buffer.from(JSON.stringify({ type: "user.updated", data: { id: "user_abc" } }));
    const { req, res } = buildReqRes(body, {
      "svix-id": "msg_1",
      // missing svix-timestamp and svix-signature
    });

    await callHandler(req, res);

    assert.strictEqual(res.statusCode, 400);
  });

  // ── 3. Invalid signature ──────────────────────────────────────────────────

  it("returns 400 when the Svix signature is invalid", async () => {
    const body = Buffer.from(JSON.stringify({ type: "user.updated", data: { id: "user_abc" } }));
    const { req, res } = buildReqRes(body, {
      "svix-id": "msg_1",
      "svix-timestamp": String(NOW_SEC),
      "svix-signature": "v1,invalidsignature==",
    });

    await callHandler(req, res);

    assert.strictEqual(res.statusCode, 400);
  });

  // ── 4. user.updated evicts the cache entry ────────────────────────────────

  it("evicts the userId from actorNameCache on user.updated and returns 200", async () => {
    const userId = "user_renamed_abc";

    // Seed the cache with an existing entry for this user.
    actorNameCache.set(userId, { name: "Old Name", expiresAt: Date.now() + 300_000 });
    assert.strictEqual(actorNameCache.has(userId), true, "pre-condition: cache entry must exist");

    const rawPayload = JSON.stringify({ type: "user.updated", data: { id: userId } });
    const body = Buffer.from(rawPayload);
    const headers = buildSvixHeaders("msg_update_1", NOW_SEC, body, TEST_SECRET);
    const { req, res } = buildReqRes(body, headers);

    await callHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(
      actorNameCache.has(userId),
      false,
      "actorNameCache entry must be evicted after user.updated webhook",
    );
  });

  it("returns 200 even when userId is not currently in the cache", async () => {
    const userId = "user_not_in_cache";
    assert.strictEqual(actorNameCache.has(userId), false, "pre-condition: cache must be empty");

    const rawPayload = JSON.stringify({ type: "user.updated", data: { id: userId } });
    const body = Buffer.from(rawPayload);
    const headers = buildSvixHeaders("msg_update_2", NOW_SEC, body, TEST_SECRET);
    const { req, res } = buildReqRes(body, headers);

    await callHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    // No error — Map.delete is a no-op when the key is absent.
  });

  it("does not evict other userIds from the cache on user.updated", async () => {
    const targetId = "user_target";
    const otherId = "user_other";

    actorNameCache.set(targetId, { name: "Target", expiresAt: Date.now() + 300_000 });
    actorNameCache.set(otherId, { name: "Other", expiresAt: Date.now() + 300_000 });

    const rawPayload = JSON.stringify({ type: "user.updated", data: { id: targetId } });
    const body = Buffer.from(rawPayload);
    const headers = buildSvixHeaders("msg_update_3", NOW_SEC, body, TEST_SECRET);
    const { req, res } = buildReqRes(body, headers);

    await callHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(actorNameCache.has(targetId), false, "target user must be evicted");
    assert.strictEqual(actorNameCache.has(otherId), true, "other users must NOT be evicted");
  });

  // ── 5. Replay and tampering attacks ──────────────────────────────────────

  it("returns 400 when the identical signed request is delivered a second time (in-window replay)", async () => {
    const rawPayload = JSON.stringify({ type: "user.updated", data: { id: "user_replay_inwindow" } });
    const body = Buffer.from(rawPayload);
    const msgId = "msg_replay_inwindow_1";
    const headers = buildSvixHeaders(msgId, NOW_SEC, body, TEST_SECRET);

    // First delivery — must succeed.
    const { req: req1, res: res1 } = buildReqRes(body, headers);
    await callHandler(req1, res1);
    assert.strictEqual(res1.statusCode, 200, "first delivery must be accepted (200)");

    // Second delivery of the identical signed request — must be rejected.
    const { req: req2, res: res2 } = buildReqRes(body, headers);
    await callHandler(req2, res2);
    assert.strictEqual(
      res2.statusCode,
      400,
      "second delivery of the same svix-id must be rejected with 400 (in-window replay protection)",
    );
  });

  it("returns 400 when the Svix timestamp is stale (timestamp-expiry protection)", async () => {
    // A timestamp 6 minutes in the past falls outside the Svix tolerance window (~5 min).
    const staleTimestamp = NOW_SEC - 6 * 60;

    const rawPayload = JSON.stringify({ type: "user.updated", data: { id: "user_replay" } });
    const body = Buffer.from(rawPayload);
    // Build headers with a valid signature but for the stale timestamp.
    const headers = buildSvixHeaders("msg_replay_1", staleTimestamp, body, TEST_SECRET);
    const { req, res } = buildReqRes(body, headers);

    await callHandler(req, res);

    assert.strictEqual(
      res.statusCode,
      400,
      "stale-timestamp request must be rejected with 400 (replay protection)",
    );
  });

  it("returns 400 when the body has been tampered after signing", async () => {
    // Sign the original payload …
    const originalPayload = JSON.stringify({ type: "user.updated", data: { id: "user_tampered" } });
    const originalBody = Buffer.from(originalPayload);
    const headers = buildSvixHeaders("msg_tamper_1", NOW_SEC, originalBody, TEST_SECRET);

    // … then swap in a different body before sending.
    const tamperedBody = Buffer.from(
      JSON.stringify({ type: "user.updated", data: { id: "user_evil" } }),
    );
    const { req, res } = buildReqRes(tamperedBody, headers);

    await callHandler(req, res);

    assert.strictEqual(
      res.statusCode,
      400,
      "tampered-body request must be rejected with 400 (signature mismatch)",
    );
  });

  // ── 6. Unhandled event types ──────────────────────────────────────────────

  it("returns 200 for unhandled event types without touching the cache", async () => {
    const userId = "user_created_event";
    actorNameCache.set(userId, { name: "Created", expiresAt: Date.now() + 300_000 });

    const rawPayload = JSON.stringify({ type: "user.created", data: { id: userId } });
    const body = Buffer.from(rawPayload);
    const headers = buildSvixHeaders("msg_created_1", NOW_SEC, body, TEST_SECRET);
    const { req, res } = buildReqRes(body, headers);

    await callHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    // user.created should NOT evict the cache — only user.updated does.
    assert.strictEqual(
      actorNameCache.has(userId),
      true,
      "cache must not be touched for non-user.updated events",
    );
  });
});
