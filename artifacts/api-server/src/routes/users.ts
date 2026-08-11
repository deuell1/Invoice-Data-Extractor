import { Router, type IRouter } from "express";
import { createClerkClient } from "@clerk/backend";
import { requireRole } from "../middlewares/requireAuth";
import {
  ListUsersResponse,
  PatchUserRoleBody,
} from "@workspace/api-zod";

// The item schema is the element type of the list response array.
const ListUsersResponseItem = ListUsersResponse.element;

const router: IRouter = Router();

function getClerk() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
  return createClerkClient({ secretKey });
}

// ─── GET /settings/users ─────────────────────────────────────────────────────
// Returns all Clerk users with their current AP role (AP_MANAGER only)
router.get(
  "/settings/users",
  requireRole("AP_MANAGER"),
  async (_req, res): Promise<void> => {
    try {
      const clerk = getClerk();
      const { data: users } = await clerk.users.getUserList({ limit: 200 });

      const payload = users.map((u) => {
        const meta = (u.publicMetadata ?? {}) as Record<string, unknown>;
        const role = meta["role"] === "AP_MANAGER" ? "AP_MANAGER" : "AP_CLERK";
        const primaryEmail = u.emailAddresses.find(
          (e) => e.id === u.primaryEmailAddressId,
        )?.emailAddress;
        return {
          userId: u.id,
          email: primaryEmail ?? u.id,
          firstName: u.firstName ?? null,
          lastName: u.lastName ?? null,
          role,
        };
      });

      res.json(ListUsersResponse.parse(payload));
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err?.message ?? "Failed to list users" });
    }
  },
);

// ─── PATCH /settings/users/:userId/role ──────────────────────────────────────
// Updates a user's role in Clerk publicMetadata (AP_MANAGER only)
router.patch(
  "/settings/users/:userId/role",
  requireRole("AP_MANAGER"),
  async (req, res): Promise<void> => {
    const parsed = PatchUserRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const userId = req.params["userId"] as string;
    const { role } = parsed.data;

    try {
      const clerk = getClerk();
      const updated = await clerk.users.updateUserMetadata(userId, {
        publicMetadata: { role },
      });

      const meta = (updated.publicMetadata ?? {}) as Record<string, unknown>;
      const updatedRole =
        meta["role"] === "AP_MANAGER" ? "AP_MANAGER" : "AP_CLERK";
      const primaryEmail = updated.emailAddresses.find(
        (e) => e.id === updated.primaryEmailAddressId,
      )?.emailAddress;

      res.json(
        ListUsersResponseItem.parse({
          userId: updated.id,
          email: primaryEmail ?? updated.id,
          firstName: updated.firstName ?? null,
          lastName: updated.lastName ?? null,
          role: updatedRole,
        }),
      );
    } catch (err: any) {
      const status = err?.status === 404 ? 404 : 500;
      res
        .status(status)
        .json({ error: err?.message ?? "Failed to update user role" });
    }
  },
);

export default router;
