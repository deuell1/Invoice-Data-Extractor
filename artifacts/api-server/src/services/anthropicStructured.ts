import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared helper for structured JSON calls to the Anthropic Messages API.
 *
 * The caller is responsible for a system prompt that instructs the model to
 * return ONLY raw JSON — no markdown fences, no prose.  This helper strips
 * any accidental code-fence wrapping as a belt-and-suspenders measure.
 *
 * SDK 0.116.0 error-shape notes (must be respected by every call site):
 *  • Use `err.constructor.name` (not `err.name`) to identify SDK error
 *    classes — `.name` is not reliably set on subclasses in this version.
 *  • The request-id field is `err.requestID` (camelCase), not `err.request_id`.
 */

/** Pinned default snapshot — never use a bare alias for reproducibility. */
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

/** Resolved model: ANTHROPIC_MODEL env var or the pinned default. */
export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;

/** Request timeout (ms); override with ANTHROPIC_TIMEOUT_MS. */
export const ANTHROPIC_TIMEOUT_MS =
  Number(process.env.ANTHROPIC_TIMEOUT_MS) || 60_000;

export type AnthropicUserContent = Anthropic.MessageParam["content"];

/**
 * Call Claude and return the raw text of the first text-content block.
 * Throws on any API error — the caller handles categorisation.
 */
export async function callAnthropicStructured(params: {
  systemPrompt: string;
  userContent: AnthropicUserContent;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  // Read timeout at call time so ANTHROPIC_TIMEOUT_MS can be changed without
  // redeploying (e.g. temporarily set to 1 in a test to exercise the TIMEOUT path).
  const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS) || 60_000;
  const client = new Anthropic({
    apiKey,
    timeout: timeoutMs,
    maxRetries: 1,
  });

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userContent }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Anthropic response contained no text content block.");
  }

  // Strip markdown code fences in case the model wraps JSON despite instructions.
  const text = block.text.trim();
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fenced ? fenced[1].trim() : text;
}
