import { db, invoiceCaptureTable, invoiceAuditLogTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { applyVendorMatch } from "./vendorMatcher";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";

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
  poNumber: string | null;
  currency: string | null;
  paymentTerms: string | null;
  /** Overall extraction confidence, normalized to [0, 1] for storage. */
  confidenceScore: number;
  /** Field names (internal) whose confidence is below the 85 threshold. */
  lowConfidenceFields: string[];
  /** Per-field confidence, 0-100, keyed by internal field name. */
  fieldConfidence: FieldConfidence;
  /** Raw provider JSON response, persisted verbatim for audit/troubleshooting. */
  rawExtraction: string;
};

export function isExtractionConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

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
    poNumber,
    currency: "USD",
    paymentTerms: "Net 30",
    confidenceScore: overall / 100,
    lowConfidenceFields: deriveLowConfidenceFields(fieldConfidence),
    fieldConfidence,
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

/** Coerce a possibly-stringy numeric field into a number or null. */
function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Clamp a 0-100 confidence into that range; default to a neutral 50. */
function clampPct(value: unknown): number {
  const n = toNum(value);
  if (n == null) return 50;
  return Math.min(100, Math.max(0, n));
}

/**
 * Translate any extraction failure into a safe, user-facing message. Never
 * include the API key, request internals, or raw provider payloads here — the
 * returned string is persisted to the invoice and shown in the UI.
 */
function safeExtractionError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return "Extraction service authentication failed. Please verify the service configuration.";
  }
  if (status === 429) {
    return "Extraction service is busy (rate limited). Please retry in a moment.";
  }
  if (status != null && status >= 500) {
    return "Extraction service is temporarily unavailable. Please retry shortly.";
  }
  return "Automatic extraction failed. You can retry, or enter the invoice fields manually.";
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
  "values — use null when a field is not visible; NEVER assign a vendor id or GL " +
  "account; normalize dates to YYYY-MM-DD; normalize amounts as plain numbers with " +
  "two decimals (no currency symbols or thousands separators); currency is USD unless " +
  "the invoice clearly shows another currency; capture the PO number if visible; all " +
  "confidence scores are 0 to 100; the low-confidence threshold is 85; if multiple " +
  "totals appear, select the final amount due / total payable for amountDue and explain " +
  "briefly in extractionNotes.";

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
  invoiceTotal?: unknown;
  amountDue?: unknown;
  currency?: unknown;
  extractionConfidence?: unknown;
  fieldConfidence?: Record<string, unknown>;
};

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
    poNumber: parsed.poNumberRaw != null ? String(parsed.poNumberRaw) : null,
    currency: parsed.currency != null ? String(parsed.currency) : "USD",
    paymentTerms: parsed.paymentTerms != null ? String(parsed.paymentTerms) : null,
    confidenceScore: clampPct(parsed.extractionConfidence) / 100,
    lowConfidenceFields: deriveLowConfidenceFields(fieldConfidence),
    fieldConfidence,
    rawExtraction,
  };
}

async function openAiExtract(
  fileObjectPath: string,
  fileName: string,
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
  const [buffer] = await file.download();
  const contentType =
    (typeof metadata.contentType === "string" && metadata.contentType) || inferContentType(fileName);
  const base64 = buffer.toString("base64");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

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
    throw new Error(
      `Unsupported document type for extraction (${contentType}). Upload a PDF or image.`,
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
    // Log full detail server-side only; surface a sanitized message to the user.
    logger.error(
      { err: err instanceof Error ? err.message : String(err), status: (err as { status?: number })?.status },
      "openAiExtract: OpenAI request failed",
    );
    throw new Error(safeExtractionError(err));
  }

  let parsed: RawModelOutput;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error({ rawLength: raw.length }, "openAiExtract: model returned non-JSON output");
    throw new Error("Automatic extraction failed to parse the document. You can retry or enter fields manually.");
  }

  return mapModelOutput(parsed, raw);
}

// ─── Post-extraction validation ──────────────────────────────────────────────
// Runs after vendor matching. Routes low-confidence, incomplete, or duplicate
// invoices to the exception queue; clean invoices advance to PENDING_APPROVAL.

const VALIDATION_CONFIDENCE_THRESHOLD = 0.85;

