import {
  db,
  invoiceCaptureTable,
  invoiceAuditLogTable,
  sourceDocumentsTable,
  exceptionEventTable,
} from "@workspace/db";
import { eq, asc, and, isNull, desc } from "drizzle-orm";
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
  /** Provenance of arrival — how this file reached the system.
   *  Defaults to "Manual Upload" if omitted. */
  sourceChannel?: string;
}

/**
 * Create a source document record and start processing in the background.
 * Returns the new source document id immediately; clients poll the source
 * document to observe detection + per-invoice extraction progress.
 */
export async function createSourceDocument(
  input: CreateSourceDocumentInput,
): Promise<number> {
  // Check for a duplicate file: look up the most recent non-removed source
  // document with the same content hash. Advisory only — does not block upload
  // or processing (per spec: "Duplicate file warning" is non-blocking).
  let duplicateOfSourceDocumentId: number | null = null;
  if (input.fileHash) {
    const [existing] = await db
      .select({ id: sourceDocumentsTable.id })
      .from(sourceDocumentsTable)
      .where(
        and(
          eq(sourceDocumentsTable.fileHash, input.fileHash),
          isNull(sourceDocumentsTable.removedAt),
        ),
      )
      .orderBy(desc(sourceDocumentsTable.createdAt))
      .limit(1);
    if (existing) {
      duplicateOfSourceDocumentId = existing.id;
    }
  }

  const [doc] = await db
    .insert(sourceDocumentsTable)
    .values({
      originalFileName: input.originalFileName,
      fileObjectPath: input.fileObjectPath,
      fileHash: input.fileHash ?? null,
      processingStatus: "PENDING",
      duplicateOfSourceDocumentId,
      sourceChannel: input.sourceChannel ?? "Manual Upload",
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
        actorClerkId: "system-pipeline",
        note:
          `Invoice ${detected.invoiceSequence} of ${detection.invoiceCount} from ${doc.originalFileName}` +
          ` (pages ${detected.pageStart}-${detected.pageEnd})`,
      });

      if (doc.duplicateOfSourceDocumentId != null) {
        await db.insert(invoiceAuditLogTable).values({
          invoiceId: invoice.id,
          action: "DUPLICATE_FILE_DETECTED",
          actorClerkId: "system-pipeline",
          note: `Source file content matches source document #${doc.duplicateOfSourceDocumentId}. Possible duplicate upload — verify before processing.`,
        });
      }

      if (detection.exceptionReason) {
        // Detection could not confidently split the document (or it was a
        // multi-invoice image). Route to exception for manual review; do NOT
        // auto-extract, since the page boundaries are not trustworthy.
        await db.insert(invoiceAuditLogTable).values({
          invoiceId: invoice.id,
          action: "ROUTED_TO_EXCEPTION",
          actorClerkId: "system-pipeline",
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

export interface DuplicateSourceDocumentRef {
  id: number;
  originalFileName: string;
  uploadedAt: Date;
}

export interface SourceDocumentWithInvoices {
  source: typeof sourceDocumentsTable.$inferSelect;
  invoices: Array<typeof invoiceCaptureTable.$inferSelect>;
  /** Populated when duplicateOfSourceDocumentId is set, for UI display. */
  duplicateSourceDocument: DuplicateSourceDocumentRef | null;
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

  const [invoices, duplicateSourceDocument] = await Promise.all([
    db
      .select()
      .from(invoiceCaptureTable)
      .where(eq(invoiceCaptureTable.sourceDocumentId, sourceDocumentId))
      .orderBy(asc(invoiceCaptureTable.invoiceSequence), asc(invoiceCaptureTable.id)),
    source.duplicateOfSourceDocumentId != null
      ? db
          .select({
            id: sourceDocumentsTable.id,
            originalFileName: sourceDocumentsTable.originalFileName,
            uploadedAt: sourceDocumentsTable.uploadedAt,
          })
          .from(sourceDocumentsTable)
          .where(eq(sourceDocumentsTable.id, source.duplicateOfSourceDocumentId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  return { source, invoices, duplicateSourceDocument };
}

export interface RemovalInput {
  reason: string;
  note?: string | null;
  actor?: string | null;
  /** Role of the authenticated actor (e.g. AP_CLERK / AP_MANAGER). */
  actorRole?: string | null;
}

/**
 * Soft-remove a source document and void every child invoice with a shared
 * reason. Removed records are excluded from active lists/queues/KPIs by default.
 * Returns the refreshed source document with invoices, or null when not found.
 */
export async function removeSourceDocument(
  sourceDocumentId: number,
  input: RemovalInput,
): Promise<SourceDocumentWithInvoices | null> {
  const [source] = await db
    .select()
    .from(sourceDocumentsTable)
    .where(eq(sourceDocumentsTable.id, sourceDocumentId))
    .limit(1);

  if (!source) return null;

  const now = new Date();
  const actor = input.actor ?? null;
  const note = input.note ?? null;

  // Mark the source removed and void every active child invoice (with an audit
  // entry each) atomically, so a failure cannot leave the source flagged while
  // only some of its invoices were voided.
  await db.transaction(async (tx) => {
    await tx
      .update(sourceDocumentsTable)
      .set({
        removedAt: now,
        removedBy: actor,
        removalReason: input.reason,
        removalNote: note,
      })
      .where(eq(sourceDocumentsTable.id, sourceDocumentId));

    const children = await tx
      .select({ id: invoiceCaptureTable.id, status: invoiceCaptureTable.status })
      .from(invoiceCaptureTable)
      .where(eq(invoiceCaptureTable.sourceDocumentId, sourceDocumentId));

    for (const child of children) {
      if (child.status === "VOIDED") continue;
      await tx
        .update(invoiceCaptureTable)
        .set({
          status: "VOIDED",
          removedAt: now,
          removedBy: actor,
          removalReason: input.reason,
          removalNote: note,
        })
        .where(eq(invoiceCaptureTable.id, child.id));
      await tx.insert(invoiceAuditLogTable).values({
        invoiceId: child.id,
        action: "VOIDED",
        oldValue: child.status,
        newValue: "VOIDED",
        actorClerkId: actor ?? "system-pipeline",
        editorRole: input.actorRole ?? null,
        note: note ? `${input.reason} — ${note}` : input.reason,
      });
    }
  });

  return getSourceDocumentWithInvoices(sourceDocumentId);
}

export interface DeleteSourceDocumentResult {
  deleted: boolean;
  deletedInvoiceIds: number[];
  deletedSourceDocumentId: number | null;
  fileDeleted: boolean;
  blockedReason?: string;
}

/**
 * Permanently hard-delete a source document together with every child invoice
 * (and their audit records), then delete the stored file. Blocked when any child
 * invoice is posted. Designed for test-data cleanup.
 */
export async function deleteSourceDocument(
  sourceDocumentId: number,
): Promise<DeleteSourceDocumentResult | null> {
  const [source] = await db
    .select()
    .from(sourceDocumentsTable)
    .where(eq(sourceDocumentsTable.id, sourceDocumentId))
    .limit(1);

  if (!source) return null;

  const children = await db
    .select({ id: invoiceCaptureTable.id, status: invoiceCaptureTable.status })
    .from(invoiceCaptureTable)
    .where(eq(invoiceCaptureTable.sourceDocumentId, sourceDocumentId));

  if (children.some((c) => c.status === "POSTED")) {
    return {
      deleted: false,
      deletedInvoiceIds: [],
      deletedSourceDocumentId: null,
      fileDeleted: false,
      blockedReason:
        "This source document has a posted invoice and cannot be hard-deleted. Void or remove it instead.",
    };
  }

  // Remove child FK dependents (audit logs + exception events), then child
  // invoices, then the source document, atomically so a mid-operation failure
  // cannot leave dangling rows. Exception events exist for any child invoice
  // that went through the exception workflow.
  try {
    await db.transaction(async (tx) => {
      for (const child of children) {
        await tx
          .delete(invoiceAuditLogTable)
          .where(eq(invoiceAuditLogTable.invoiceId, child.id));
        await tx
          .delete(exceptionEventTable)
          .where(eq(exceptionEventTable.invoiceId, child.id));
      }
      await tx
        .delete(invoiceCaptureTable)
        .where(eq(invoiceCaptureTable.sourceDocumentId, sourceDocumentId));
      await tx.delete(sourceDocumentsTable).where(eq(sourceDocumentsTable.id, sourceDocumentId));
    });
  } catch (err) {
    // Safety net: an unknown dependent row still references a child invoice.
    // Report a clean blocked result instead of surfacing a raw 500.
    logger.warn(
      { sourceDocumentId, err: (err as Error)?.message },
      "deleteSourceDocument: delete transaction blocked by dependent records",
    );
    return {
      deleted: false,
      deletedInvoiceIds: [],
      deletedSourceDocumentId: null,
      fileDeleted: false,
      blockedReason:
        "Source document cannot be hard-deleted because dependent records still reference its invoices.",
    };
  }

  // Now that all rows for this source are gone, delete the stored file — but only
  // if no other invoice or source document still references the same object
  // (files can, in principle, be shared). Best-effort: never fail the delete
  // because the blob could not be removed.
  let fileDeleted = false;
  if (source.fileObjectPath) {
    const path = source.fileObjectPath;
    const [invoiceRefs, sourceRefs] = await Promise.all([
      db
        .select({ id: invoiceCaptureTable.id })
        .from(invoiceCaptureTable)
        .where(eq(invoiceCaptureTable.fileObjectPath, path))
        .limit(1),
      db
        .select({ id: sourceDocumentsTable.id })
        .from(sourceDocumentsTable)
        .where(eq(sourceDocumentsTable.fileObjectPath, path))
        .limit(1),
    ]);
    if (invoiceRefs.length === 0 && sourceRefs.length === 0) {
      try {
        await new ObjectStorageService().deleteObject(path);
        fileDeleted = true;
      } catch (err) {
        logger.warn(
          { sourceDocumentId, err: (err as Error)?.message },
          "deleteSourceDocument: file delete failed (best-effort)",
        );
      }
    }
  }

  return {
    deleted: true,
    deletedInvoiceIds: children.map((c) => c.id),
    deletedSourceDocumentId: sourceDocumentId,
    fileDeleted,
  };
}
