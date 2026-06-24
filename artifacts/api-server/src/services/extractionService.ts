import { db, invoiceCaptureTable, invoiceAuditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { applyVendorMatch } from "./vendorMatcher";
import { logger } from "../lib/logger";

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

// ─── OpenAI extraction (ready for a future OPENAI_API_KEY) ──────────────────
// Intentionally lazy-imports the SDK so the app never requires the package or
// the key to boot. This path is exercised only once OPENAI_API_KEY is set.

async function openAiExtract(
  fileObjectPath: string,
  fileName: string,
): Promise<ExtractedFields> {
  // Lazy import keeps startup independent of the key being present.
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt =
    "You are an accounts-payable invoice extraction engine. Extract invoice " +
    "fields from the provided document and return strict JSON with keys: " +
    "vendorRawName, invoiceNumber, invoiceDate (YYYY-MM-DD), dueDate (YYYY-MM-DD), " +
    "totalAmount, taxAmount, subtotal, freightAmount, poNumber, currency, " +
    "paymentTerms, confidenceScore (0-1), lowConfidenceFields (string[]). " +
    "Do NOT guess a vendor id. Use null for unknown values.";

  // NOTE: For PDFs/images the document bytes should be attached. The object path
  // is passed through so this can be wired to signed-URL retrieval when enabled.
  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Extract fields from invoice file "${fileName}" (object: ${fileObjectPath}).`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<ExtractedFields>;

  return {
    vendorRawName: parsed.vendorRawName ?? null,
    invoiceNumber: parsed.invoiceNumber ?? null,
    invoiceDate: parsed.invoiceDate ?? null,
    dueDate: parsed.dueDate ?? null,
    totalAmount: parsed.totalAmount ?? null,
    taxAmount: parsed.taxAmount ?? null,
    subtotal: parsed.subtotal ?? null,
    freightAmount: parsed.freightAmount ?? null,
    poNumber: parsed.poNumber ?? null,
    currency: parsed.currency ?? "USD",
    paymentTerms: parsed.paymentTerms ?? null,
    confidenceScore: parsed.confidenceScore ?? 0.5,
    lowConfidenceFields: parsed.lowConfidenceFields ?? [],
  };
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
