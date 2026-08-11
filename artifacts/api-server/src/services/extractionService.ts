import { db, invoiceCaptureTable, invoiceAuditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { applyVendorMatch } from "./vendorMatcher";
import { validateInvoice } from "./validationService";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractPdfPageRange } from "../lib/pdfUtils";
import { callAnthropicStructured } from "./anthropicStructured";
import type { AnthropicUserContent } from "./anthropicStructured";

/**
 * Extraction service.
 *
 * When OPENAI_API_KEY is configured, real extraction runs against the uploaded
 * document using the OpenAI Responses API with Structured Outputs (a strict
 * JSON schema). Until then, a deterministic development mock produces plausible
 * field values so the full pipeline (review, vendor matching, exception routing)
 * can be exercised end-to-end without the key.
 *
 * The service NEVER assigns a vendorId directly — it only produces a
 * vendorRawName, which is then run through the controlled vendor matching
 * pipeline. The API key is read only from the environment and is never logged
 * or returned to clients.
 */

/** Internal field-confidence keys (the names the review UI understands). */
export type FieldConfidence = {
  vendorRawName: number;
  invoiceNumber: number;
  invoiceDate: number;
  dueDate: number;
  paymentTerms: number;
  poNumber: number;
  subtotal: number;
  taxAmount: number;
  freightAmount: number;
  discountAmount: number;
  otherChargesAmount: number;
  totalAmount: number;
  currency: number;
};

export type ExtractedFields = {
  vendorRawName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  taxAmount: number | null;
  subtotal: number | null;
  freightAmount: number | null;
  discountAmount: number | null;
  otherChargesAmount: number | null;
  poNumber: string | null;
  currency: string | null;
  paymentTerms: string | null;
  /** Overall extraction confidence, normalized to [0, 1] for storage. */
  confidenceScore: number;
  /** Field names (internal) whose confidence is below the 85 threshold. */
  lowConfidenceFields: string[];
  /** Per-field confidence, 0-100, keyed by internal field name. */
  fieldConfidence: FieldConfidence;
  /** Free-form extraction notes from the model (e.g. which total was chosen). */
  extractionNotes: string | null;
  /** Raw provider JSON response, persisted verbatim for audit/troubleshooting. */
  rawExtraction: string;
};

export function isExtractionConfigured(): boolean {
  const provider = (process.env.EXTRACTION_PROVIDER ?? "openai").toLowerCase();
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Coarse failure categories used for troubleshooting (never user secrets). */
export type ExtractionFailureCategory =
  | "UNSUPPORTED_FILE"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "PROVIDER_ERROR"
  | "UNKNOWN";

/**
 * Typed extraction failure carrying a coarse category and a SAFE, user-facing
 * message. The message is persisted on the invoice and shown in the UI, so it
 * must never contain the API key, auth headers, request internals, or raw
 * provider payloads.
 */
export class ExtractionError extends Error {
  category: ExtractionFailureCategory;
  constructor(category: ExtractionFailureCategory, message: string) {
    super(message);
    this.name = "ExtractionError";
    this.category = category;
  }
}

/** Maximum document size accepted for automatic extraction (bytes). */
const MAX_EXTRACTION_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/** Extraction request timeout (ms); override with OPENAI_TIMEOUT_MS. */
const EXTRACTION_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS) || 60_000;

/** Confidence threshold (0-100 scale) below which a field is "low confidence". */
const LOW_CONFIDENCE_THRESHOLD = 85;

/** Derive the internal lowConfidenceFields list from per-field confidence. */
function deriveLowConfidenceFields(fc: FieldConfidence): string[] {
  return (Object.keys(fc) as Array<keyof FieldConfidence>).filter(
    (k) => fc[k] < LOW_CONFIDENCE_THRESHOLD,
  );
}

// ─── Deterministic mock extraction ──────────────────────────────────────────
// Seeds values from the invoice id + filename so results are stable per invoice
// (re-running extraction yields the same data, which keeps tests predictable).

const MOCK_VENDORS = [
  "Acme Office Supplies",
  "FastFreight Logistics",
  "TechParts Global",
  "Globex Industrial Supply",
];

