import { eq } from "drizzle-orm";
import {
  db,
  invoiceCaptureTable,
  invoiceAuditLogTable,
  vendorIdTable,
  exceptionEventTable,
} from "@workspace/db";

/**
 * Shared invoice helpers used by Phase 2 routes (exceptions, exports, etc.).
 * Decoupled from routes/invoices.ts so feature routes don't import route internals.
 */

const isoOrNull = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : ((v as string | null) ?? null);

/** Select an invoice enriched with vendorName, including Phase 2 columns. */
export async function getFullInvoiceById(id: number) {
  const [row] = await db
    .select({
      id: invoiceCaptureTable.id,
      status: invoiceCaptureTable.status,
      vendorId: invoiceCaptureTable.vendorId,
      vendorName: vendorIdTable.vendorName,
      invoiceNumber: invoiceCaptureTable.invoiceNumber,
      invoiceDate: invoiceCaptureTable.invoiceDate,
      totalAmount: invoiceCaptureTable.totalAmount,
      taxAmount: invoiceCaptureTable.taxAmount,
      poNumber: invoiceCaptureTable.poNumber,
      currency: invoiceCaptureTable.currency,
      fileObjectPath: invoiceCaptureTable.fileObjectPath,
      originalFileName: invoiceCaptureTable.originalFileName,
      documentId: invoiceCaptureTable.documentId,
      businessDocumentId: invoiceCaptureTable.businessDocumentId,
      vendorRawName: invoiceCaptureTable.vendorRawName,
      dueDate: invoiceCaptureTable.dueDate,
      voucherId: invoiceCaptureTable.voucherId,
      exceptionReason: invoiceCaptureTable.exceptionReason,
      lowConfidenceFields: invoiceCaptureTable.lowConfidenceFields,
      fieldConfidence: invoiceCaptureTable.fieldConfidence,
      confidenceScore: invoiceCaptureTable.confidenceScore,
      subtotal: invoiceCaptureTable.subtotal,
      freightAmount: invoiceCaptureTable.freightAmount,
      discountAmount: invoiceCaptureTable.discountAmount,
      otherChargesAmount: invoiceCaptureTable.otherChargesAmount,
      tieOutExpectedTotal: invoiceCaptureTable.tieOutExpectedTotal,
      tieOutDifference: invoiceCaptureTable.tieOutDifference,
      tieOutStatus: invoiceCaptureTable.tieOutStatus,
      tieOutExplanation: invoiceCaptureTable.tieOutExplanation,
      paymentTerms: invoiceCaptureTable.paymentTerms,
      exportStatus: invoiceCaptureTable.exportStatus,
      exportBatchId: invoiceCaptureTable.exportBatchId,
      exportedAt: invoiceCaptureTable.exportedAt,
      exportBlockedReason: invoiceCaptureTable.exportBlockedReason,
      exportRetryCount: invoiceCaptureTable.exportRetryCount,
      exportFileName: invoiceCaptureTable.exportFileName,
      exportFormat: invoiceCaptureTable.exportFormat,
      exceptionOwner: invoiceCaptureTable.exceptionOwner,
      exceptionOwnerClerkId: invoiceCaptureTable.exceptionOwnerClerkId,
      exceptionReviewedAt: invoiceCaptureTable.exceptionReviewedAt,
      exceptionReviewedBy: invoiceCaptureTable.exceptionReviewedBy,
      vendorMatchScore: invoiceCaptureTable.vendorMatchScore,
      validationStatus: invoiceCaptureTable.validationStatus,
      reviewStatus: invoiceCaptureTable.reviewStatus,
      overallReviewStatus: invoiceCaptureTable.overallReviewStatus,
      duplicateCheck: invoiceCaptureTable.duplicateCheck,
      vendorCheck: invoiceCaptureTable.vendorCheck,
      poCheck: invoiceCaptureTable.poCheck,
      amountCheck: invoiceCaptureTable.amountCheck,
      totalTieOut: invoiceCaptureTable.totalTieOut,
      validationDetails: invoiceCaptureTable.validationDetails,
      extractionStatus: invoiceCaptureTable.extractionStatus,
      extractionError: invoiceCaptureTable.extractionError,
      extractionAttempts: invoiceCaptureTable.extractionAttempts,
      extractionErrorDetail: invoiceCaptureTable.extractionErrorDetail,
      extractionNotes: invoiceCaptureTable.extractionNotes,
      lastExtractedAt: invoiceCaptureTable.lastExtractedAt,
      sourceDocumentId: invoiceCaptureTable.sourceDocumentId,
      invoiceSequence: invoiceCaptureTable.invoiceSequence,
      pageStart: invoiceCaptureTable.pageStart,
      pageEnd: invoiceCaptureTable.pageEnd,
      role: invoiceCaptureTable.role,
      removedAt: invoiceCaptureTable.removedAt,
      removedBy: invoiceCaptureTable.removedBy,
      removalReason: invoiceCaptureTable.removalReason,
      removalNote: invoiceCaptureTable.removalNote,
      createdAt: invoiceCaptureTable.createdAt,
      updatedAt: invoiceCaptureTable.updatedAt,
    })
    .from(invoiceCaptureTable)
    .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
    .where(eq(invoiceCaptureTable.id, id))
    .limit(1);
  return row ?? null;
}

