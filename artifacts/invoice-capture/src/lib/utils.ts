import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Extract a human-readable message from a thrown API error, if available. */
export function getApiErrorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { status?: number; data?: { error?: string }; message?: string };
    if (err.data?.error) return err.data.error;
    if (err.message) return err.message;
  }
  return "";
}
