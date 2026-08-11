/**
 * Unit tests for requireAuth name resolution helpers.
 *
 * These tests verify that real Clerk user names are stored in audit rows and
 * are NOT silently dropped when name resolution encounters various conditions.
 *
 * Key regression guarded against: a bug where Clerk name resolution fails
 * silently, leaving actorName null even for authenticated real users.  The
 * smoke test cannot catch this because smoke-test requests bypass Clerk
 * entirely (actorName is correctly null for the smoke-test actor).
 *
 * Run via:
 *   node --test --import tsx/esm src/middlewares/__tests__/requireAuth.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { formatActorName, resolveActorName, actorNameCache } from "../requireAuth.js";
import type { ClerkUsersClient } from "../requireAuth.js";

// ─── formatActorName ─────────────────────────────────────────────────────────

describe("formatActorName", () => {
  it("returns 'FirstName LastName' when both are set", () => {
    assert.strictEqual(formatActorName({ firstName: "Jane", lastName: "Doe" }), "Jane Doe");
  });

  it("returns 'FirstName' when only firstName is set", () => {
    assert.strictEqual(formatActorName({ firstName: "Jane", lastName: null }), "Jane");
  });

  it("returns 'LastName' when only lastName is set", () => {
    assert.strictEqual(formatActorName({ firstName: null, lastName: "Doe" }), "Doe");
  });

  it("returns null when both are null", () => {
    assert.strictEqual(formatActorName({ firstName: null, lastName: null }), null);
  });

  it("returns null when both are undefined", () => {
    assert.strictEqual(formatActorName({}), null);
  });

  it("trims whitespace from each part", () => {
    assert.strictEqual(formatActorName({ firstName: "  Jane  ", lastName: "  Doe  " }), "Jane Doe");
  });

  it("returns null when both parts are only whitespace", () => {
    assert.strictEqual(formatActorName({ firstName: "  ", lastName: "  " }), null);
  });
});

// ─── resolveActorName ────────────────────────────────────────────────────────

/**
 * Helper: create a mock ClerkUsersClient that returns a fixed user object.
 */
function mockClerkUsers(user: {
  firstName?: string | null;
  lastName?: string | null;
}): ClerkUsersClient {
  return {
    async getUser(_userId: string) {
      return user;
    },
  };
}

/**
 * Helper: create a mock ClerkUsersClient whose getUser always throws.
 */
function mockClerkUsersThrows(message = "Clerk API error"): ClerkUsersClient {
  return {
    async getUser(_userId: string) {
      throw new Error(message);
    },
  };
}