function seededInt(seed: number, min: number, max: number): number {
  const x = Math.sin(seed) * 10000;
  const frac = x - Math.floor(x);
  return min + Math.floor(frac * (max - min + 1));
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function mockExtract(invoiceId: number, fileName: string): ExtractedFields {
  const seed = invoiceId + fileName.length;
  const vendorRawName = MOCK_VENDORS[seededInt(seed, 0, MOCK_VENDORS.length - 1)];

  const subtotal = seededInt(seed * 3, 500, 25000) + seededInt(seed * 7, 0, 99) / 100;
  const taxAmount = Math.round(subtotal * 0.08 * 100) / 100;
  const freightAmount = seededInt(seed * 11, 0, 250);
  const totalAmount = Math.round((subtotal + taxAmount + freightAmount) * 100) / 100;

  const year = 2026;
  const month = seededInt(seed * 13, 1, 12);
  const day = seededInt(seed * 17, 1, 28);
  const invoiceDate = `${year}-${pad(month, 2)}-${pad(day, 2)}`;
  const dueMonth = month === 12 ? 1 : month + 1;
  const dueYear = month === 12 ? year + 1 : year;
  const dueDate = `${dueYear}-${pad(dueMonth, 2)}-${pad(day, 2)}`;

  const invoiceNumber = `INV-${seededInt(seed * 19, 10000, 99999)}`;
  const poNumber = `PO-${seededInt(seed * 23, 1000, 9999)}`;

  // Simulate variable extraction quality so confidence-based routing can be tested.
  const overall = seededInt(seed * 29, 70, 99); // 0-100
  const lowFields = overall < LOW_CONFIDENCE_THRESHOLD;
  const fieldConfidence: FieldConfidence = {
    vendorRawName: overall,
    invoiceNumber: overall,
    invoiceDate: lowFields ? 60 : overall,
    dueDate: overall,
    paymentTerms: overall,
    poNumber: overall,
    subtotal: overall,
    taxAmount: overall,
    freightAmount: overall,
    discountAmount: overall,
    otherChargesAmount: overall,
    totalAmount: lowFields ? 62 : overall,
    currency: 99,
  };

  const rawExtraction = JSON.stringify({
    _source: "development-mock",
    vendorRawName,
    invoiceNumber,
    invoiceDate,
    dueDate,
    paymentTerms: "Net 30",
    poNumberRaw: poNumber,
    subtotal,
    taxAmount,
    freightAmount,
    discountAmount: null,
    otherChargesAmount: null,
    invoiceTotal: totalAmount,
    amountDue: totalAmount,
    currency: "USD",
    extractionConfidence: overall,
    fieldConfidence,
    extractionNotes: "Generated by deterministic development mock (no API key).",
  });

  return {
    vendorRawName,
    invoiceNumber,
    invoiceDate,
    dueDate,
    totalAmount,
    taxAmount,
    subtotal,
    freightAmount,
    discountAmount: null,
    otherChargesAmount: null,
    poNumber,
    currency: "USD",
    paymentTerms: "Net 30",
    confidenceScore: overall / 100,
    lowConfidenceFields: deriveLowConfidenceFields(fieldConfidence),
    fieldConfidence,
    extractionNotes: "Generated by deterministic development mock (no API key).",
    rawExtraction,
  };
}

// ─── Live OpenAI extraction ─────────────────────────────────────────────────
// Lazy-imports the SDK so the app never requires the package to boot. The key
// is read only from the environment and is never logged or returned to clients.

const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

/** Default to a current vision-capable model; override with OPENAI_MODEL. */
const DEFAULT_MODEL = "gpt-4o";

/** Best-effort content type from a filename when storage metadata is absent. */
function inferContentType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

/**
 * Coerce a possibly-stringy numeric field into a number or null. Strips currency
 * symbols, thousands separators, and whitespace. Parentheses denote a negative
 * value — "(1,234.56)" → -1234.56 — as do leading/embedded minus signs. Blank or
 * unparseable input returns null (never 0) so "missing" stays distinct from "zero".
 */
function toNum(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (s === "") return null;
  // Accounting-style negatives: parentheses around the amount.
  let negative = /^\(.*\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  // A minus sign anywhere also marks the value negative.
  if (s.includes("-")) negative = true;
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Clamp a 0-100 confidence into that range; default to a neutral 50. */
function clampPct(value: unknown): number {
  const n = toNum(value);
  if (n == null) return 50;
  return Math.min(100, Math.max(0, n));
}

/**
 * Translate any extraction failure into a coarse category and a safe,
 * user-facing message. Never include the API key, auth headers, request
 * internals, or raw provider payloads here — the returned message is persisted
 * to the invoice and shown in the UI.
 */
function categorizeExtractionError(err: unknown): {
  category: ExtractionFailureCategory;
  message: string;
} {
  // Already-categorized failures (unsupported file, invalid response, etc.).
  if (err instanceof ExtractionError) {
    return { category: err.category, message: err.message };
  }

  // Timeouts/aborts from the SDK or our own timeout guard.
  // SDK 0.116.0: use constructor.name — .name is not reliably set on subclasses.
  const constructorName = (err as { constructor?: { name?: string } })?.constructor?.name;
  const name = (err as { name?: string })?.name;
  if (
    constructorName === "APIConnectionTimeoutError" ||
    constructorName === "APITimeoutError" ||
    name === "AbortError"
  ) {
    return {
      category: "TIMEOUT",
      message: "Automatic extraction timed out. Please retry.",
    };
  }

  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return {
      category: "PROVIDER_ERROR",
      message: "Extraction service authentication failed. Please verify the service configuration.",
    };
  }
  if (status === 429) {
    return {
      category: "PROVIDER_ERROR",
      message: "Extraction service is busy (rate limited). Please retry in a moment.",
    };
  }
  if (status != null && status >= 500) {
    return {
      category: "PROVIDER_ERROR",
      message: "Extraction service is temporarily unavailable. Please retry shortly.",
    };
  }
  return {
    category: "UNKNOWN",
    message: "Automatic extraction failed. You can retry, or enter the invoice fields manually.",
  };
}

/**
 * Strict JSON schema for Structured Outputs. Every property is required and
 * nullable values use a union type so the model returns a predictable shape.
 */
const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "vendorRawName",
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "paymentTerms",
    "poNumberRaw",
    "subtotal",
    "taxAmount",
    "freightAmount",
    "discountAmount",
    "otherChargesAmount",
    "invoiceTotal",
    "amountDue",
    "currency",
    "extractionConfidence",
    "fieldConfidence",
    "lowConfidenceFields",
    "extractionNotes",
  ],
  properties: {
    vendorRawName: { type: ["string", "null"] },
    invoiceNumber: { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
    dueDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
    paymentTerms: { type: ["string", "null"] },
    poNumberRaw: { type: ["string", "null"] },
    subtotal: { type: ["number", "null"] },
    taxAmount: { type: ["number", "null"] },
    freightAmount: { type: ["number", "null"] },
    discountAmount: { type: ["number", "null"] },
    otherChargesAmount: { type: ["number", "null"] },
    invoiceTotal: { type: ["number", "null"] },
    amountDue: { type: ["number", "null"] },
    currency: { type: "string" },
    extractionConfidence: { type: "number", description: "0-100" },
    fieldConfidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "vendorRawName",
        "invoiceNumber",
        "invoiceDate",
        "dueDate",
        "paymentTerms",
        "poNumberRaw",
        "subtotal",
        "taxAmount",
        "freightAmount",
        "discountAmount",
        "otherChargesAmount",
        "invoiceTotal",
        "amountDue",
        "currency",
      ],
      properties: {
        vendorRawName: { type: "number" },
        invoiceNumber: { type: "number" },
        invoiceDate: { type: "number" },
        dueDate: { type: "number" },
        paymentTerms: { type: "number" },
        poNumberRaw: { type: "number" },
        subtotal: { type: "number" },
        taxAmount: { type: "number" },
        freightAmount: { type: "number" },
        discountAmount: { type: "number" },
        otherChargesAmount: { type: "number" },
        invoiceTotal: { type: "number" },
        amountDue: { type: "number" },
        currency: { type: "number" },
      },
    },
    lowConfidenceFields: { type: "array", items: { type: "string" } },
    extractionNotes: { type: ["string", "null"] },
  },
} as const;

