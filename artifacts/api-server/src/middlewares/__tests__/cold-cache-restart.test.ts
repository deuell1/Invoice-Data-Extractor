/**
 * Cold-cache restart unit tests for the actorName display-name cache.
 *
 * This file is designed to run in its own process so the module starts with a
 * guaranteed cold cache — exactly as it does after a real server restart.
 * Because `actorNameCache` is module-level state, importing this file in a
 * fresh process means the cache Map is empty from the very first line.
 *
 * The suite verifies three things that only matter when the cache is cold:
 *
 *   1. Post-restart cold cache: the very first resolveActorName call for a
 *      non-system userId hits the Clerk API exactly once and returns the
 *      resolved name.
 *
 *   2. Warm-up after cold miss: after that first call the name is written to
 *      the cache, so a second call for the same userId does NOT hit Clerk again.
 *
 *   3. Restart simulation (cache.clear): clearing the cache mid-run (equivalent
 *      to the process restarting) forces the next call to hit Clerk again, just
 *      like a real restart would.
 *
 * Run directly:
 *   node --test --import tsx/esm src/middlewares/__tests__/cold-cache-restart.test.ts
 *
 * Also invoked by smoke_test.mjs Suite 15.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveActorName, actorNameCache } from "../requireAuth.js";
import type { ClerkUsersClient } from "../requireAuth.js";

// The cache must be completely empty at process start — if this fails it means
// something already warmed the cache before these tests ran, which breaks the
// restart simulation premise.
assert.strictEqual(
  actorNameCache.size,
  0,
  "PRECONDITION: actorNameCache must be empty at process start (cold cache = fresh process)",
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countingClient(
  user: { firstName?: string | null; lastName?: string | null },
  counter: { calls: number },
): ClerkUsersClient {
  return {
    async getUser(_userId: string) {
      counter.calls += 1;
      return user;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("cold-cache restart semantics", () => {
  // NOTE: No beforeEach cache.clear() here — that would defeat the purpose.
  // Tests in this file share state intentionally to model a real server process
  // that starts cold and warms up across successive requests.

  it("1. post-restart cold cache: first call hits Clerk exactly once and returns the resolved name", async () => {
    // Cache must still be empty — this is the very first test and nothing has
    // warmed it yet in this process.
    assert.strictEqual(
      actorNameCache.size,
      0,
      "cache must be cold at the start of the first test (models first request after restart)",
    );

    const counter = { calls: 0 };
    const client = countingClient({ firstName: "Jane", lastName: "Doe" }, counter);

    const name = await resolveActorName("user_cold_start_abc", client);

    assert.strictEqual(
      name,
      "Jane Doe",
      "first post-restart call must return the resolved name from Clerk",
    );
    assert.strictEqual(
      counter.calls,
      1,
      "Clerk API must be called exactly once on the cold-cache first request",
    );
    assert.strictEqual(
      actorNameCache.has("user_cold_start_abc"),
      true,
      "resolved name must be written to cache after cold-cache first request",
    );
  });

  it("2. warm-up after cold miss: second call for the same userId is served from cache without hitting Clerk", async () => {
    // The cache was warmed by the previous test — this models the second request
    // after a restart (cache now has the entry from the first request above).
    assert.strictEqual(
      actorNameCache.has("user_cold_start_abc"),
      true,
      "cache must be warm from the previous test (models second+ request after restart)",
    );

    const counter = { calls: 0 };
    const client = countingClient({ firstName: "Jane", lastName: "Doe" }, counter);

    const name = await resolveActorName("user_cold_start_abc", client);

    assert.strictEqual(name, "Jane Doe", "second call must return the same name");
    assert.strictEqual(
      counter.calls,
      0,
      "Clerk API must NOT be called on the second request — warm-cache hit",
    );
  });

  it("3. restart simulation (cache.clear): clearing the cache forces the next call to re-invoke Clerk", async () => {
    // Simulate a server restart by clearing the in-process cache.
    // After a real restart the Map is recreated fresh by module initialization;
    // .clear() is the closest equivalent in a running process.
    actorNameCache.clear();

    assert.strictEqual(
      actorNameCache.size,
      0,
      "cache must be empty after clear() — simulates in-process-memory wipe on restart",
    );

    const counter = { calls: 0 };
    const client = countingClient({ firstName: "Jane", lastName: "Doe" }, counter);

    const name = await resolveActorName("user_cold_start_abc", client);

    assert.strictEqual(
      name,
      "Jane Doe",
      "first call after simulated restart must return the resolved name from Clerk",
    );
    assert.strictEqual(
      counter.calls,
      1,
      "Clerk API must be called exactly once after the cache is cleared (simulated restart)",
    );
  });

  it("4. system actors are never in the cache regardless of restart state", async () => {
    actorNameCache.clear(); // Simulate restart again.

    const counter = { calls: 0 };
    const client = countingClient({ firstName: "Should", lastName: "Not Be Called" }, counter);

    const smokeResult = await resolveActorName("smoke-test", client);
    const sysResult = await resolveActorName("system-pipeline", client);
    const sysPrefixed = await resolveActorName("system-vendor-matcher", client);

    assert.strictEqual(smokeResult, null, "smoke-test actor: actorName must be null after restart");
    assert.strictEqual(sysResult, null, "system-pipeline actor: actorName must be null after restart");
    assert.strictEqual(sysPrefixed, null, "system-prefixed actors: actorName must be null after restart");
    assert.strictEqual(
      counter.calls,
      0,
      "Clerk API must never be called for system actors — bypass runs before cache lookup",
    );
    assert.strictEqual(
      actorNameCache.size,
      0,
      "system actors must never be written to the cache",
    );
  });
});