describe("resolveActorName", () => {
  // Clear the shared cache before every test so no prior result leaks across cases.
  beforeEach(() => {
    actorNameCache.clear();
  });

  // ── The critical regression test ────────────────────────────────────────────
  // This is the primary test this task exists to create:
  // when a real Clerk user's profile is available, actorName MUST NOT be null.

  it("returns a non-null name for a real authenticated Clerk user — regression guard", async () => {
    const mockUsers = mockClerkUsers({ firstName: "Jane", lastName: "Doe" });

    const name = await resolveActorName("user_real_abc123", mockUsers);

    // This assertion fails if name resolution silently drops the Clerk name,
    // which is exactly the regression this test is designed to catch.
    assert.notStrictEqual(
      name,
      null,
      "actorName must not be null for a real authenticated Clerk user — " +
        "silent name-drop regression detected",
    );
    assert.strictEqual(
      name,
      "Jane Doe",
      "actorName must equal the Clerk user's full display name",
    );
  });

  it("returns firstName only when lastName is absent", async () => {
    const mockUsers = mockClerkUsers({ firstName: "Alice", lastName: null });
    const name = await resolveActorName("user_abc", mockUsers);
    assert.notStrictEqual(name, null, "actorName must not be null when firstName is available");
    assert.strictEqual(name, "Alice");
  });

  it("returns null (not an error) when the Clerk API throws", async () => {
    // A Clerk API failure must never block the authenticated request —
    // actorName becomes null but the action still succeeds.
    const mockUsers = mockClerkUsersThrows("network timeout");
    const name = await resolveActorName("user_abc", mockUsers);
    assert.strictEqual(
      name,
      null,
      "actorName should be null when Clerk API throws — request must not be blocked",
    );
  });

  it("returns null for the 'smoke-test' actor without calling Clerk", async () => {
    let called = false;
    const trackingClient: ClerkUsersClient = {
      async getUser(_userId) {
        called = true;
        return { firstName: "Should", lastName: "Not Be Called" };
      },
    };

    const name = await resolveActorName("smoke-test", trackingClient);
    assert.strictEqual(name, null, "smoke-test actor has no Clerk profile");
    assert.strictEqual(called, false, "Clerk API must not be called for smoke-test actor");
  });

  it("returns null for the 'system-pipeline' actor without calling Clerk", async () => {
    let called = false;
    const trackingClient: ClerkUsersClient = {
      async getUser(_userId) {
        called = true;
        return { firstName: "Should", lastName: "Not Be Called" };
      },
    };

    const name = await resolveActorName("system-pipeline", trackingClient);
    assert.strictEqual(name, null, "system-pipeline actor has no Clerk profile");
    assert.strictEqual(called, false, "Clerk API must not be called for system-pipeline actor");
  });

  it("returns null for arbitrary system-prefixed actors", async () => {
    const mockUsers = mockClerkUsers({ firstName: "Should", lastName: "Not Appear" });
    const name = await resolveActorName("system-vendor-matcher", mockUsers);
    assert.strictEqual(name, null, "system-prefixed actors have no Clerk profile");
  });

  it("returns null when no Clerk client is injected and CLERK_SECRET_KEY is unset", async () => {
    // Save and unset the env var so the fallback path returns null.
    const saved = process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_SECRET_KEY;

    try {
      // No clerkUsers injected — falls back to env-based creation.
      const name = await resolveActorName("user_real_xyz");
      assert.strictEqual(
        name,
        null,
        "actorName must be null (not throw) when CLERK_SECRET_KEY is absent",
      );
    } finally {
      if (saved !== undefined) process.env.CLERK_SECRET_KEY = saved;
    }
  });

  // ── Timeout / race tests ────────────────────────────────────────────────────

  it("returns null when the Clerk API responds slower than CLERK_NAME_TIMEOUT_MS", async () => {
    // Set a very short timeout so the test runs quickly without real waiting.
    const savedTimeout = process.env.CLERK_NAME_TIMEOUT_MS;
    process.env.CLERK_NAME_TIMEOUT_MS = "50"; // 50 ms timeout

    // This mock takes 300 ms — far longer than the 50 ms timeout.
    const slowClient: ClerkUsersClient = {
      async getUser(_userId) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { firstName: "Slow", lastName: "Response" };
      },
    };

    try {
      const start = Date.now();
      const name = await resolveActorName("user_timeout_test", slowClient);
      const elapsed = Date.now() - start;

      assert.strictEqual(
        name,
        null,
        "resolveActorName must return null when the Clerk API exceeds the timeout",
      );
      // Should resolve well under the slow client's 300 ms delay.
      assert.ok(
        elapsed < 250,
        `resolveActorName should have timed out quickly but took ${elapsed} ms`,
      );
    } finally {
      if (savedTimeout !== undefined) process.env.CLERK_NAME_TIMEOUT_MS = savedTimeout;
      else delete process.env.CLERK_NAME_TIMEOUT_MS;
    }
  });

  it("returns the formatted name when the Clerk API responds within CLERK_NAME_TIMEOUT_MS", async () => {
    // Set a generous timeout — the fast mock will finish well within it.
    const savedTimeout = process.env.CLERK_NAME_TIMEOUT_MS;
    process.env.CLERK_NAME_TIMEOUT_MS = "200"; // 200 ms timeout

    // This mock returns immediately (no artificial delay).
    const fastClient: ClerkUsersClient = {
      async getUser(_userId) {
        return { firstName: "Fast", lastName: "User" };
      },
    };

    try {
      const name = await resolveActorName("user_fast_test", fastClient);

      assert.strictEqual(
        name,
        "Fast User",
        "resolveActorName must return the formatted name when the Clerk API responds in time",
      );
    } finally {
      if (savedTimeout !== undefined) process.env.CLERK_NAME_TIMEOUT_MS = savedTimeout;
      else delete process.env.CLERK_NAME_TIMEOUT_MS;
    }
  });
});

