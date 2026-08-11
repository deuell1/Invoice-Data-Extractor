---
name: Anthropic extraction port
description: How the Anthropic Claude path for invoice extraction and detection works, and SDK gotchas.
---

# Anthropic extraction + detection port

## What was built
- `artifacts/api-server/src/services/anthropicStructured.ts` — shared helper `callAnthropicStructured()`.
- `extractionService.ts` — `anthropicExtract()` added; `runExtraction()` branches on `EXTRACTION_PROVIDER`.
- `documentDetectionService.ts` — `detectPdfAnthropic()` / `detectImageAnthropic()` added; both detect functions branch on `EXTRACTION_PROVIDER`.

## Active provider env vars
- `EXTRACTION_PROVIDER=anthropic` (default path now)
- `ANTHROPIC_MODEL=claude-haiku-4-5-20251001`
- `ANTHROPIC_TIMEOUT_MS=60000` (read at **call time**, not module init, so changing env + restart applies immediately)
- `OPENAI_API_KEY` still needed only when `EXTRACTION_PROVIDER=openai`

## SDK 0.116.0 gotchas
- **Error constructor name, not `.name`**: `err.constructor.name` is `"APIConnectionTimeoutError"` when a 1ms timeout fires; `err.name` is just `"Error"`. Using `.name` misses the timeout. `categorizeExtractionError` uses `constructor.name`.
- **`requestID` is camelCase**: `err.requestID` (not `err.request_id`). For a timeout that never reached the server, `requestID` is undefined — expected.
- **`document` / `image` content blocks**: not in the narrow TS union at the push site; cast via `(userContent as unknown[]).push(...)`.
- **Strict JSON not native**: append JSON-only instruction to system prompt for Claude since it doesn't enforce a schema natively.

## Timeout classification (categorizeExtractionError)
- `constructor.name === "APIConnectionTimeoutError"` → TIMEOUT ✓ (verified live)
- `constructor.name === "APITimeoutError"` → TIMEOUT (alternate SDK spelling)
- `err.name === "AbortError"` → TIMEOUT (browser AbortController)
- 401/403 → PROVIDER_ERROR; 429 → PROVIDER_ERROR; ≥500 → PROVIDER_ERROR; else → UNKNOWN

## Accuracy verified
Suite 11 with Claude: **100% (35/35 fields)** against the OpenAI-baselined snapshot on the first run. No snapshot update needed.

**Why:** Claude Haiku is strong enough on structured invoice extraction that its output matches OpenAI's field-for-field on the EG-1 test pack.