const SYSTEM_PROMPT =
  "You are an accounts-payable invoice extraction engine. Read the attached " +
  "invoice document and return ONLY the header data described by the JSON schema. " +
  "Rules: extract accounts-payable invoice header data only; do NOT invent missing " +
  "values — use null when a field is not visible (never guess 0); NEVER assign a vendor id or GL " +
  "account; normalize dates to YYYY-MM-DD; normalize amounts as plain numbers with " +
  "two decimals (strip currency symbols and thousands separators; a value shown in " +
  "parentheses or with a leading minus sign is negative); currency is USD unless " +
  "the invoice clearly shows another currency; capture the PO number if visible; " +
  "extract subtotal, tax amount, freight/shipping amount, discount amount, and other " +
  "charges/fees/surcharges in addition to the invoice total; report discountAmount as a " +
  "positive number representing the discount or credit reduction; report otherChargesAmount " +
  "for miscellaneous charges, fees, or surcharges (use a negative value only for a credit); " +
  "leave any amount null ONLY when it is not shown on the invoice at all — a printed " +
  "zero amount (e.g. 'Sales Tax $0.00', 'TAXES 0.00', 'Freight 0.00') IS a shown value " +
  "and must be returned as 0.00, never as null; all " +
  "confidence scores are 0 to 100; the low-confidence threshold is 85; if multiple " +
  "totals appear, select the final amount due / total payable for amountDue and explain " +
  "briefly in extractionNotes; capture vendorRawName and invoiceNumber EXACTLY as printed " +
  "on the document — no normalization, no stripping of leading zeros, no substitution of " +
  "trade name for legal name.";