// ─── actorNameCache (TTL cache) ───────────────────────────────────────────────

describe("actorNameCache — resolveActorName caching behaviour", () => {
  // Clear the shared cache before every test so cases are fully independent.
  beforeEach(() => {
    actorNameCache.clear();
  });

  it("returns the cached name on a second call without hitting Clerk again", async () => {
    let callCount = 0;
    const countingClient: ClerkUsersClient = {
      async getUser(_userId) {
        callCount += 1;
        return { firstName: "Jane", lastName: "Doe" };
      },
    };

    const userId = "user_cache_hit_test";
    const first = await resolveActorName(userId, countingClient);
    const second = await resolveActorName(userId, countingClient);

    assert.strictEqual(first, "Jane Doe", "first call should return the name");
    assert.strictEqual(second, "Jane Doe", "second call should return the same name");
    assert.strictEqual(callCount, 1, "Clerk API must be called exactly once — cache hit on second call");
  });

  it("calls Clerk again after the cache entry has expired", async () => {
    let callCount = 0;
    const countingClient: ClerkUsersClient = {
      async getUser(_userId) {
        callCount += 1;
        return { firstName: "Bob", lastName: "Smith" };
      },
    };

    const userId = "user_ttl_expiry_test";

    // Seed the cache with an already-expired entry (expiresAt in the past).
    actorNameCache.set(userId, { name: "Stale Name", expiresAt: Date.now() - 1 });

    const name = await resolveActorName(userId, countingClient);

    assert.strictEqual(name, "Bob Smith", "should return freshly resolved name after expiry");
    assert.strictEqual(callCount, 1, "Clerk API must be called once after expiry");
  });

  it("different userIds are cached independently", async () => {
    let callCount = 0;
    const countingClient: ClerkUsersClient = {
      async getUser(userId) {
        callCount += 1;
        return userId === "user_a" ? { firstName: "Alice" } : { firstName: "Bob" };
      },
    };

    const nameA1 = await resolveActorName("user_a", countingClient);
    const nameB1 = await resolveActorName("user_b", countingClient);
    const nameA2 = await resolveActorName("user_a", countingClient); // cache hit
    const nameB2 = await resolveActorName("user_b", countingClient); // cache hit

    assert.strictEqual(nameA1, "Alice");
    assert.strictEqual(nameB1, "Bob");
    assert.strictEqual(nameA2, "Alice", "user_a name cached correctly");
    assert.strictEqual(nameB2, "Bob", "user_b name cached independently");
    assert.strictEqual(callCount, 2, "Clerk must only be called once per distinct userId");
  });

  it("evicts the oldest entry when the cache is at capacity", async () => {
    // Override the cache max to 2 so we can hit the eviction path easily.
    const savedMax = process.env.CLERK_NAME_CACHE_MAX;
    process.env.CLERK_NAME_CACHE_MAX = "2";

    try {
      const client: ClerkUsersClient = {
        async getUser(userId) {
          return { firstName: userId };
        },
      };

      await resolveActorName("user_oldest", client); // entry 1 (oldest)
      await resolveActorName("user_middle", client); // entry 2
      // Adding entry 3 should evict "user_oldest" (first in insertion order).
      await resolveActorName("user_newest", client); // entry 3

      assert.strictEqual(actorNameCache.size, 2, "cache must not exceed the configured max");
      assert.strictEqual(
        actorNameCache.has("user_oldest"),
        false,
        "the oldest entry must have been evicted",
      );
      assert.strictEqual(actorNameCache.has("user_middle"), true);
      assert.strictEqual(actorNameCache.has("user_newest"), true);
    } finally {
      if (savedMax !== undefined) process.env.CLERK_NAME_CACHE_MAX = savedMax;
      else delete process.env.CLERK_NAME_CACHE_MAX;
    }
  });

  it("system actors are never stored in the cache", async () => {
    await resolveActorName("smoke-test");
    await resolveActorName("system-pipeline");
    await resolveActorName("system-vendor-matcher");

    assert.strictEqual(
      actorNameCache.size,
      0,
      "system/smoke-test actors must never be cached",
    );
  });
});
