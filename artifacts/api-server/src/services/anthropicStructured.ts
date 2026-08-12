import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared helper for structured JSON calls to the Anthropic Messages API.
 *
 * Uses forced tool-use to enforce the output schema server-side.  The model
 * MUST invoke the named tool; the structured `input` object is returned
 * directly without any JSON.parse or markdown-fence stripping.
 *
 * Key resolution (first match wins):
 *  1. Replit AI Integrations proxy — AI_INTEGRATIONS_ANTHROPIC_BASE_URL +
 *     AI_INTEGRATIONS_ANTHROPIC_API_KEY.  Billed to Replit credits; no personal
 *     quota consumed.  Supports model alias "claude-haiku-4-5" (no date suffix).
 *  2. Direct Anthropic API key — ANTHROPIC_API_KEY.  Uses the pinned dated
 *     snapshot "claude-haiku-4-5-20251001" for accuracy reproducibility.
 *
 * SDK 0.116.0 error-shape notes (must be respected by every call site):
 *  • Use `err.constructor.name` (not `err.name`) to identify SDK error
 *    classes — `.name` is not reliably set on subclasses in this version.
 *  • The request-id field is `err.requestID` (camelCase), not `err.request_id`.
 */

// ── Key helpers (read at call time to stay testable) ────────────────────────
const getIntegrationBaseUrl = () => process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL?.trim();
const getIntegrationApiKey = () => process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY?.trim();
const getDirectApiKey = () => process.env.ANTHROPIC_API_KEY?.trim();

/** True when at least one Anthropic key source is configured. */
export function isAnthropicConfigured(): boolean {
  return Boolean(
    (getIntegrationBaseUrl() && getIntegrationApiKey()) || getDirectApiKey(),
  );
}

/**
 * Resolved model — ANTHROPIC_MODEL env var overrides the default.
 * Integration proxy only accepts the undated alias; direct API uses the pinned
 * dated snapshot for accuracy-harness reproducibility.
 */
export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() ||
  (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL?.trim()
    ? "claude-haiku-4-5"
    : "claude-haiku-4-5-20251001");

/** Request timeout (ms); override with ANTHROPIC_TIMEOUT_MS. */
export const ANTHROPIC_TIMEOUT_MS =
  Number(process.env.ANTHROPIC_TIMEOUT_MS) || 60_000;

export type AnthropicUserContent = Anthropic.MessageParam["content"];

/**
 * Normalize a JSON Schema subtree for Anthropic tool use.
 *
 * Anthropic's tool `input_schema` validator accepts a subset of JSON Schema.
 * Two common patterns must be rewritten:
 *
 * 1. `type: ["string", "null"]` → `anyOf: [{ type: "string" }, { type: "null" }]`
 *    Anthropic requires `anyOf` for nullable fields; array `type` values return 400.
 *
 * 2. `additionalProperties: false` → stripped entirely
 *    Anthropic's validator rejects `additionalProperties` (it's not in its supported
 *    JSON Schema subset). Removing it is safe — Claude respects the schema structure
 *    through forced tool-use without needing explicit rejection of extra keys.
 *
 * This function is applied recursively so nested objects/arrays are also cleaned.
 */
function normalizeAnthropicInputSchema(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return schema;
  if (Array.isArray(schema)) return schema.map(normalizeAnthropicInputSchema);

  const obj = schema as Record<string, unknown>;
  const hasArrayType = "type" in obj && Array.isArray(obj.type);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Array "type" values are replaced with anyOf below.
    if (key === "type" && Array.isArray(value)) continue;
    // additionalProperties is not in Anthropic's supported JSON Schema subset.
    if (key === "additionalProperties") continue;
    result[key] = normalizeAnthropicInputSchema(value);
  }

  if (hasArrayType) {
    result.anyOf = (obj.type as string[]).map((t) => ({ type: t }));
  }

  return result;
}

/**
 * Call Claude with a forced tool and return the tool's `input` object.
 *
 * The caller supplies a JSON Schema via `inputSchema`; the SDK enforces it
 * server-side through tool_choice.  No markdown-fence stripping is needed
 * and none is performed — forced tool-use enforces the schema natively.
 *
 * Throws on any API error or unexpected stop_reason — the caller handles
 * categorisation (see categorizeExtractionError in extractionService.ts).
 */
export async function callAnthropicStructured(params: {
  systemPrompt: string;
  userContent: AnthropicUserContent;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
}): Promise<unknown> {
  // Prefer Replit AI Integrations proxy; fall back to direct API key.
  const integrationBaseUrl = getIntegrationBaseUrl();
  const integrationApiKey = getIntegrationApiKey();
  const directApiKey = getDirectApiKey();

  const apiKey = (integrationBaseUrl && integrationApiKey) ? integrationApiKey : directApiKey;
  if (!apiKey) throw new Error("Anthropic is not configured (no API key found).");

  // Read timeout at call time so ANTHROPIC_TIMEOUT_MS can be changed without
  // redeploying (e.g. temporarily set to 1 in a test to exercise the TIMEOUT path).
  const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS) || 60_000;
  const client = new Anthropic({
    apiKey,
    ...(integrationBaseUrl ? { baseURL: integrationBaseUrl } : {}),
    timeout: timeoutMs,
    maxRetries: 2,
  });

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userContent }],
    tools: [
      {
        name: params.toolName,
        description: params.toolDescription,
        // normalizeAnthropicInputSchema rewrites type:[...] arrays to anyOf so
        // Anthropic's validator accepts schemas authored in standard JSON Schema.
        input_schema: normalizeAnthropicInputSchema(params.inputSchema) as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: params.toolName },
  });

  // Check stop_reason BEFORE reading content — a truncated or refused response
  // must never be silently accepted as a successful extraction.
  const stopReason = response.stop_reason;
  if (stopReason === "max_tokens") {
    throw new Error(
      "Anthropic response was truncated (max_tokens reached). The output schema may be too large for the token budget.",
    );
  }
  if (stopReason === "refusal") {
    throw new Error("Anthropic model declined to process this request.");
  }
  // "tool_use" is the expected stop reason for forced tool calls.
  // "end_turn" is acceptable when the model uses the tool and then ends.
  if (stopReason !== "tool_use" && stopReason !== "end_turn") {
    throw new Error(`Unexpected Anthropic stop_reason: "${String(stopReason)}".`);
  }

  // The tool_use block must be present — no text fallback.
  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Anthropic response contained no tool_use content block.");
  }

  return toolBlock.input;
}