type RawModelOutput = {
  vendorRawName?: unknown;
  invoiceNumber?: unknown;
  invoiceDate?: unknown;
  dueDate?: unknown;
  paymentTerms?: unknown;
  poNumberRaw?: unknown;
  subtotal?: unknown;
  taxAmount?: unknown;
  freightAmount?: unknown;
  discountAmount?: unknown;
  otherChargesAmount?: unknown;
  invoiceTotal?: unknown;
  amountDue?: unknown;
  currency?: unknown;
  extractionConfidence?: unknown;
  fieldConfidence?: Record<string, unknown>;
  extractionNotes?: unknown;
};

/** Top-level keys the model MUST return per the strict JSON schema. */
const REQUIRED_MODEL_KEYS = [
  "vendorRawName",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "paymentTerms",
  "poNumberRaw",
  "subtotal",
  "taxAmount",
  "freightAmount",
  "discountAmount",
  "otherChargesAmount",
  "invoiceTotal",
  "amountDue",
  "currency",
  "extractionConfidence",
  "fieldConfidence",
  "lowConfidenceFields",
  "extractionNotes",
] as const;

/**
 * Validate that parsed JSON matches the expected extraction shape. A response
 * can be valid JSON yet structurally wrong (e.g. `{}` or missing fields); such
 * payloads must be treated as INVALID_RESPONSE rather than silently accepted as
 * a successful extraction. Throws ExtractionError on any mismatch.
 */
function assertValidModelShape(parsed: unknown): asserts parsed is RawModelOutput {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExtractionError(
      "INVALID_RESPONSE",
      "Automatic extraction returned an unexpected result. You can retry or enter the fields manually.",
    );
  }
  const obj = parsed as Record<string, unknown>;
  const missing = REQUIRED_MODEL_KEYS.filter((k) => !(k in obj));
  if (missing.length > 0) {
    throw new ExtractionError(
      "INVALID_RESPONSE",
      "Automatic extraction returned incomplete data. You can retry or enter the fields manually.",
    );
  }
  if (obj.fieldConfidence == null || typeof obj.fieldConfidence !== "object") {
    throw new ExtractionError(
      "INVALID_RESPONSE",
      "Automatic extraction returned incomplete data. You can retry or enter the fields manually.",
    );
  }
}

