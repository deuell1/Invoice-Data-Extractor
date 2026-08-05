import { useUser } from "@clerk/react";

/**
 * Returns the authenticated user's display name for pre-filling actor fields.
 * Prefers full name, falls back to primary email, then user ID.
 */
export function useActorName(): string {
  const { user } = useUser();
  if (!user) return "";
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return fullName || user.primaryEmailAddress?.emailAddress || user.id;
}