export type FullInvoiceRow = NonNullable<
  Awaited<ReturnType<typeof getFullInvoiceById>>
>;

/**
 * Convert a raw invoice row into the API JSON shape: numeric (string) columns to
 * numbers and all timestamp columns to ISO strings (Zod string schemas reject Date).
 */
export function serializeInvoice(row: FullInvoiceRow | null) {
  if (!row) return null;
  const r = row as Record<string, unknown>;
  const num = (v: unknown) => (v != null ? Number(v as string) : null);
  return {
    ...row,
    totalAmount: num(r.totalAmount),
    taxAmount: num(r.taxAmount),
    confidenceScore: num(r.confidenceScore),
    subtotal: num(r.subtotal),
    freightAmount: num(r.freightAmount),
    discountAmount: num(r.discountAmount),
    otherChargesAmount: num(r.otherChargesAmount),
    tieOutExpectedTotal: num(r.tieOutExpectedTotal),
    tieOutDifference: num(r.tieOutDifference),
    vendorMatchScore: num(r.vendorMatchScore),
    lastExtractedAt: isoOrNull(r.lastExtractedAt),
    exportedAt: isoOrNull(r.exportedAt),
    exceptionReviewedAt: isoOrNull(r.exceptionReviewedAt),
    removedAt: isoOrNull(r.removedAt),
    createdAt: isoOrNull(r.createdAt),
    updatedAt: isoOrNull(r.updatedAt),
  };
}

/** Append an audit-log entry (field-level edits / status changes). */
export async function appendAudit(params: {
  invoiceId: number;
  action: string;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  editorRole?: string | null;
  note?: string | null;
  /** Clerk userId of the authenticated actor performing this action. */
  actorClerkId: string;
  /** Human-readable display name resolved from Clerk at write time. */
  actorName?: string | null;
}) {
  await db.insert(invoiceAuditLogTable).values({
    invoiceId: params.invoiceId,
    action: params.action,
    fieldName: params.fieldName ?? null,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    editorRole: params.editorRole ?? null,
    note: params.note ?? null,
    actorClerkId: params.actorClerkId,
    actorName: params.actorName ?? null,
  });
}

/** Append an exception activity event and return the serialized event. */
export async function appendExceptionEvent(params: {
  invoiceId: number;
  eventType: string;
  note?: string | null;
  actor?: string | null;
}) {
  const [event] = await db
    .insert(exceptionEventTable)
    .values({
      invoiceId: params.invoiceId,
      eventType: params.eventType,
      note: params.note ?? null,
      actor: params.actor ?? null,
    })
    .returning();
  return serializeExceptionEvent(event);
}

export function serializeExceptionEvent(row: {
  id: number;
  invoiceId: number;
  eventType: string;
  note: string | null;
  actor: string | null;
  createdAt: Date;
}) {
  return {
    ...row,
    createdAt: isoOrNull(row.createdAt) as string,
  };
}