function mapModelOutput(parsed: RawModelOutput, rawExtraction: string): ExtractedFields {
  const fc = parsed.fieldConfidence ?? {};

  const invoiceTotal = toNum(parsed.invoiceTotal);
  const amountDue = toNum(parsed.amountDue);
  // Prefer the final amount due / total payable; fall back to the invoice total.
  const totalAmount = amountDue ?? invoiceTotal;
  const totalConfidence = clampPct(amountDue != null ? fc.amountDue : fc.invoiceTotal);

  const fieldConfidence: FieldConfidence = {
    vendorRawName: clampPct(fc.vendorRawName),
    invoiceNumber: clampPct(fc.invoiceNumber),
    invoiceDate: clampPct(fc.invoiceDate),
    dueDate: clampPct(fc.dueDate),
    paymentTerms: clampPct(fc.paymentTerms),
    poNumber: clampPct(fc.poNumberRaw),
    subtotal: clampPct(fc.subtotal),
    taxAmount: clampPct(fc.taxAmount),
    freightAmount: clampPct(fc.freightAmount),
    discountAmount: clampPct(fc.discountAmount),
    otherChargesAmount: clampPct(fc.otherChargesAmount),
    totalAmount: totalConfidence,
    currency: clampPct(fc.currency),
  };

  return {
    vendorRawName: parsed.vendorRawName != null ? String(parsed.vendorRawName) : null,
    invoiceNumber: parsed.invoiceNumber != null ? String(parsed.invoiceNumber) : null,
    invoiceDate: parsed.invoiceDate != null ? String(parsed.invoiceDate) : null,
    dueDate: parsed.dueDate != null ? String(parsed.dueDate) : null,
    totalAmount,
    taxAmount: toNum(parsed.taxAmount),
    subtotal: toNum(parsed.subtotal),
    freightAmount: toNum(parsed.freightAmount),
    discountAmount: toNum(parsed.discountAmount),
    otherChargesAmount: toNum(parsed.otherChargesAmount),
    poNumber: parsed.poNumberRaw != null ? String(parsed.poNumberRaw) : null,
    currency: parsed.currency != null ? String(parsed.currency) : "USD",
    paymentTerms: parsed.paymentTerms != null ? String(parsed.paymentTerms) : null,
    confidenceScore: clampPct(parsed.extractionConfidence) / 100,
    lowConfidenceFields: deriveLowConfidenceFields(fieldConfidence),
    fieldConfidence,
    extractionNotes: parsed.extractionNotes != null ? String(parsed.extractionNotes) : null,
    rawExtraction,
  };
}

