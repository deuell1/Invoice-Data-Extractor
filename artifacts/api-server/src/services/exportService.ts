import { and, eq, ne, or, isNull, gte, lte, sql, inArray, desc, type SQL } from "drizzle-orm";
import {
  db,
  invoiceCaptureTable,
  vendorIdTable,
  sourceDocumentsTable,
} from "@workspace/db";
import { toCsv } from "../lib/csv";

/**
 * Export workflow service.
 *
 * This is a file-based export (NOT an ERP integration). Selected invoices are
 * marked with file-export status codes only: READY / EXPORTED / FAILED / BLOCKED.
 * No object-storage writes happen here — download regenerates the CSV
 * deterministically from current data and stable batch membership.
 */

// Invoice-level export types mark invoices; aggregate types never do.
const AGGREGATE_EXPORT_TYPES = ["VENDOR_SUMMARY", "SOURCE_DOCUMENT_SUMMARY"];

export function isAggregateExportType(exportType: string): boolean {
  return AGGREGATE_EXPORT_TYPES.includes(exportType);
}

export interface ExportFilters {
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  vendorId?: number | null;
}

/**
 * Derive the file-export readiness status for an invoice.
 *   EXPORTED  – already exported in a prior batch
 *   BLOCKED   – status=EXCEPTION or validation/tie-out failing
 *   READY     – approved & clean & not yet exported
 *   null      – none of the above (not eligible for export yet)
 */
export function deriveExportStatus(invoice: {
  status?: string | null;
  validationStatus?: string | null;
  tieOutStatus?: string | null;
  exportStatus?: string | null;
}): "READY" | "BLOCKED" | "EXPORTED" | null {
  if (invoice.exportStatus === "EXPORTED") return "EXPORTED";
  if (
    invoice.status === "EXCEPTION" ||
    invoice.validationStatus === "FAILED" ||
    invoice.tieOutStatus === "FAIL"
  ) {
    return "BLOCKED";
  }
  if (
    invoice.status === "APPROVED" &&
    invoice.validationStatus !== "FAILED" &&
    invoice.tieOutStatus !== "FAIL"
  ) {
    return "READY";
  }
  return null;
}

/**
 * Build the WHERE clause selecting invoices for a given invoice export type,
 * narrowed by any caller-supplied filters.
 */
export function buildInvoiceConditions(
  exportType: string,
  filters: ExportFilters,
): SQL | undefined {
  const conditions: SQL[] = [ne(invoiceCaptureTable.status, "VOIDED")];

  switch (exportType) {
    case "AP_INVOICE_FILE":
    case "APPROVED": {
      // Default "Export Ready" selection.
      conditions.push(eq(invoiceCaptureTable.status, "APPROVED"));
      conditions.push(
        or(
          isNull(invoiceCaptureTable.validationStatus),
          ne(invoiceCaptureTable.validationStatus, "FAILED"),
        )!,
      );
      conditions.push(
        or(
          isNull(invoiceCaptureTable.tieOutStatus),
          ne(invoiceCaptureTable.tieOutStatus, "FAIL"),
        )!,
      );
      conditions.push(
        or(
          isNull(invoiceCaptureTable.exportStatus),
          ne(invoiceCaptureTable.exportStatus, "EXPORTED"),
        )!,
      );
      break;
    }
    case "POSTED":
      conditions.push(eq(invoiceCaptureTable.status, "POSTED"));
      break;
    case "ALL_ACTIVE":
      // All non-voided invoices (base condition already applied).
      break;
    case "EXCEPTIONS":
      conditions.push(eq(invoiceCaptureTable.status, "EXCEPTION"));
      break;
    case "TIE_OUT_FAILURES":
      conditions.push(eq(invoiceCaptureTable.tieOutStatus, "FAIL"));
      break;
    default:
      break;
  }

  applyFilters(conditions, filters);
  return and(...conditions);
}

/** Apply common invoice filters (vendorId, date range, status) in place. */
function applyFilters(conditions: SQL[], filters: ExportFilters) {
  if (filters.vendorId != null) {
    conditions.push(eq(invoiceCaptureTable.vendorId, filters.vendorId));
  }
  if (filters.dateFrom) {
    conditions.push(gte(invoiceCaptureTable.invoiceDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(invoiceCaptureTable.invoiceDate, filters.dateTo));
  }
  if (filters.status) {
    conditions.push(
      eq(
        invoiceCaptureTable.status,
        filters.status as (typeof invoiceCaptureTable.status.enumValues)[number],
      ),
    );
  }
}

/** Select the ids of invoices matching a WHERE clause. */
export async function selectInvoiceIds(where: SQL | undefined): Promise<number[]> {
  const rows = await db
    .select({ id: invoiceCaptureTable.id })
    .from(invoiceCaptureTable)
    .where(where);
  return rows.map((r) => r.id);
}

/** Mark the given invoices as Exported, recording the batch membership. */
export async function markInvoicesExported(
  ids: number[],
  batchId: string,
  fileName: string,
  format: string,
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(invoiceCaptureTable)
    .set({
      exportStatus: "EXPORTED",
      exportBatchId: batchId,
      exportedAt: new Date(),
      exportFileName: fileName,
      exportFormat: format,
    })
    .where(inArray(invoiceCaptureTable.id, ids));
}

// ─── CSV formatting helpers (mirror Phase 1 invoice CSV export) ──────────────
const pad = (n: number) => String(n).padStart(2, "0");

function fmtDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
    }
    return value;
  }
  return `${pad(value.getUTCMonth() + 1)}/${pad(value.getUTCDate())}/${value.getUTCFullYear()}`;
}

