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

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatActorName, resolveActorName } from "../requireAuth.js";
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
});