async function openAiExtract(
  fileObjectPath: string,
  fileName: string,
  pageRange?: { pageStart: number; pageEnd: number } | null,
): Promise<ExtractedFields> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Caller guards on isExtractionConfigured(); this is a defensive backstop.
    throw new Error("Extraction service is not configured.");
  }
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  // Fetch the uploaded document bytes from object storage.
  const storage = new ObjectStorageService();
  const file = await storage.getObjectEntityFile(fileObjectPath);
  const [metadata] = await file.getMetadata();
  let [buffer] = await file.download();
  const contentType =
    (typeof metadata.contentType === "string" && metadata.contentType) || inferContentType(fileName);

  // Multi-invoice source documents: extract this invoice from only its own
  // pages. Splitting happens in-memory; the original stored file is untouched.
  if (contentType === "application/pdf" && pageRange) {
    try {
      buffer = await extractPdfPageRange(buffer, pageRange.pageStart, pageRange.pageEnd);
    } catch (err) {
      // Do NOT fall back to the full document: extracting the whole packet would
      // pull fields from the wrong invoice and silently corrupt this capture.
      // Route to exception so the page boundaries can be reviewed manually.
      logger.error(
        { fileObjectPath, pageRange, err: (err as Error)?.message },
        "openAiExtract: failed to split PDF page range",
      );
      throw new ExtractionError(
        "UNSUPPORTED_FILE",
        `Could not isolate pages ${pageRange.pageStart}-${pageRange.pageEnd} from the source file. Review the page split or enter the fields manually.`,
      );
    }
  }

  // Validate file size and type BEFORE building/sending the OpenAI request.
  if (buffer.length > MAX_EXTRACTION_FILE_BYTES) {
    throw new ExtractionError(
      "UNSUPPORTED_FILE",
      `Document is too large for automatic extraction (max ${Math.floor(
        MAX_EXTRACTION_FILE_BYTES / (1024 * 1024),
      )} MB). Enter the invoice fields manually.`,
    );
  }
  const isPdf = contentType === "application/pdf";
  const isImage = SUPPORTED_IMAGE_TYPES.includes(contentType);
  if (!isPdf && !isImage) {
    throw new ExtractionError(
      "UNSUPPORTED_FILE",
      "Unsupported document type for automatic extraction. Upload a PDF or image, or enter the fields manually.",
    );
  }
  const base64 = buffer.toString("base64");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 1 });

  const userContent: Array<Record<string, unknown>> = [
    { type: "input_text", text: `Extract the fields from this invoice ("${fileName}").` },
  ];

  if (contentType === "application/pdf") {
    userContent.push({
      type: "input_file",
      filename: fileName,
      file_data: `data:application/pdf;base64,${base64}`,
    });
  } else if (SUPPORTED_IMAGE_TYPES.includes(contentType)) {
    userContent.push({
      type: "input_image",
      image_url: `data:${contentType};base64,${base64}`,
      detail: "auto",
    });
  } else {
    // Defensive: type is already validated above.
    throw new ExtractionError(
      "UNSUPPORTED_FILE",
      "Unsupported document type for automatic extraction. Upload a PDF or image, or enter the fields manually.",
    );
  }

  let raw = "{}";
  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: "user", content: userContent as any },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "invoice_extraction",
          strict: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          schema: EXTRACTION_JSON_SCHEMA as any,
        },
      },
    });
    raw = response.output_text ?? "{}";
  } catch (err) {
    const { category, message } = categorizeExtractionError(err);
    // Log only safe diagnostics (category + status + provider request id);
    // never the raw provider message, which may echo headers/credentials.
    logger.error(
      {
        category,
        status: (err as { status?: number })?.status,
          // SDK 0.116.0: Anthropic uses requestID (camelCase); OpenAI uses request_id.
        requestId:
          (err as { request_id?: string })?.request_id ??
          (err as { requestID?: string })?.requestID ??
          null,
      },
      "openAiExtract: OpenAI request failed",
    );
    throw new ExtractionError(category, message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error({ rawLength: raw.length }, "openAiExtract: model returned non-JSON output");
    throw new ExtractionError(
      "INVALID_RESPONSE",
      "Automatic extraction failed to read the document. You can retry or enter the fields manually.",
    );
  }

  // Valid JSON can still be structurally wrong; reject it before persisting.
  assertValidModelShape(parsed);

  return mapModelOutput(parsed, raw);
}

// ─── Live Anthropic extraction ──────────────────────────────────────────────
// Parallel path to openAiExtract; selected when EXTRACTION_PROVIDER=anthropic.

