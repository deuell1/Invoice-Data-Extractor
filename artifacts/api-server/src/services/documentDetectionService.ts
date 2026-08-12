import { logger } from "../lib/logger";
import { getPdfPageCount } from "../lib/pdfUtils";
import { callAnthropicStructured, isAnthropicConfigured } from "./anthropicStructured";
import type { AnthropicUserContent } from "./anthropicStructured";

/**
 * Document detection service.
 *
 * A single uploaded file may contain more than one invoice (e.g. a scanned
 * batch concatenated into one PDF). This service determines how many distinct
 * invoices a document contains and the contiguous page range of each, so the
 * pipeline can create one invoice_capture record per detected invoice and
 * extract each from only its own pages.
 *
 * - PDFs: page count comes from pdf-lib; the invoice boundaries are detected
 *   with the Anthropic Messages API using forced tool-use.
 * - Images: treated as a single invoice. If the model clearly sees multiple
 *   invoices in one image, the document is routed to exception (images cannot
 *   be split programmatically).
 *
 * When ANTHROPIC_API_KEY is absent, a safe fallback treats the whole document
 * as a single invoice so the rest of the pipeline keeps working in development.
 */

const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

/** Canonical exception reasons produced by detection. */
export const DETECTION_REASON = {
  DETECTION_FAILED: "Multiple Invoice Detection Failed",
  RANGE_UNCLEAR: "Invoice Page Range Unclear",
  IMAGE_MULTIPLE: "Multiple Invoices In Single Image - Manual Split Required",
  SPLIT_REQUIRED: "Invoice Split Required",
} as const;

export interface DetectedInvoice {
  invoiceSequence: number;
  pageStart: number;
  pageEnd: number;
  reason: string | null;
}

export interface DetectionResult {
  pageCount: number;
  invoiceCount: number;
  invoices: DetectedInvoice[];
  /**
   * When set, the document (and the invoice records created from it) should be
   * routed to the exception queue with this reason — detection could not
   * confidently determine the per-invoice page ranges, or an image held
   * multiple invoices that cannot be split automatically.
   */
  exceptionReason: string | null;
}

export function isDetectionConfigured(): boolean {
  return isAnthropicConfigured();
}

function inferIsImage(contentType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(contentType);
}

/** Single-invoice result spanning the whole document. */
function singleInvoice(pageCount: number, exceptionReason: string | null = null): DetectionResult {
  const safePages = pageCount > 0 ? pageCount : 1;
  return {
    pageCount: safePages,
    invoiceCount: 1,
    invoices: [{ invoiceSequence: 1, pageStart: 1, pageEnd: safePages, reason: exceptionReason }],
    exceptionReason,
  };
}

/** Strict JSON schema for PDF invoice-boundary detection. */
const PDF_DETECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["invoiceCount", "uncertain", "invoices"],
  properties: {
    invoiceCount: { type: "integer", description: "Number of distinct invoices in the document" },
    uncertain: {
      type: "boolean",
      description: "True if the invoice boundaries / page ranges could not be confidently determined",
    },
    invoices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["invoiceSequence", "pageStart", "pageEnd", "reason"],
        properties: {
          invoiceSequence: { type: "integer", description: "1-based order within the document" },
          pageStart: { type: "integer", description: "1-based first page of this invoice" },
          pageEnd: { type: "integer", description: "1-based last page of this invoice (inclusive)" },
          reason: { type: ["string", "null"], description: "Short note on how the boundary was identified" },
        },
      },
    },
  },
} as const;

/** Strict JSON schema for single-image invoice-count detection. */
const IMAGE_DETECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["invoiceCount", "reason"],
  properties: {
    invoiceCount: { type: "integer", description: "Number of separate invoices visible in the image" },
    reason: { type: ["string", "null"] },
  },
} as const;

