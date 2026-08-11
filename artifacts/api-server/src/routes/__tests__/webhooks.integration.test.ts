/**
 * App-level integration tests for POST /webhooks/clerk
 *
 * These tests spin up the real Express app (via supertest) to verify that the
 * webhook endpoint is reachable at the correct public URL, that the raw-body
 * parser is in place for Svix signature verification, and that a valid signed
 * user.updated payload evicts the matching actorNameCache entry.
 *
 * Run via:
 *   node --test --import tsx/esm src/routes/__tests__/webhooks.integration.test.ts
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import request from "supertest";

import app from "../../app.js";
import { actorNameCache } from "../../middlewares/requireAuth.js";

// ─── Fixed test secret ────────────────────────────────────────────────────────

const TEST_SECRET =
  "whsec_" + Buffer.from("test-webhook-secret-32-bytes!!!!").toString("base64");
const NOW_SEC = Math.floor(Date.now() / 1000);

// ─── Svix header builder ──────────────────────────────────────────────────────

function buildSvixHeaders(
  msgId: string,
  timestampSec: number,
  rawBody: string,
  secret: string,
): Record<string, string> {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const toSign = `${msgId}.${timestampSec}.${rawBody}`;
  const sig = createHmac("sha256", secretBytes).update(toSign).digest("base64");
  return {
    "svix-id": msgId,
    "svix-timestamp": String(timestampSec),
    "svix-signature": `v1,${sig}`,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /webhooks/clerk — app-level integration", () => {
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env.CLERK_WEBHOOK_SECRET;
    process.env.CLERK_WEBHOOK_SECRET = TEST_SECRET;
    actorNameCache.clear();
  });

  after(() => {
    if (savedSecret !== undefined) {
      process.env.CLERK_WEBHOOK_SECRET = savedSecret;
    } else {
      delete process.env.CLERK_WEBHOOK_SECRET;
    }
  });

  it("POST /webhooks/clerk is reachable and returns 200 for a valid user.updated payload", async () => {
    const userId = "user_integration_test_abc";
    actorNameCache.set(userId, { name: "Old Name", expiresAt: Date.now() + 300_000 });

    const body = JSON.stringify({ type: "user.updated", data: { id: userId } });
    const headers = buildSvixHeaders("msg_int_1", NOW_SEC, body, TEST_SECRET);

    const res = await request(app)
      .post("/webhooks/clerk")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    assert.strictEqual(res.status, 200, `expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.deepStrictEqual(res.body, { received: true });

    // The cache entry for this userId must have been evicted.
    assert.strictEqual(
      actorNameCache.has(userId),
      false,
      "actorNameCache entry must be evicted after a valid user.updated webhook",
    );
  });

  it("returns 400 for a request with a tampered body (invalid signature)", async () => {
    const originalBody = JSON.stringify({ type: "user.updated", data: { id: "user_tampered" } });
    const headers = buildSvixHeaders("msg_tamper_1", NOW_SEC, originalBody, TEST_SECRET);

    // Send a different body than the one that was signed.
    const tamperedBody = JSON.stringify({ type: "user.updated", data: { id: "user_attacker" } });

    const res = await request(app)
      .post("/webhooks/clerk")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(tamperedBody);

    assert.strictEqual(res.status, 400);
  });

  it("returns 400 when Svix headers are missing entirely", async () => {
    const body = JSON.stringify({ type: "user.updated", data: { id: "user_no_headers" } });

    const res = await request(app)
      .post("/webhooks/clerk")
      .set("Content-Type", "application/json")
      .send(body);

    assert.strictEqual(res.status, 400);
  });
});