function fmtAmount(value: string | number | null | undefined): string {
  return value == null || value === "" ? "" : String(value);
}

function fmtPct(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100 * 10) / 10);
}

// ─── Invoice CSV ─────────────────────────────────────────────────────────────
const INVOICE_EXPORT_HEADERS = [
  "DocumentID",
  "BusinessDocumentID",
  "RecordID",
  "VendorID",
  "VendorNameMatched",
  "VendorRawName",
  "InvoiceNumber",
  "InvoiceDate",
  "DueDate",
  "PaymentTerms",
  "PONumberRaw",
  "Subtotal",
  "TaxAmount",
  "FreightAmount",
  "DiscountAmount",
  "OtherChargesAmount",
  "TotalAmount",
  "TieOutExpectedTotal",
  "TieOutDifference",
  "TieOutStatus",
  "TieOutExplanation",
  "Currency",
  "ExtractionConfidence",
  "VendorMatchScore",
  "ValidationStatus",
  "ExceptionReason",
  "ReviewStatus",
  "Status",
  "ExportStatus",
  "ExportBatchID",
  "FileName",
  "FileObjectPath",
  "SourceDocumentID",
  "InvoiceSequence",
  "PageStart",
  "PageEnd",
  "VoucherID",
  "CreatedAt",
  "ExportedAt",
];

/** Build the invoice-level CSV for a WHERE clause. Returns the CSV and row count. */
export async function buildInvoiceCsv(
  where: SQL | undefined,
): Promise<{ csv: string; count: number }> {
  const rows = await db
    .select({
      id: invoiceCaptureTable.id,
      documentId: invoiceCaptureTable.documentId,
      businessDocumentId: invoiceCaptureTable.businessDocumentId,
      status: invoiceCaptureTable.status,
      vendorId: invoiceCaptureTable.vendorId,
      vendorName: vendorIdTable.vendorName,
      vendorRawName: invoiceCaptureTable.vendorRawName,
      invoiceNumber: invoiceCaptureTable.invoiceNumber,
      invoiceDate: invoiceCaptureTable.invoiceDate,
      dueDate: invoiceCaptureTable.dueDate,
      paymentTerms: invoiceCaptureTable.paymentTerms,
      poNumber: invoiceCaptureTable.poNumber,
      subtotal: invoiceCaptureTable.subtotal,
      taxAmount: invoiceCaptureTable.taxAmount,
      freightAmount: invoiceCaptureTable.freightAmount,
      discountAmount: invoiceCaptureTable.discountAmount,
      otherChargesAmount: invoiceCaptureTable.otherChargesAmount,
      totalAmount: invoiceCaptureTable.totalAmount,
      tieOutExpectedTotal: invoiceCaptureTable.tieOutExpectedTotal,
      tieOutDifference: invoiceCaptureTable.tieOutDifference,
      tieOutStatus: invoiceCaptureTable.tieOutStatus,
      tieOutExplanation: invoiceCaptureTable.tieOutExplanation,
      currency: invoiceCaptureTable.currency,
      confidenceScore: invoiceCaptureTable.confidenceScore,
      vendorMatchScore: invoiceCaptureTable.vendorMatchScore,
      validationStatus: invoiceCaptureTable.validationStatus,
      exceptionReason: invoiceCaptureTable.exceptionReason,
      reviewStatus: invoiceCaptureTable.reviewStatus,
      exportStatus: invoiceCaptureTable.exportStatus,
      exportBatchId: invoiceCaptureTable.exportBatchId,
      originalFileName: invoiceCaptureTable.originalFileName,
      fileObjectPath: invoiceCaptureTable.fileObjectPath,
      sourceDocumentId: invoiceCaptureTable.sourceDocumentId,
      invoiceSequence: invoiceCaptureTable.invoiceSequence,
      pageStart: invoiceCaptureTable.pageStart,
      pageEnd: invoiceCaptureTable.pageEnd,
      voucherId: invoiceCaptureTable.voucherId,
      createdAt: invoiceCaptureTable.createdAt,
      exportedAt: invoiceCaptureTable.exportedAt,
    })
    .from(invoiceCaptureTable)
    .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
    .where(where)
    .orderBy(invoiceCaptureTable.createdAt);

  const dataRows = rows.map((r) => [
    r.documentId,
    r.businessDocumentId,
    r.id,
    r.vendorId,
    r.vendorName,
    r.vendorRawName,
    r.invoiceNumber,
    fmtDate(r.invoiceDate),
    fmtDate(r.dueDate),
    r.paymentTerms,
    r.poNumber,
    fmtAmount(r.subtotal),
    fmtAmount(r.taxAmount),
    fmtAmount(r.freightAmount),
    fmtAmount(r.discountAmount),
    fmtAmount(r.otherChargesAmount),
    fmtAmount(r.totalAmount),
    fmtAmount(r.tieOutExpectedTotal),
    fmtAmount(r.tieOutDifference),
    r.tieOutStatus,
    r.tieOutExplanation,
    r.currency,
    fmtPct(r.confidenceScore),
    fmtPct(r.vendorMatchScore),
    r.validationStatus,
    r.exceptionReason,
    r.reviewStatus,
    r.status,
    r.exportStatus,
    r.exportBatchId,
    r.originalFileName,
    r.fileObjectPath,
    r.sourceDocumentId,
    r.invoiceSequence,
    r.pageStart,
    r.pageEnd,
    r.voucherId,
    fmtDate(r.createdAt),
    fmtDate(r.exportedAt),
  ]);

  return { csv: toCsv(INVOICE_EXPORT_HEADERS, dataRows), count: rows.length };
}