async function anthropicExtract(
  fileObjectPath: string,
  fileName: string,
  pageRange?: { pageStart: number; pageEnd: number } | null,
): Promise<ExtractedFields> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Extraction service is not configured.");
  }

  // Fetch the uploaded document bytes from object storage.
  const storage = new ObjectStorageService();
  const file = await storage.getObjectEntityFile(fileObjectPath);
  const [metadata] = await file.getMetadata();
  let [buffer] = await file.download();
  const contentType =
    (typeof metadata.contentType === "string" && metadata.contentType) || inferContentType(fileName);

  // Multi-invoice source documents: extract this invoice from only its own pages.
  if (contentType === "application/pdf" && pageRange) {
    try {
      buffer = await extractPdfPageRange(buffer, pageRange.pageStart, pageRange.pageEnd);
    } catch (err) {
      logger.error(
        { fileObjectPath, pageRange, err: (err as Error)?.message },
        "anthropicExtract: failed to split PDF page range",
      );
      throw new ExtractionError(
        "UNSUPPORTED_FILE",
        `Could not isolate pages ${pageRange.pageStart}-${pageRange.pageEnd} from the source file. Review the page split or enter the fields manually.`,
      );
    }
  }

  // Validate file size and type BEFORE building the Anthropic request.
  if (buffer.length > MAX_EXTRACTION_FILE_BYTES) {
    throw new ExtractionError(
      "UNSUPPORTED_FILE",
      `Document is too large for automatic extraction (max ${Math.floor(
        MAX_EXTRACTION_FILE_BYTES / (1024 * 1024),
      )} MB). Enter the invoice fields manually.`,
    );
  }
  const isPdf = contentType === "application/pdf";
  const isImage = SUPPORTED_IMAGE_TYPES.includes(contentType);
  if (!isPdf && !isImage) {
    throw new ExtractionError(
      "UNSUPPORTED_FILE",
      "Unsupported document type for automatic extraction. Upload a PDF or image, or enter the fields manually.",
    );
  }

  const base64 = buffer.toString("base64");

  // Build user content blocks for Claude.
  const userContent: AnthropicUserContent = [
    { type: "text", text: `Extract the fields from this invoice ("${fileName}").` },
  ];

  if (isPdf) {
    (userContent as unknown[]).push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    });
  } else {
    // Normalise image/jpg → image/jpeg; Anthropic SDK only accepts the canonical MIME type.
    const mediaType = (contentType === "image/jpg" ? "image/jpeg" : contentType) as
      | "image/jpeg"
      | "image/png"
      | "image/webp"
      | "image/gif";
    (userContent as unknown[]).push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64 },
    });
  }

  // The SYSTEM_PROMPT is provider-agnostic; append a JSON-only instruction for Claude.
  const systemPrompt =
    SYSTEM_PROMPT +
    " Return ONLY valid JSON that matches the schema exactly — no markdown code fences," +
    " no explanatory prose, no trailing text.";

  let raw = "{}";
  try {
    raw = await callAnthropicStructured({ systemPrompt, userContent });
  } catch (err) {
    const { category, message } = categorizeExtractionError(err);
    // Log only safe diagnostics — never the raw provider message, which may echo credentials.
    logger.error(
      {
        category,
        status: (err as { status?: number })?.status,
        // SDK 0.116.0: requestID (camelCase), not request_id.
        requestId: (err as { requestID?: string })?.requestID ?? null,
      },
      "anthropicExtract: Anthropic request failed",
    );
    throw new ExtractionError(category, message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error({ rawLength: raw.length }, "anthropicExtract: model returned non-JSON output");
    throw new ExtractionError(
      "INVALID_RESPONSE",
      "Automatic extraction failed to read the document. You can retry or enter the fields manually.",
    );
  }

  assertValidModelShape(parsed);
  return mapModelOutput(parsed, raw);
}

// ─── Orchestration ───────────────────────────────────────────────────────────

/**
 * Run extraction for an invoice. Designed to be called fire-and-forget; it
 * manages its own status transitions and never throws to the caller.
 */