const PDF_SYSTEM_PROMPT =
  "You are an accounts-payable document triage engine. A single PDF may contain one " +
  "invoice or several distinct invoices concatenated together. Determine how many " +
  "separate invoices are present and the contiguous, non-overlapping page range of " +
  "each. Pages are 1-indexed. Every page must belong to exactly one invoice and the " +
  "ranges must cover the whole document in order with no gaps or overlaps. If you " +
  "cannot confidently determine the boundaries, set uncertain to true. Return ONLY " +
  "the JSON described by the schema.";

const IMAGE_SYSTEM_PROMPT =
  "You are an accounts-payable document triage engine. Determine how many separate " +
  "invoices are visible in this single image. Almost always this is exactly 1. Only " +
  "report more than 1 if there are clearly multiple distinct invoices shown together. " +
  "Return ONLY the JSON described by the schema.";

interface PdfDetectionOutput {
  invoiceCount?: unknown;
  uncertain?: unknown;
  invoices?: Array<{ invoiceSequence?: unknown; pageStart?: unknown; pageEnd?: unknown; reason?: unknown }>;
}

function toInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Validate and normalize the model's page ranges against the real page count.
 * Returns null if the ranges are unusable (out of bounds, gaps, or overlaps),
 * which signals the caller to route the document to exception.
 */
function normalizeRanges(
  raw: PdfDetectionOutput,
  pageCount: number,
): DetectedInvoice[] | null {
  const items = Array.isArray(raw.invoices) ? raw.invoices : [];
  if (items.length === 0) return null;

  const parsed = items
    .map((it, idx) => ({
      invoiceSequence: toInt(it.invoiceSequence) ?? idx + 1,
      pageStart: toInt(it.pageStart),
      pageEnd: toInt(it.pageEnd),
      reason: it.reason != null ? String(it.reason) : null,
    }))
    .filter((it): it is DetectedInvoice => it.pageStart != null && it.pageEnd != null)
    .sort((a, b) => a.pageStart - b.pageStart);

  if (parsed.length === 0) return null;

  // Ranges must be in-bounds, ordered, contiguous, and cover the full document.
  let expectedNext = 1;
  for (const it of parsed) {
    if (it.pageStart < 1 || it.pageEnd > pageCount || it.pageStart > it.pageEnd) return null;
    if (it.pageStart !== expectedNext) return null; // gap or overlap
    expectedNext = it.pageEnd + 1;
  }
  if (expectedNext !== pageCount + 1) return null; // does not cover the last page

  // Re-sequence cleanly 1..N.
  return parsed.map((it, idx) => ({ ...it, invoiceSequence: idx + 1 }));
}

// ─── Anthropic detection paths ───────────────────────────────────────────────

async function detectPdfAnthropic(
  buffer: Buffer,
  fileName: string,
  pageCount: number,
): Promise<DetectionResult> {
  const base64 = buffer.toString("base64");

  // Embed schema shape inline — Claude does not enforce JSON schemas natively.
  // Forced tool-use enforces the schema server-side — no JSON-shape instruction needed.
  const systemPrompt = PDF_SYSTEM_PROMPT;

  const userContent: AnthropicUserContent = [
    {
      type: "text",
      text: `This PDF ("${fileName}") has ${pageCount} pages. Identify the invoices and their page ranges.`,
    },
  ];
  (userContent as unknown[]).push({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: base64 },
  });

  try {
    const parsed = await callAnthropicStructured({
      systemPrompt,
      userContent,
      toolName: "detect_pdf_invoices",
      toolDescription: "Identify the number of invoices in this PDF and their page ranges.",
      inputSchema: PDF_DETECTION_SCHEMA as Record<string, unknown>,
    }) as PdfDetectionOutput;

    const ranges = normalizeRanges(parsed, pageCount);
    if (!ranges) {
      logger.warn({ fileName, pageCount }, "detectPdfAnthropic: model ranges invalid; routing to exception");
      return singleInvoice(pageCount, DETECTION_REASON.RANGE_UNCLEAR);
    }

    if (parsed.uncertain === true) {
      return { pageCount, invoiceCount: ranges.length, invoices: ranges, exceptionReason: DETECTION_REASON.RANGE_UNCLEAR };
    }

    return { pageCount, invoiceCount: ranges.length, invoices: ranges, exceptionReason: null };
  } catch (err) {
    // SDK 0.116.0: use constructor.name for Anthropic error classes.
    logger.error(
      {
        fileName,
        status: (err as { status?: number })?.status,
        constructorName: (err as { constructor?: { name?: string } })?.constructor?.name,
        errMessage: (err as { message?: string })?.message,
      },
      "detectPdfAnthropic: detection request failed",
    );
    return singleInvoice(pageCount, DETECTION_REASON.DETECTION_FAILED);
  }
}