/** Build the invoice CSV for a stable batch membership (download). */
export function buildInvoiceCsvForBatch(
  batchId: string,
): Promise<{ csv: string; count: number }> {
  return buildInvoiceCsv(eq(invoiceCaptureTable.exportBatchId, batchId));
}

// ─── Aggregate conditions ────────────────────────────────────────────────────
function buildAggregateConditions(filters: ExportFilters): SQL | undefined {
  const conditions: SQL[] = [ne(invoiceCaptureTable.status, "VOIDED")];
  applyFilters(conditions, filters);
  return and(...conditions);
}

// ─── Vendor summary CSV ──────────────────────────────────────────────────────
const VENDOR_SUMMARY_HEADERS = [
  "VendorID",
  "VendorCode",
  "VendorName",
  "InvoiceCount",
  "TotalAmount",
];

export async function buildVendorSummaryCsv(
  filters: ExportFilters,
): Promise<{ csv: string; count: number }> {
  const rows = await db
    .select({
      vendorId: invoiceCaptureTable.vendorId,
      vendorCode: vendorIdTable.vendorCode,
      vendorName: vendorIdTable.vendorName,
      invoiceCount: sql<number>`count(*)::int`,
      totalAmount: sql<string>`coalesce(sum(${invoiceCaptureTable.totalAmount}), 0)`,
    })
    .from(invoiceCaptureTable)
    .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
    .where(buildAggregateConditions(filters))
    .groupBy(
      invoiceCaptureTable.vendorId,
      vendorIdTable.vendorCode,
      vendorIdTable.vendorName,
    )
    .orderBy(desc(sql`count(*)`));

  const dataRows = rows.map((r) => [
    r.vendorId,
    r.vendorCode,
    r.vendorName,
    r.invoiceCount,
    fmtAmount(Number(r.totalAmount)),
  ]);

  return { csv: toCsv(VENDOR_SUMMARY_HEADERS, dataRows), count: rows.length };
}

// ─── Source-document summary CSV ─────────────────────────────────────────────
const SOURCE_DOCUMENT_SUMMARY_HEADERS = [
  "SourceDocumentID",
  "FileName",
  "InvoiceCount",
  "TotalAmount",
];

export async function buildSourceDocumentSummaryCsv(
  filters: ExportFilters,
): Promise<{ csv: string; count: number }> {
  const rows = await db
    .select({
      sourceDocumentId: invoiceCaptureTable.sourceDocumentId,
      fileName: sourceDocumentsTable.originalFileName,
      invoiceCount: sql<number>`count(*)::int`,
      totalAmount: sql<string>`coalesce(sum(${invoiceCaptureTable.totalAmount}), 0)`,
    })
    .from(invoiceCaptureTable)
    .leftJoin(
      sourceDocumentsTable,
      eq(invoiceCaptureTable.sourceDocumentId, sourceDocumentsTable.id),
    )
    .where(buildAggregateConditions(filters))
    .groupBy(
      invoiceCaptureTable.sourceDocumentId,
      sourceDocumentsTable.originalFileName,
    )
    .orderBy(desc(sql`count(*)`));

  const dataRows = rows.map((r) => [
    r.sourceDocumentId,
    r.fileName,
    r.invoiceCount,
    fmtAmount(Number(r.totalAmount)),
  ]);

  return {
    csv: toCsv(SOURCE_DOCUMENT_SUMMARY_HEADERS, dataRows),
    count: rows.length,
  };
}

/** Build the aggregate CSV for a given aggregate export type. */
export function buildAggregateCsv(
  exportType: string,
  filters: ExportFilters,
): Promise<{ csv: string; count: number }> {
  if (exportType === "VENDOR_SUMMARY") {
    return buildVendorSummaryCsv(filters);
  }
  return buildSourceDocumentSummaryCsv(filters);
}
