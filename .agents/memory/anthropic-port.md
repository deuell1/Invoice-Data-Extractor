---
name: Anthropic port
description: Single-provider Anthropic extraction architecture — key source priority, schema normalization, and integration proxy.
---

## Architecture (post-port, post-integration)

Extraction and detection use only Anthropic (OpenAI fully removed). The client
reads credentials at call time in this priority order:

1. **Replit AI Integrations proxy** — `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` +
   `AI_INTEGRATIONS_ANTHROPIC_API_KEY` (set by `setupReplitAIIntegrations({providerSlug:"anthropic"})`).
   Billed to Replit credits; no personal quota. Proxy URL: `http://localhost:1106/modelfarm/anthropic`.
   Supported model alias: `claude-haiku-4-5` (undated; the proxy maps it).

2. **Direct API key** — `ANTHROPIC_API_KEY`. Uses pinned snapshot `claude-haiku-4-5-20251001`
   for accuracy-harness reproducibility. The ANTHROPIC_API_KEY in secrets is from an account
   that has run out of credits — the integration proxy should be used instead.

`isAnthropicConfigured()` (exported from `anthropicStructured.ts`) checks both sources;
`isExtractionConfigured()` and `isDetectionConfigured()` delegate to it.

## Schema normalization (normalizeAnthropicInputSchema)

Anthropic tool `input_schema` rejects:
- `type: ["string", "null"]` → must be `anyOf: [{type:"string"},{type:"null"}]`
- `additionalProperties: false` → must be stripped entirely

The normalizer in `anthropicStructured.ts` handles both recursively. EXTRACTION_JSON_SCHEMA
is authored in standard JSON Schema (with `as const`); the normalizer fixes it at call time.

## Forced tool-use (P2)

`callAnthropicStructured` uses `tools[{input_schema}]` + `tool_choice:{type:"tool"}`.
Returns `toolBlock.input` directly — no JSON.parse, no markdown fence stripping.
Checks `stop_reason`: throws on `max_tokens`, `refusal`, unexpected values.

## ANTHROPIC_MODEL const vs call-time model

`ANTHROPIC_MODEL` is computed at module load time; if integration URL is set it
uses `claude-haiku-4-5`, else `claude-haiku-4-5-20251001`. Boot log shows whichever
was active at module-load — if the secrets weren't injected yet it may show the dated
version even though call-time `getIntegrationBaseUrl()` returns the correct URL.
The integration proxy accepts both aliases.

**Why:** Integration proxy only lists `claude-haiku-4-5` as supported; dated versions may
or may not be proxied. The proxy accepts the dated alias in practice (smoke tests pass).

**How to apply:** Don't rely on the boot-log model name for correctness — watch the actual
API calls. If a future run sees 400s from the proxy, try setting `ANTHROPIC_MODEL=claude-haiku-4-5`.

## Error categorization

`categorizeExtractionError` now treats billing-related 400s (message contains "credit",
"billing", or "balance") as `PROVIDER_ERROR` rather than `UNKNOWN`.
