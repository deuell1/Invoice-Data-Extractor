import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Compute a SHA-256 hex digest of a browser File using the Web Crypto API.
 * Produces the same lowercase-hex string as Node's
 * `crypto.createHash("sha256").update(buffer).digest("hex")` for identical
 * bytes — plain SHA-256 over raw bytes, no salting or encoding differences.
 */
export async function hashFileSha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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
