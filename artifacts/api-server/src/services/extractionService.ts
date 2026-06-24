import { db, invoiceCaptureTable, invoiceAuditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { applyVendorMatch } from "./vendorMatcher";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";

/**
 * Extraction service.
 *
 * When OPENAI_API_KEY is configured, real extraction runs against the uploaded
 * document. Until then, a deterministic development mock produces plausible
 * field values so the full pipeline (review, vendor matching, exception routing)
 * can be exercised end-to-end without the key.
 *
 * The mock NEVER assigns a vendorId directly — it only produces a vendorRawName,
 * which is then run through the controlled vendor matching pipeline, exactly as
 * a real extraction would.
 */

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
  confidenceScore: number;
  lowConfidenceFields: string[];
};

export function isExtractionConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
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
  const confidenceScore = seededInt(seed * 29, 70, 99) / 100;
  const lowConfidenceFields: string[] = [];
  if (confidenceScore < 0.85) {
    // Flag a couple of fields as low confidence to drive exception routing.
    lowConfidenceFields.push("totalAmount", "invoiceDate");
  }

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
    confidenceScore,
    lowConfidenceFields,
  };
}

// ─── Live OpenAI extraction ─────────────────────────────────────────────────
// Lazy-imports the SDK so the app never requires the package to boot. The key
// is read only from the environment and is never logged or returned to clients.

const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

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

/** Clamp the model's self-reported confidence into [0, 1]. */
function clampConfidence(value: unknown): number {
  const n = toNum(value);
  if (n == null) return 0.5;
  return Math.min(1, Math.max(0, n));
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

async function openAiExtract(
  fileObjectPath: string,
  fileName: string,
): Promise<ExtractedFields> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Caller guards on isExtractionConfigured(); this is a defensive backstop.
    throw new Error("Extraction service is not configured.");
  }

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

  const systemPrompt =
    "You are an accounts-payable invoice extraction engine. Read the attached " +
    "invoice document and return STRICT JSON with exactly these keys: " +
    "vendorRawName (the vendor/supplier name as printed), invoiceNumber, " +
    "invoiceDate (YYYY-MM-DD), dueDate (YYYY-MM-DD), totalAmount (number), " +
    "taxAmount (number), subtotal (number), freightAmount (number), poNumber, " +
    "currency (ISO code), paymentTerms, confidenceScore (0-1 overall extraction " +
    "confidence), lowConfidenceFields (array of field names you are unsure about). " +
    "Use null for any value not present on the document. NEVER invent a vendor id " +
    "or account number. Return only the JSON object, no prose.";

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
      model: "gpt-4o",
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: "user", content: userContent as any },
      ],
      text: { format: { type: "json_object" } },
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

  let parsed: Partial<Record<keyof ExtractedFields, unknown>>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error({ rawLength: raw.length }, "openAiExtract: model returned non-JSON output");
    throw new Error("Automatic extraction failed to parse the document. You can retry or enter fields manually.");
  }

  const lowConfidenceFields = Array.isArray(parsed.lowConfidenceFields)
    ? (parsed.lowConfidenceFields as unknown[]).map((f) => String(f))
    : [];

  return {
    vendorRawName: parsed.vendorRawName != null ? String(parsed.vendorRawName) : null,
    invoiceNumber: parsed.invoiceNumber != null ? String(parsed.invoiceNumber) : null,
    invoiceDate: parsed.invoiceDate != null ? String(parsed.invoiceDate) : null,
    dueDate: parsed.dueDate != null ? String(parsed.dueDate) : null,
    totalAmount: toNum(parsed.totalAmount),
    taxAmount: toNum(parsed.taxAmount),
    subtotal: toNum(parsed.subtotal),
    freightAmount: toNum(parsed.freightAmount),
    poNumber: parsed.poNumber != null ? String(parsed.poNumber) : null,
    currency: parsed.currency != null ? String(parsed.currency) : "USD",
    paymentTerms: parsed.paymentTerms != null ? String(parsed.paymentTerms) : null,
    confidenceScore: clampConfidence(parsed.confidenceScore),
    lowConfidenceFields,
  };
}

// ─── Post-extraction validation ──────────────────────────────────────────────
// Runs after vendor matching. Mirrors the submit-time rules so low-confidence or
// incomplete extractions land in the exception queue immediately, rather than
// only when a user manually submits for approval.

const VALIDATION_CONFIDENCE_THRESHOLD = 0.85;

async function runValidation(invoiceId: number, fields: ExtractedFields): Promise<void> {
  // Vendor matching may have already routed this invoice to EXCEPTION (no match,
  // low match confidence, inactive, on hold). If so, leave that reason intact.
  const [current] = await db
    .select({ status: invoiceCaptureTable.status })
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

  if (problems.length === 0) {
    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "VALIDATED",
      note: "Extraction passed validation; ready for review.",
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

    // Validate the extracted data (confidence + required fields); routes to the
    // exception queue when the invoice needs human attention.
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