export async function runExtraction(invoiceId: number): Promise<void> {
  const [invoice] = await db
    .select({
      id: invoiceCaptureTable.id,
      status: invoiceCaptureTable.status,
      documentId: invoiceCaptureTable.documentId,
      fileObjectPath: invoiceCaptureTable.fileObjectPath,
      originalFileName: invoiceCaptureTable.originalFileName,
      extractionAttempts: invoiceCaptureTable.extractionAttempts,
      pageStart: invoiceCaptureTable.pageStart,
      pageEnd: invoiceCaptureTable.pageEnd,
    })
    .from(invoiceCaptureTable)
    .where(eq(invoiceCaptureTable.id, invoiceId))
    .limit(1);

  if (!invoice) {
    logger.warn({ invoiceId }, "runExtraction: invoice not found");
    return;
  }

  const attempt = (invoice.extractionAttempts ?? 0) + 1;

  await db
    .update(invoiceCaptureTable)
    .set({ extractionStatus: "PROCESSING", extractionError: null, extractionAttempts: attempt })
    .where(eq(invoiceCaptureTable.id, invoiceId));

  try {
    const usingMock = !isExtractionConfigured();
    const provider = (process.env.EXTRACTION_PROVIDER ?? "openai").toLowerCase();
    const pageRange =
      invoice.pageStart != null && invoice.pageEnd != null
        ? { pageStart: invoice.pageStart, pageEnd: invoice.pageEnd }
        : null;
    const fields = usingMock
      ? mockExtract(invoice.id, invoice.originalFileName)
      : provider === "anthropic"
        ? await anthropicExtract(invoice.fileObjectPath, invoice.originalFileName, pageRange)
        : await openAiExtract(invoice.fileObjectPath, invoice.originalFileName, pageRange);

    await db
      .update(invoiceCaptureTable)
      .set({
        vendorRawName: fields.vendorRawName,
        invoiceNumber: fields.invoiceNumber,
        invoiceDate: fields.invoiceDate,
        dueDate: fields.dueDate,
        totalAmount: fields.totalAmount != null ? String(fields.totalAmount) : null,
        taxAmount: String(fields.taxAmount ?? 0),
        subtotal: fields.subtotal != null ? String(fields.subtotal) : null,
        freightAmount: String(fields.freightAmount ?? 0),
        discountAmount: fields.discountAmount != null ? String(fields.discountAmount) : null,
        otherChargesAmount:
          fields.otherChargesAmount != null ? String(fields.otherChargesAmount) : null,
        poNumber: fields.poNumber,
        currency: fields.currency ?? "USD",
        paymentTerms: fields.paymentTerms,
        confidenceScore: String(fields.confidenceScore),
        lowConfidenceFields:
          fields.lowConfidenceFields.length > 0 ? fields.lowConfidenceFields.join(",") : null,
        fieldConfidence: JSON.stringify(fields.fieldConfidence),
        rawExtraction: fields.rawExtraction,
        extractionNotes: fields.extractionNotes,
        lastExtractedAt: new Date(),
        extractionStatus: "COMPLETED",
        extractionError: null,
        extractionErrorDetail: null,
      })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "EXTRACTED",
      actorClerkId: "system-pipeline",
      note: `Extraction completed via ${usingMock ? "development mock" : provider === "anthropic" ? "Anthropic" : "OpenAI"} (confidence ${(fields.confidenceScore * 100).toFixed(0)}%)`,
    });

    // Run controlled vendor matching on the extracted raw name.
    if (fields.vendorRawName) {
      await applyVendorMatch(invoiceId, fields.vendorRawName);
    }

    // Run the authoritative validation + routing engine: routes to the exception
    // queue, flags for review, or advances clean invoices toward approval.
    await validateInvoice(invoiceId);
  } catch (err) {
    const { category, message } = categorizeExtractionError(err);
    const fileType = inferContentType(invoice.originalFileName);

    // Safe, non-sensitive troubleshooting record (no keys, headers, or payloads).
    const detail = JSON.stringify({
      invoiceId,
      documentId: invoice.documentId ?? null,
      attempt,
      fileType,
      category,
      summary: message,
      at: new Date().toISOString(),
    });

    logger.error(
      { invoiceId, documentId: invoice.documentId, attempt, fileType, category, summary: message },
      "runExtraction failed",
    );

    // Route to the exception queue so failed invoices never sit in
    // PENDING_EXTRACTION forever. Never downgrade an already-decided invoice.
    const routeToException = invoice.status !== "APPROVED" && invoice.status !== "POSTED";

    await db
      .update(invoiceCaptureTable)
      .set({
        extractionStatus: "FAILED",
        extractionError: message,
        extractionErrorDetail: detail,
        lastExtractedAt: new Date(),
        ...(routeToException
          ? { status: "EXCEPTION" as const, exceptionReason: `Extraction Failed: ${message}` }
          : {}),
      })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "EXTRACTION_FAILED",
      actorClerkId: "system-pipeline",
      note: `[${category}] ${message}`.slice(0, 500),
    });
  }
}

/**
 * Kick off extraction without blocking the request lifecycle.
 */
export function triggerExtraction(invoiceId: number): void {
  setImmediate(() => {
    void runExtraction(invoiceId);
  });
}