/** True if another invoice already has this vendor + invoice number. */
async function hasDuplicate(
  invoiceId: number,
  vendorId: number | null,
  invoiceNumber: string | null,
): Promise<boolean> {
  if (vendorId == null || !invoiceNumber) return false;
  const rows = await db
    .select({ id: invoiceCaptureTable.id })
    .from(invoiceCaptureTable)
    .where(
      and(
        eq(invoiceCaptureTable.vendorId, vendorId),
        eq(invoiceCaptureTable.invoiceNumber, invoiceNumber),
        ne(invoiceCaptureTable.id, invoiceId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function runValidation(invoiceId: number, fields: ExtractedFields): Promise<void> {
  // Vendor matching may have already routed this invoice to EXCEPTION (no match,
  // low match confidence, inactive, on hold). If so, leave that reason intact.
  const [current] = await db
    .select({
      status: invoiceCaptureTable.status,
      vendorId: invoiceCaptureTable.vendorId,
      invoiceNumber: invoiceCaptureTable.invoiceNumber,
    })
    .from(invoiceCaptureTable)
    .where(eq(invoiceCaptureTable.id, invoiceId))
    .limit(1);

  if (!current || current.status === "EXCEPTION") return;

  const problems: string[] = [];

  if (fields.confidenceScore < VALIDATION_CONFIDENCE_THRESHOLD) {
    problems.push(`Low extraction confidence (${(fields.confidenceScore * 100).toFixed(0)}%)`);
  }
  if (fields.lowConfidenceFields.length > 0) {
    problems.push(`Low-confidence fields: ${fields.lowConfidenceFields.join(", ")}`);
  }

  const missing: string[] = [];
  if (!fields.vendorRawName) missing.push("vendor");
  if (!fields.invoiceNumber) missing.push("invoice number");
  if (fields.totalAmount == null) missing.push("total amount");
  if (!fields.invoiceDate) missing.push("invoice date");
  if (missing.length > 0) {
    problems.push(`Missing required fields: ${missing.join(", ")}`);
  }

  if (await hasDuplicate(invoiceId, current.vendorId, current.invoiceNumber)) {
    problems.push("Duplicate invoice (same vendor + invoice number)");
  }

  if (problems.length === 0) {
    await db
      .update(invoiceCaptureTable)
      .set({ status: "PENDING_APPROVAL", exceptionReason: null })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "VALIDATED",
      note: "Extraction passed validation; routed to pending approval.",
    });
    return;
  }

  await db
    .update(invoiceCaptureTable)
    .set({ status: "EXCEPTION", exceptionReason: problems.join("; ") })
    .where(eq(invoiceCaptureTable.id, invoiceId));

  await db.insert(invoiceAuditLogTable).values({
    invoiceId,
    action: "ROUTED_TO_EXCEPTION",
    note: problems.join("; ").slice(0, 500),
  });
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
      fileObjectPath: invoiceCaptureTable.fileObjectPath,
      originalFileName: invoiceCaptureTable.originalFileName,
    })
    .from(invoiceCaptureTable)
    .where(eq(invoiceCaptureTable.id, invoiceId))
    .limit(1);

  if (!invoice) {
    logger.warn({ invoiceId }, "runExtraction: invoice not found");
    return;
  }

  await db
    .update(invoiceCaptureTable)
    .set({ extractionStatus: "PROCESSING", extractionError: null })
    .where(eq(invoiceCaptureTable.id, invoiceId));

  try {
    const usingMock = !isExtractionConfigured();
    const fields = usingMock
      ? mockExtract(invoice.id, invoice.originalFileName)
      : await openAiExtract(invoice.fileObjectPath, invoice.originalFileName);

    await db
      .update(invoiceCaptureTable)
      .set({
        vendorRawName: fields.vendorRawName,
        invoiceNumber: fields.invoiceNumber,
        invoiceDate: fields.invoiceDate,
        dueDate: fields.dueDate,
        totalAmount: fields.totalAmount != null ? String(fields.totalAmount) : null,
        taxAmount: fields.taxAmount != null ? String(fields.taxAmount) : null,
        subtotal: fields.subtotal != null ? String(fields.subtotal) : null,
        freightAmount: fields.freightAmount != null ? String(fields.freightAmount) : null,
        poNumber: fields.poNumber,
        currency: fields.currency ?? "USD",
        paymentTerms: fields.paymentTerms,
        confidenceScore: String(fields.confidenceScore),
        lowConfidenceFields:
          fields.lowConfidenceFields.length > 0 ? fields.lowConfidenceFields.join(",") : null,
        fieldConfidence: JSON.stringify(fields.fieldConfidence),
        rawExtraction: fields.rawExtraction,
        extractionStatus: "COMPLETED",
        extractionError: null,
      })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "EXTRACTED",
      note: `Extraction completed via ${usingMock ? "development mock" : "OpenAI"} (confidence ${(fields.confidenceScore * 100).toFixed(0)}%)`,
    });

    // Run controlled vendor matching on the extracted raw name.
    if (fields.vendorRawName) {
      await applyVendorMatch(invoiceId, fields.vendorRawName);
    }

    // Validate the extracted data (confidence + required fields + duplicates);
    // routes to the exception queue or advances clean invoices to approval.
    await runValidation(invoiceId, fields);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ invoiceId, err: message }, "runExtraction failed");
    await db
      .update(invoiceCaptureTable)
      .set({ extractionStatus: "FAILED", extractionError: message })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "EXTRACTION_FAILED",
      note: message.slice(0, 500),
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