async function detectImageAnthropic(
  buffer: Buffer,
  contentType: string,
  fileName: string,
): Promise<DetectionResult> {
  // Normalise image/jpg → image/jpeg; Anthropic only accepts canonical MIME types.
  const mediaType = (contentType === "image/jpg" ? "image/jpeg" : contentType) as
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif";
  const base64 = buffer.toString("base64");

  // Forced tool-use enforces the schema server-side — no JSON-shape instruction needed.
  const systemPrompt = IMAGE_SYSTEM_PROMPT;

  const userContent: AnthropicUserContent = [
    { type: "text", text: `How many separate invoices are in this image ("${fileName}")?` },
  ];
  (userContent as unknown[]).push({
    type: "image",
    source: { type: "base64", media_type: mediaType, data: base64 },
  });

  try {
    const parsed = await callAnthropicStructured({
      systemPrompt,
      userContent,
      toolName: "detect_image_invoices",
      toolDescription: "Count the number of separate invoices visible in this image.",
      inputSchema: IMAGE_DETECTION_SCHEMA as Record<string, unknown>,
    }) as { invoiceCount?: unknown };
    const count = toInt(parsed.invoiceCount) ?? 1;

    if (count > 1) {
      return singleInvoice(1, DETECTION_REASON.IMAGE_MULTIPLE);
    }
    return singleInvoice(1);
  } catch (err) {
    // SDK 0.116.0: use constructor.name for Anthropic error classes.
    logger.error(
      {
        fileName,
        status: (err as { status?: number })?.status,
        constructorName: (err as { constructor?: { name?: string } })?.constructor?.name,
      },
      "detectImageAnthropic: detection request failed; defaulting to single invoice",
    );
    return singleInvoice(1);
  }
}

async function detectPdf(buffer: Buffer, fileName: string): Promise<DetectionResult> {
  let pageCount: number;
  try {
    pageCount = await getPdfPageCount(buffer);
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, "detectPdf: failed to read PDF page count");
    return singleInvoice(1, DETECTION_REASON.DETECTION_FAILED);
  }

  if (pageCount <= 1) {
    // A one-page PDF is always a single invoice; no need to call the model.
    return singleInvoice(pageCount);
  }

  if (!isDetectionConfigured()) {
    // Dev fallback: no key, treat the whole document as one invoice.
    return singleInvoice(pageCount);
  }

  return detectPdfAnthropic(buffer, fileName, pageCount);
}

async function detectImage(buffer: Buffer, contentType: string, fileName: string): Promise<DetectionResult> {
  if (!isDetectionConfigured()) {
    return singleInvoice(1);
  }

  return detectImageAnthropic(buffer, contentType, fileName);
}

/**
 * Detect the invoices contained in an uploaded document. Never throws — any
 * failure resolves to a safe single-invoice result, flagged for exception when
 * appropriate.
 */
export async function detectInvoices(params: {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}): Promise<DetectionResult> {
  const { buffer, contentType, fileName } = params;
  const isPdf = contentType === "application/pdf";
  const isImage = inferIsImage(contentType);

  if (isPdf) {
    return detectPdf(buffer, fileName);
  }
  if (isImage) {
    return detectImage(buffer, contentType, fileName);
  }

  // Unknown type — let the single-invoice path handle it; extraction will
  // surface an unsupported-file error if it truly cannot be read.
  return singleInvoice(1);
}
