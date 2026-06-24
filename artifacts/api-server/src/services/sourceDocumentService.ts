import {
  db,
  invoiceCaptureTable,
  invoiceAuditLogTable,
  sourceDocumentsTable,
} from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { triggerExtraction } from "./extractionService";
import { detectInvoices } from "./documentDetectionService";

/**
 * Source document orchestration.
 *
 * A source document is the raw uploaded file. One file may contain several
 * invoices, so processing runs detection, then creates one invoice_capture per
 * detected invoice (each linked back to the source document, carrying its page
 * range), and finally kicks off the existing extraction pipeline for each
 * invoice — extracting every invoice from only its own pages.
 *
 * The original uploaded file is preserved unchanged.
 */

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

export interface CreateSourceDocumentInput {
  fileObjectPath: string;
  originalFileName: string;
  contentType?: string | null;
  fileHash?: string | null;
}

/**
 * Create a source document record and start processing in the background.
 * Returns the new source document id immediately; clients poll the source
 * document to observe detection + per-invoice extraction progress.
 */
export async function createSourceDocument(
  input: CreateSourceDocumentInput,
): Promise<number> {
  const [doc] = await db
    .insert(sourceDocumentsTable)
    .values({
      originalFileName: input.originalFileName,
      fileObjectPath: input.fileObjectPath,
      fileHash: input.fileHash ?? null,
      processingStatus: "PENDING",
    })
    .returning({ id: sourceDocumentsTable.id });

  triggerSourceDocumentProcessing(doc.id, input.contentType ?? null);
  return doc.id;
}

/** Kick off source-document processing without blocking the request. */
export function triggerSourceDocumentProcessing(
  sourceDocumentId: number,
  contentTypeHint: string | null,
): void {
  setImmediate(() => {
    void processSourceDocument(sourceDocumentId, contentTypeHint);
  });
}

/**
 * Download the file, detect invoices, and create one invoice_capture per
 * detected invoice. Manages its own status transitions and never throws to the
 * caller (designed to be fire-and-forget).
 */
export async function processSourceDocument(
  sourceDocumentId: number,
  contentTypeHint: string | null,
): Promise<void> {
  const [doc] = await db
    .select()
    .from(sourceDocumentsTable)
    .where(eq(sourceDocumentsTable.id, sourceDocumentId))
    .limit(1);

  if (!doc) {
    logger.warn({ sourceDocumentId }, "processSourceDocument: source document not found");
    return;
  }

  await db
    .update(sourceDocumentsTable)
    .set({ processingStatus: "DETECTING", processingError: null })
    .where(eq(sourceDocumentsTable.id, sourceDocumentId));

  try {
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(doc.fileObjectPath);
    const [metadata] = await file.getMetadata();
    const [buffer] = await file.download();
    const contentType =
      (typeof metadata.contentType === "string" && metadata.contentType) ||
      contentTypeHint ||
      inferContentType(doc.originalFileName);

    const detection = await detectInvoices({
      buffer,
      contentType,
      fileName: doc.originalFileName,
    });

    // Persist the detection summary, but keep the source document in DETECTING
    // until the invoice rows exist. Marking it COMPLETED before the rows are
    // inserted would let the frontend stop polling and briefly show "0 invoices".
    await db
      .update(sourceDocumentsTable)
      .set({
        pageCount: detection.pageCount,
        detectedInvoiceCount: detection.invoiceCount,
        processingError: detection.exceptionReason,
      })
      .where(eq(sourceDocumentsTable.id, sourceDocumentId));

    // Create one invoice_capture per detected invoice.
    for (const detected of detection.invoices) {
      const [invoice] = await db
        .insert(invoiceCaptureTable)
        .values({
          fileObjectPath: doc.fileObjectPath,
          originalFileName: doc.originalFileName,
          sourceDocumentId,
          invoiceSequence: detected.invoiceSequence,
          pageStart: detected.pageStart,
          pageEnd: detected.pageEnd,
          status: detection.exceptionReason ? "EXCEPTION" : "PENDING_EXTRACTION",
          ...(detection.exceptionReason ? { exceptionReason: detection.exceptionReason } : {}),
        })
        .returning({ id: invoiceCaptureTable.id });

      const documentId = `INV-CAP-${String(invoice.id).padStart(6, "0")}`;
      await db
        .update(invoiceCaptureTable)
        .set({ documentId })
        .where(eq(invoiceCaptureTable.id, invoice.id));

      await db.insert(invoiceAuditLogTable).values({
        invoiceId: invoice.id,
        action: "CREATED",
        note:
          `Invoice ${detected.invoiceSequence} of ${detection.invoiceCount} from ${doc.originalFileName}` +
          ` (pages ${detected.pageStart}-${detected.pageEnd})`,
      });

      if (detection.exceptionReason) {
        // Detection could not confidently split the document (or it was a
        // multi-invoice image). Route to exception for manual review; do NOT
        // auto-extract, since the page boundaries are not trustworthy.
        await db.insert(invoiceAuditLogTable).values({
          invoiceId: invoice.id,
          action: "ROUTED_TO_EXCEPTION",
          note: detection.exceptionReason,
        });
      } else {
        triggerExtraction(invoice.id);
      }
    }

    // Only now that every invoice_capture row exists do we mark the source
    // document terminal, so the frontend never observes COMPLETED with no
    // invoices when detectedInvoiceCount > 0.
    await db
      .update(sourceDocumentsTable)
      .set({
        processingStatus: detection.exceptionReason ? "EXCEPTION" : "COMPLETED",
      })
      .where(eq(sourceDocumentsTable.id, sourceDocumentId));
  } catch (err) {
    logger.error(
      { sourceDocumentId, err: (err as Error)?.message },
      "processSourceDocument failed",
    );
    await db
      .update(sourceDocumentsTable)
      .set({
        processingStatus: "EXCEPTION",
        processingError: "Could not process the uploaded document. Please review or re-upload.",
      })
      .where(eq(sourceDocumentsTable.id, sourceDocumentId));
  }
}

export interface SourceDocumentWithInvoices {
  source: typeof sourceDocumentsTable.$inferSelect;
  invoices: Array<typeof invoiceCaptureTable.$inferSelect>;
}

/** Load a source document with its invoices ordered by sequence. */
export async function getSourceDocumentWithInvoices(
  sourceDocumentId: number,
): Promise<SourceDocumentWithInvoices | null> {
  const [source] = await db
    .select()
    .from(sourceDocumentsTable)
    .where(eq(sourceDocumentsTable.id, sourceDocumentId))
    .limit(1);

  if (!source) return null;

  const invoices = await db
    .select()
    .from(invoiceCaptureTable)
    .where(eq(invoiceCaptureTable.sourceDocumentId, sourceDocumentId))
    .orderBy(asc(invoiceCaptureTable.invoiceSequence), asc(invoiceCaptureTable.id));

  return { source, invoices };
}
