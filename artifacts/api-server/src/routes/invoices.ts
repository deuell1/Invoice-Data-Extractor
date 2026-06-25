import { Router, type IRouter } from "express";
import { applyVendorMatch, findBestVendorMatch } from "../services/vendorMatcher";
import { triggerExtraction } from "../services/extractionService";
import { validateInvoice, VENDOR_HARD_BLOCK_REASONS } from "../services/validationService";
import { eq, ne, sql, and, inArray, ilike, or, asc, desc, isNull } from "drizzle-orm";
import {
  db,
  invoiceCaptureTable,
  invoiceAuditLogTable,
  vendorIdTable,
  sourceDocumentsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  CreateInvoiceBody,
  UpdateInvoiceBody,
  UpdateInvoiceParams,
  UpdateInvoiceStatusBody,
  UpdateInvoiceStatusParams,
  GetInvoiceParams,
  ListInvoicesQueryParams,
  SetVoucherIdBody,
  SetVoucherIdParams,
  RejectInvoiceBody,
  RejectInvoiceParams,
  ApproveInvoiceParams,
  SubmitInvoiceParams,
  BulkApproveInvoicesBody,
  GetInvoiceResponse,
  ListInvoicesResponse,
  UpdateInvoiceResponse,
  UpdateInvoiceStatusResponse,
  SetVoucherIdResponse,
  RejectInvoiceResponse,
  ApproveInvoiceResponse,
  SubmitInvoiceResponse,
  BulkApproveInvoicesResponse,
  GetInvoiceStatsResponse,
  GetInvoiceAuditLogResponse,
  ExportInvoicesCsvQueryParams,
  CheckDuplicateParams,
  CheckDuplicateResponse,
  VoidInvoiceParams,
  VoidInvoiceBody,
  DeleteInvoiceParams,
  DeleteInvoiceBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ─── Helper: fetch invoice enriched with vendorName ─────────────────────────
async function getInvoiceById(id: number) {
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
      paymentTerms: invoiceCaptureTable.paymentTerms,
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

// ─── Helper: append audit log entry ─────────────────────────────────────────
async function appendAudit(params: {
  invoiceId: number;
  action: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  editorRole?: string;
  note?: string;
}) {
  await db.insert(invoiceAuditLogTable).values({
    invoiceId: params.invoiceId,
    action: params.action,
    fieldName: params.fieldName ?? null,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    editorRole: params.editorRole ?? null,
    note: params.note ?? null,
  });
}

// ─── Helper: delete a stored file only when nothing else references it ───────
// File-safety rule: the underlying source file must not be deleted while any
// other invoice row OR any source_document row still points at it. Returns
// whether the file was actually deleted.
async function deleteFileIfUnreferenced(fileObjectPath: string): Promise<boolean> {
  if (!fileObjectPath) return false;
  const [invoiceRefs, sourceRefs] = await Promise.all([
    db
      .select({ id: invoiceCaptureTable.id })
      .from(invoiceCaptureTable)
      .where(eq(invoiceCaptureTable.fileObjectPath, fileObjectPath))
      .limit(1),
    db
      .select({ id: sourceDocumentsTable.id })
      .from(sourceDocumentsTable)
      .where(eq(sourceDocumentsTable.fileObjectPath, fileObjectPath))
      .limit(1),
  ]);
  if (invoiceRefs.length > 0 || sourceRefs.length > 0) return false;
  try {
    await new ObjectStorageService().deleteObject(fileObjectPath);
    return true;
  } catch (err) {
    // Best-effort: never fail a delete operation because the blob could not be
    // removed (it may already be gone). The DB rows are already deleted.
    return false;
  }
}

// ─── Helper: check duplicate (same vendor + invoice number, different id) ────
async function isDuplicate(vendorId: number | null | undefined, invoiceNumber: string | null | undefined, excludeId?: number): Promise<boolean> {
  if (!vendorId || !invoiceNumber) return false;
  const conditions = [
    eq(invoiceCaptureTable.vendorId, vendorId),
    eq(invoiceCaptureTable.invoiceNumber, invoiceNumber),
    // Ignore voided/removed invoices — they are not active duplicates.
    ne(invoiceCaptureTable.status, "VOIDED"),
  ];
  if (excludeId != null) {
    const rows = await db
      .select({ id: invoiceCaptureTable.id })
      .from(invoiceCaptureTable)
      .where(and(...conditions))
      .limit(10);
    return rows.some((r) => r.id !== excludeId);
  }
  const rows = await db
    .select({ id: invoiceCaptureTable.id })
    .from(invoiceCaptureTable)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

// ─── Helper: resolve the controlled vendorId to use for duplicate detection ──
// When an explicit vendorId is present we use it. Otherwise we resolve the
// vendorRawName against the controlled Vendor_ID table and, ONLY if the match is
// at or above the vendor match threshold, return that controlled vendorId for
// the duplicate check. The resolved id is used for detection only — it is NEVER
// persisted to the invoice (vendor assignment stays in applyVendorMatch).
async function resolveVendorIdForDuplicate(
  vendorId: number | null | undefined,
  vendorRawName: string | null | undefined,
): Promise<number | null> {
  if (vendorId != null) return vendorId;
  if (!vendorRawName?.trim()) return null;
  const outcome = await findBestVendorMatch(vendorRawName);
  // matched | inactive | on_hold all mean score >= threshold (a confident match).
  if (
    outcome.status === "matched" ||
    outcome.status === "inactive" ||
    outcome.status === "on_hold"
  ) {
    return outcome.match.vendorId;
  }
  return null;
}

const DUPLICATE_MESSAGE = "Duplicate invoice detected for this vendor and invoice number.";

// ─── Serialize invoice row to API shape ─────────────────────────────────────
function serializeInvoice(row: Awaited<ReturnType<typeof getInvoiceById>>) {
  if (!row) return null;
  return {
    ...row,
    totalAmount: row.totalAmount != null ? Number(row.totalAmount) : null,
    taxAmount: row.taxAmount != null ? Number(row.taxAmount) : null,
    confidenceScore: row.confidenceScore != null ? Number(row.confidenceScore) : null,
    subtotal: row.subtotal != null ? Number(row.subtotal) : null,
    freightAmount: row.freightAmount != null ? Number(row.freightAmount) : null,
    vendorMatchScore: row.vendorMatchScore != null ? Number(row.vendorMatchScore) : null,
    lastExtractedAt:
      row.lastExtractedAt instanceof Date
        ? row.lastExtractedAt.toISOString()
        : (row.lastExtractedAt ?? null),
  };
}

// ─── GET /invoices ───────────────────────────────────────────────────────────
router.get("/invoices", async (req, res): Promise<void> => {
  const parsed = ListInvoicesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, includeRemoved, vendorId, search, sortBy, sortDir, page, limit } = parsed.data;
  const offset = ((page ?? 1) - 1) * (limit ?? 20);

  const conditions = [];
  if (status) {
    conditions.push(eq(invoiceCaptureTable.status, status));
  } else if (!includeRemoved) {
    // Exclude voided/removed invoices from the active list unless the caller
    // explicitly opts in (includeRemoved) or filters for VOIDED directly.
    conditions.push(ne(invoiceCaptureTable.status, "VOIDED"));
  }
  if (vendorId != null) {
    conditions.push(eq(invoiceCaptureTable.vendorId, vendorId));
  }
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(invoiceCaptureTable.invoiceNumber, pattern),
        ilike(vendorIdTable.vendorName, pattern),
      )!
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const sortColumn = (() => {
    const dir = sortDir === "asc" ? asc : desc;
    switch (sortBy) {
      case "invoiceDate": return dir(invoiceCaptureTable.invoiceDate);
      case "totalAmount": return dir(invoiceCaptureTable.totalAmount);
      case "vendorName": return dir(vendorIdTable.vendorName);
      default: return dir(invoiceCaptureTable.createdAt);
    }
  })();

  const baseQuery = db
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
      paymentTerms: invoiceCaptureTable.paymentTerms,
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
    .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id));

  const [rows, countRows] = await Promise.all([
    baseQuery
      .where(whereClause)
      .orderBy(sortColumn)
      .limit(limit ?? 20)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoiceCaptureTable)
      .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
      .where(whereClause),
  ]);

  res.json(
    ListInvoicesResponse.parse({
      data: rows.map(serializeInvoice),
      total: countRows[0]?.count ?? 0,
      page: page ?? 1,
      limit: limit ?? 20,
    })
  );
});

// ─── POST /invoices ──────────────────────────────────────────────────────────
router.post("/invoices", async (req, res): Promise<void> => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Resolve a controlled vendorId from vendorRawName when no explicit vendorId
  // was supplied, so intake duplicate detection fires even before the vendor is
  // assigned. The resolved id is used for the check only — never persisted.
  const createDupVendorId = await resolveVendorIdForDuplicate(
    parsed.data.vendorId,
    parsed.data.vendorRawName,
  );
  if (await isDuplicate(createDupVendorId, parsed.data.invoiceNumber)) {
    res.status(409).json({ error: DUPLICATE_MESSAGE });
    return;
  }

  const [invoice] = await db
    .insert(invoiceCaptureTable)
    .values({
      ...parsed.data,
      status: "PENDING_EXTRACTION",
      totalAmount: parsed.data.totalAmount != null ? String(parsed.data.totalAmount) : null,
      taxAmount: parsed.data.taxAmount != null ? String(parsed.data.taxAmount) : null,
      confidenceScore: parsed.data.confidenceScore != null ? String(parsed.data.confidenceScore) : null,
    })
    .returning();

  // Generate human-readable DocumentID now that we have the auto-increment id
  const documentId = `INV-CAP-${String(invoice.id).padStart(6, "0")}`;
  await db
    .update(invoiceCaptureTable)
    .set({ documentId })
    .where(eq(invoiceCaptureTable.id, invoice.id));

  await appendAudit({
    invoiceId: invoice.id,
    action: "CREATED",
    note: `Invoice created from file: ${invoice.originalFileName}`,
  });

  const rawName = parsed.data.vendorRawName ?? null;
  if (rawName) {
    // Fields were supplied directly (e.g. manual entry): match synchronously.
    await applyVendorMatch(invoice.id, rawName);
    await db
      .update(invoiceCaptureTable)
      .set({ extractionStatus: "COMPLETED" })
      .where(eq(invoiceCaptureTable.id, invoice.id));
  } else {
    // No extracted fields yet: kick off extraction in the background.
    triggerExtraction(invoice.id);
  }

  const row = await getInvoiceById(invoice.id);
  res.status(201).json(GetInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── POST /invoices/:id/extract ──────────────────────────────────────────────
router.post("/invoices/:id/extract", async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  // Idempotency guard: don't kick off a second run while one is already in flight.
  if (existing.extractionStatus === "PROCESSING") {
    res.json(GetInvoiceResponse.parse(serializeInvoice(existing)));
    return;
  }

  await db
    .update(invoiceCaptureTable)
    .set({ extractionStatus: "PROCESSING", extractionError: null })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  triggerExtraction(params.data.id);

  const row = await getInvoiceById(params.data.id);
  res.json(GetInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── GET /invoices/stats ─────────────────────────────────────────────────────
router.get("/invoices/stats", async (_req, res): Promise<void> => {
  const [countRows, amountRow, needsReviewRow] = await Promise.all([
    db
      .select({
        status: invoiceCaptureTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(invoiceCaptureTable)
      .where(ne(invoiceCaptureTable.status, "VOIDED"))
      .groupBy(invoiceCaptureTable.status),
    db
      .select({ total: sql<number>`coalesce(sum(total_amount::numeric), 0)::float` })
      .from(invoiceCaptureTable)
      .where(inArray(invoiceCaptureTable.status, ["APPROVED", "POSTED"])),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoiceCaptureTable)
      .where(
        and(
          eq(invoiceCaptureTable.reviewStatus, "NEEDS_REVIEW"),
          ne(invoiceCaptureTable.status, "VOIDED"),
        ),
      ),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of countRows) {
    byStatus[row.status] = row.count;
    total += row.count;
  }

  res.json(
    GetInvoiceStatsResponse.parse({
      total,
      pendingExtraction: byStatus["PENDING_EXTRACTION"] ?? 0,
      exception: byStatus["EXCEPTION"] ?? 0,
      pendingApproval: byStatus["PENDING_APPROVAL"] ?? 0,
      approved: byStatus["APPROVED"] ?? 0,
      posted: byStatus["POSTED"] ?? 0,
      needsReview: needsReviewRow[0]?.count ?? 0,
      totalApprovedAmount: amountRow[0]?.total ?? 0,
    })
  );
});

// ─── GET /invoices/export ────────────────────────────────────────────────────
router.get("/invoices/export", async (req, res): Promise<void> => {
  const parsed = ExportInvoicesCsvQueryParams.safeParse(req.query);
  const status = parsed.success ? (parsed.data.status ?? "APPROVED") : "APPROVED";

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
      totalAmount: invoiceCaptureTable.totalAmount,
      currency: invoiceCaptureTable.currency,
      confidenceScore: invoiceCaptureTable.confidenceScore,
      vendorMatchScore: invoiceCaptureTable.vendorMatchScore,
      validationStatus: invoiceCaptureTable.validationStatus,
      exceptionReason: invoiceCaptureTable.exceptionReason,
      reviewStatus: invoiceCaptureTable.reviewStatus,
      originalFileName: invoiceCaptureTable.originalFileName,
      fileObjectPath: invoiceCaptureTable.fileObjectPath,
      sourceDocumentId: invoiceCaptureTable.sourceDocumentId,
      invoiceSequence: invoiceCaptureTable.invoiceSequence,
      pageStart: invoiceCaptureTable.pageStart,
      pageEnd: invoiceCaptureTable.pageEnd,
      voucherId: invoiceCaptureTable.voucherId,
      createdAt: invoiceCaptureTable.createdAt,
    })
    .from(invoiceCaptureTable)
    .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
    .where(eq(invoiceCaptureTable.status, status as "APPROVED" | "POSTED"))
    .orderBy(invoiceCaptureTable.createdAt);

  // ── CSV formatting helpers ──────────────────────────────────────────────────
  const pad = (n: number) => String(n).padStart(2, "0");
  // Format any date-ish value to mm/dd/yyyy; leave unparseable text as-is.
  const fmtDate = (value: string | Date | null | undefined): string => {
    if (value == null || value === "") return "";
    if (typeof value === "string") {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[2]}/${m[3]}/${m[1]}`;
      const d = new Date(value);
      if (!isNaN(d.getTime())) return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
      return value;
    }
    return `${pad(value.getUTCMonth() + 1)}/${pad(value.getUTCDate())}/${value.getUTCFullYear()}`;
  };
  // Pass numeric values through as plain numbers (no $ or thousands separators).
  const fmtAmount = (value: string | null | undefined): string =>
    value == null || value === "" ? "" : String(value);
  // Confidence/score columns are stored 0–1; export on a 0–100 scale.
  const fmtPct = (value: string | null | undefined): string => {
    if (value == null || value === "") return "";
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return String(Math.round(n * 100 * 10) / 10);
  };
  // Quote only when needed so numeric columns stay summable in Excel.
  // Text cells beginning with a spreadsheet formula trigger (= + - @, tab, CR)
  // are prefixed with a single quote to prevent CSV/formula injection.
  const cell = (value: string | number | null | undefined): string => {
    let s = value == null ? "" : String(value);
    // Guard against formula triggers, but keep real numbers (incl. negatives) numeric.
    if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) {
      s = `'${s}`;
    }
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportedAt = fmtDate(new Date());

  const header = [
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
    "TotalAmount",
    "Currency",
    "ExtractionConfidence",
    "VendorMatchScore",
    "ValidationStatus",
    "ExceptionReason",
    "ReviewStatus",
    "Status",
    "FileName",
    "FileObjectPath",
    "SourceDocumentID",
    "InvoiceSequence",
    "PageStart",
    "PageEnd",
    "VoucherID",
    "CreatedAt",
    "ExportedAt",
  ].join(",");

  const csvRows = rows.map((r) =>
    [
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
      fmtAmount(r.totalAmount),
      r.currency,
      fmtPct(r.confidenceScore),
      fmtPct(r.vendorMatchScore),
      r.validationStatus,
      r.exceptionReason,
      r.reviewStatus,
      r.status,
      r.originalFileName,
      r.fileObjectPath,
      r.sourceDocumentId,
      r.invoiceSequence,
      r.pageStart,
      r.pageEnd,
      r.voucherId,
      fmtDate(r.createdAt),
      exportedAt,
    ]
      .map(cell)
      .join(",")
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="invoices-${status.toLowerCase()}.csv"`);
  // Prepend a UTF-8 BOM so Excel opens the file with correct encoding.
  res.send("\uFEFF" + [header, ...csvRows].join("\r\n"));
});

// ─── POST /invoices/:id/match-vendor ─────────────────────────────────────────
router.post("/invoices/:id/match-vendor", async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (!existing.vendorRawName) {
    res.status(409).json({ error: "Invoice has no vendorRawName to match against" });
    return;
  }

  await applyVendorMatch(params.data.id, existing.vendorRawName);

  // Re-run validation so check fields and routing reflect the new vendor match.
  await validateInvoice(params.data.id);

  const row = await getInvoiceById(params.data.id);
  res.json(GetInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── GET /invoices/:id ───────────────────────────────────────────────────────
router.get("/invoices/:id", async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const row = await getInvoiceById(params.data.id);
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json(GetInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── PATCH /invoices/:id ─────────────────────────────────────────────────────
router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const params = UpdateInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const newVendorId = parsed.data.vendorId !== undefined ? parsed.data.vendorId : existing.vendorId;
  const newInvoiceNumber = parsed.data.invoiceNumber !== undefined ? parsed.data.invoiceNumber : existing.invoiceNumber;
  const newVendorRawName =
    parsed.data.vendorRawName !== undefined ? parsed.data.vendorRawName : existing.vendorRawName;

  // When the vendor isn't explicitly set, resolve it from vendorRawName so that
  // manual edits to the raw name or invoice number still trip duplicate detection.
  const patchDupVendorId = await resolveVendorIdForDuplicate(newVendorId, newVendorRawName);
  if (await isDuplicate(patchDupVendorId, newInvoiceNumber, params.data.id)) {
    res.status(409).json({ error: DUPLICATE_MESSAGE });
    return;
  }

  const updates: Record<string, unknown> = {};
  const auditEntries: Array<{ field: string; old: string; newVal: string }> = [];

  function track(field: string, oldVal: unknown, newVal: unknown, dbKey: string) {
    if (newVal !== undefined && String(newVal ?? "") !== String(oldVal ?? "")) {
      updates[dbKey] = newVal != null ? String(newVal) : null;
      auditEntries.push({ field, old: String(oldVal ?? ""), newVal: String(newVal ?? "") });
    }
  }

  track("vendorId", existing.vendorId, parsed.data.vendorId, "vendorId");
  track("invoiceNumber", existing.invoiceNumber, parsed.data.invoiceNumber, "invoiceNumber");
  track("invoiceDate", existing.invoiceDate, parsed.data.invoiceDate, "invoiceDate");
  track("dueDate", existing.dueDate, parsed.data.dueDate, "dueDate");
  track("totalAmount", existing.totalAmount, parsed.data.totalAmount, "totalAmount");
  track("taxAmount", existing.taxAmount, parsed.data.taxAmount, "taxAmount");
  track("poNumber", existing.poNumber, parsed.data.poNumber, "poNumber");
  track("currency", existing.currency, parsed.data.currency, "currency");
  track("vendorRawName", existing.vendorRawName, parsed.data.vendorRawName, "vendorRawName");

  if (Object.keys(updates).length > 0) {
    await db
      .update(invoiceCaptureTable)
      .set(updates)
      .where(eq(invoiceCaptureTable.id, params.data.id));

    for (const entry of auditEntries) {
      await appendAudit({
        invoiceId: params.data.id,
        action: "FIELD_UPDATED",
        fieldName: entry.field,
        oldValue: entry.old,
        newValue: entry.newVal,
        editorRole: parsed.data.editorRole ?? "AP_PROCESSOR",
      });
    }

    // Re-run the authoritative validation engine after manual corrections so the
    // vendor flagging rules re-apply and the business DocumentID is recomputed
    // (e.g. AP fixed the vendor, invoice number, or total).
    await validateInvoice(params.data.id);
  }

  const row = await getInvoiceById(params.data.id);
  res.json(UpdateInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── PATCH /invoices/:id/status ──────────────────────────────────────────────
router.patch("/invoices/:id/status", async (req, res): Promise<void> => {
  const params = UpdateInvoiceStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateInvoiceStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  // Protect the terminal POSTED state — a posted invoice (with a voucher, in the
  // GL) must not be moved by the general-purpose status endpoint.
  if (existing.status === "POSTED") {
    res.status(422).json({ error: "A posted invoice cannot change status." });
    return;
  }

  // Approval and posting carry workflow controls (documented reason, re-validation,
  // voucher assignment) that live on the dedicated approve/voucher endpoints. The
  // general-purpose status endpoint must not be used to reach those states,
  // otherwise it would bypass those guards.
  if (parsed.data.status === "APPROVED" || parsed.data.status === "POSTED") {
    res.status(422).json({
      error:
        "Use the approve or voucher actions to approve or post an invoice; status cannot be set directly.",
    });
    return;
  }

  await db
    .update(invoiceCaptureTable)
    .set({
      status: parsed.data.status,
      exceptionReason: parsed.data.reason ?? null,
    })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendAudit({
    invoiceId: params.data.id,
    action: "STATUS_CHANGED",
    oldValue: existing.status,
    newValue: parsed.data.status,
    note: parsed.data.reason ?? undefined,
  });

  const row = await getInvoiceById(params.data.id);
  res.json(UpdateInvoiceStatusResponse.parse(serializeInvoice(row)));
});

// ─── POST /invoices/:id/void ─────────────────────────────────────────────────
// Soft-removal: mark an invoice VOIDED with a required reason. Voided invoices
// are excluded from active lists, queues, KPIs, CSV export and duplicate
// detection by default.
router.post("/invoices/:id/void", async (req, res): Promise<void> => {
  const params = VoidInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = VoidInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "A removal reason is required." });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (existing.status === "VOIDED") {
    res.json(GetInvoiceResponse.parse(serializeInvoice(existing)));
    return;
  }

  const actor = parsed.data.actor ?? null;
  await db
    .update(invoiceCaptureTable)
    .set({
      status: "VOIDED",
      removedAt: new Date(),
      removedBy: actor,
      removalReason: parsed.data.reason,
      removalNote: parsed.data.note ?? null,
    })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendAudit({
    invoiceId: params.data.id,
    action: "VOIDED",
    oldValue: existing.status,
    newValue: "VOIDED",
    editorRole: actor ?? undefined,
    note: parsed.data.note ? `${parsed.data.reason} — ${parsed.data.note}` : parsed.data.reason,
  });

  const row = await getInvoiceById(params.data.id);
  res.json(GetInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── DELETE /invoices/:id ────────────────────────────────────────────────────
// Permanent hard delete for test-data cleanup. Posted invoices cannot be
// hard-deleted (they must be voided/removed). Audit records are removed first to
// satisfy the FK, and the stored file is deleted only when nothing else still
// references it.
router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const params = DeleteInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = DeleteInvoiceBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirm !== true) {
    res.status(422).json({ error: "Deletion must be explicitly confirmed." });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (existing.status === "POSTED") {
    res.status(422).json({
      error: "A posted invoice cannot be hard-deleted. Void or remove it instead.",
    });
    return;
  }

  // Delete the audit trail and invoice atomically so a mid-operation failure
  // cannot leave dangling audit rows or a half-deleted record.
  await db.transaction(async (tx) => {
    await tx
      .delete(invoiceAuditLogTable)
      .where(eq(invoiceAuditLogTable.invoiceId, params.data.id));
    await tx.delete(invoiceCaptureTable).where(eq(invoiceCaptureTable.id, params.data.id));
  });

  // Only attempt to delete the stored file when this invoice is not tied to a
  // source document. Source-document files are owned by the source document and
  // are only removed when the source document itself is deleted.
  let fileDeleted = false;
  if (existing.sourceDocumentId == null && existing.fileObjectPath) {
    fileDeleted = await deleteFileIfUnreferenced(existing.fileObjectPath);
  }

  res.json({
    deleted: true,
    deletedInvoiceIds: [params.data.id],
    deletedSourceDocumentId: null,
    fileDeleted,
  });
});

// ─── PATCH /invoices/:id/voucher ─────────────────────────────────────────────
router.patch("/invoices/:id/voucher", async (req, res): Promise<void> => {
  const params = SetVoucherIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = SetVoucherIdBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  // Only approved (or already posted) invoices can be posted with a voucher.
  // This prevents an un-approved or in-exception invoice from skipping approval.
  if (existing.status !== "APPROVED" && existing.status !== "POSTED") {
    res.status(422).json({
      error: "Only approved invoices can be assigned a voucher and posted.",
    });
    return;
  }

  // Posting is blocked on a duplicate — a later-created invoice could have made
  // this one a duplicate after approval. Resolve the controlled vendor (never
  // persisted) and check against active (non-VOIDED) invoices.
  const voucherDupVendorId = await resolveVendorIdForDuplicate(
    existing.vendorId,
    existing.vendorRawName,
  );
  if (await isDuplicate(voucherDupVendorId, existing.invoiceNumber, params.data.id)) {
    res.status(409).json({ error: DUPLICATE_MESSAGE });
    return;
  }

  await db
    .update(invoiceCaptureTable)
    .set({ voucherId: parsed.data.voucherId, status: "POSTED" })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendAudit({
    invoiceId: params.data.id,
    action: "VOUCHER_SET",
    oldValue: existing.status,
    newValue: parsed.data.voucherId,
  });

  const row = await getInvoiceById(params.data.id);
  res.json(SetVoucherIdResponse.parse(serializeInvoice(row)));
});

// ─── POST /invoices/:id/approve ──────────────────────────────────────────────
router.post("/invoices/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  if (existing.status === "APPROVED" || existing.status === "POSTED") {
    res.status(409).json({ error: "Invoice is already approved." });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const isExceptionApproval = existing.status === "EXCEPTION";

  // Exception approval requires a documented reason (override).
  if (isExceptionApproval && !reason) {
    res.status(422).json({
      error: "A documented reason is required to approve an invoice that is in exception.",
    });
    return;
  }

  // Re-run validation before allowing approval.
  const outcome = await validateInvoice(params.data.id);

  // Missing or unverified vendor is a HARD block: an invoice without a vendor name
  // or without a confident match to the controlled vendor list can never be
  // approved, even with a documented exception override. (Inactive/On-Hold vendors
  // are matched and remain overridable with a documented reason.)
  const vendorHardBlock = outcome.blocking.filter((b) =>
    VENDOR_HARD_BLOCK_REASONS.includes(b),
  );
  if (vendorHardBlock.length > 0) {
    res.status(422).json({
      error: `Cannot approve — vendor must be matched to the controlled vendor list: ${vendorHardBlock.join("; ")}`,
    });
    return;
  }

  // A duplicate is a HARD block on approval — it can never be exception-overridden.
  // This guarantees a duplicate invoice cannot reach APPROVED (and therefore cannot
  // be posted or exported).
  if (outcome.checks.duplicateCheck === "FAIL") {
    res.status(409).json({ error: DUPLICATE_MESSAGE });
    return;
  }

  // Block approval if validation now finds blocking issues — unless this is a
  // documented exception override.
  if (outcome.blocking.length > 0 && !isExceptionApproval) {
    res.status(422).json({
      error: `Cannot approve — validation failed: ${outcome.blocking.join("; ")}`,
    });
    return;
  }

  await db
    .update(invoiceCaptureTable)
    .set({ status: "APPROVED", overallReviewStatus: "APPROVED" })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendAudit({
    invoiceId: params.data.id,
    action: "APPROVED",
    oldValue: existing.status,
    newValue: "APPROVED",
    editorRole: "AP_APPROVER",
    note: isExceptionApproval
      ? `Exception override. Reason: ${reason}${outcome.blocking.length > 0 ? ` | Overridden: ${outcome.blocking.join("; ")}` : ""}`
      : reason || undefined,
  });

  const row = await getInvoiceById(params.data.id);
  res.json(ApproveInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── POST /invoices/:id/reject ───────────────────────────────────────────────
router.post("/invoices/:id/reject", async (req, res): Promise<void> => {
  const params = RejectInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = RejectInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  // A posted invoice is terminal (voucher assigned, in the GL) and cannot be
  // reversed via reject.
  if (existing.status === "POSTED") {
    res.status(422).json({ error: "A posted invoice cannot be rejected." });
    return;
  }

  await db
    .update(invoiceCaptureTable)
    .set({
      status: "EXCEPTION",
      exceptionReason: parsed.data.reason,
    })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendAudit({
    invoiceId: params.data.id,
    action: "REJECTED",
    oldValue: existing.status,
    newValue: "EXCEPTION",
    note: parsed.data.reason,
    editorRole: "AP_APPROVER",
  });

  const row = await getInvoiceById(params.data.id);
  res.json(RejectInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── POST /invoices/:id/submit ───────────────────────────────────────────────
router.post("/invoices/:id/submit", async (req, res): Promise<void> => {
  const params = SubmitInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const existing = await getInvoiceById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  // Run the authoritative validation engine first — it persists all check
  // fields and routes the invoice (exception / needs-review / pending approval).
  // Running it unconditionally ensures submit never bypasses the validator
  // (a missing vendor, for example, becomes a blocking check → exception).
  const outcome = await validateInvoice(params.data.id);

  // Surface duplicates with an explicit 409 for the client. Validation has
  // already run and persisted, so the validator is never bypassed.
  if (outcome.checks.duplicateCheck === "FAIL") {
    res.status(409).json({ error: DUPLICATE_MESSAGE });
    return;
  }

  await appendAudit({
    invoiceId: params.data.id,
    action: "SUBMITTED",
    oldValue: existing.status,
    newValue: outcome.blocking.length > 0 ? "EXCEPTION" : "PENDING_APPROVAL",
  });

  const row = await getInvoiceById(params.data.id);
  res.json(SubmitInvoiceResponse.parse(serializeInvoice(row)));
});

// ─── POST /invoices/bulk-approve ─────────────────────────────────────────────
router.post("/invoices/bulk-approve", async (req, res): Promise<void> => {
  const parsed = BulkApproveInvoicesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of parsed.data.ids) {
    try {
      const row = await getInvoiceById(id);
      if (!row) {
        failed++;
        errors.push(`Invoice ${id}: not found`);
        continue;
      }
      if (row.status === "APPROVED" || row.status === "POSTED") {
        failed++;
        errors.push(`Invoice ${id}: already approved`);
        continue;
      }
      // Exception invoices require a documented reason — approve individually.
      if (row.status === "EXCEPTION") {
        failed++;
        errors.push(`Invoice ${id}: in exception — approve individually with a documented reason`);
        continue;
      }

      // Re-run validation before approving.
      const outcome = await validateInvoice(id);
      if (outcome.blocking.length > 0) {
        failed++;
        errors.push(`Invoice ${id}: validation failed — ${outcome.blocking.join("; ")}`);
        continue;
      }

      await db
        .update(invoiceCaptureTable)
        .set({ status: "APPROVED", overallReviewStatus: "APPROVED" })
        .where(eq(invoiceCaptureTable.id, id));
      await appendAudit({
        invoiceId: id,
        action: "APPROVED",
        oldValue: row.status,
        newValue: "APPROVED",
        editorRole: "AP_APPROVER",
      });
      succeeded++;
    } catch (err) {
      failed++;
      errors.push(`Invoice ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json(BulkApproveInvoicesResponse.parse({ succeeded, failed, errors }));
});

// ─── POST /invoices/:id/check-duplicate ──────────────────────────────────────
router.post("/invoices/:id/check-duplicate", async (req, res): Promise<void> => {
  const params = CheckDuplicateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const invoice = await getInvoiceById(params.data.id);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const { vendorId, invoiceNumber, totalAmount, invoiceDate, vendorRawName } = invoice;

  // Resolve a controlled vendorId from vendorRawName when the invoice has no
  // assigned vendor yet, so duplicate detection still works during intake. The
  // resolved id is used for the check only and is never persisted here.
  const effectiveVendorId = await resolveVendorIdForDuplicate(vendorId, vendorRawName);

  // ── Step 1: Exact match — same vendor + invoice number, any active status ──
  // (Excludes only VOIDED, consistent with create/patch/validation duplicate checks.)
  if (effectiveVendorId && invoiceNumber) {
    const exactMatches = await db
      .select({ id: invoiceCaptureTable.id })
      .from(invoiceCaptureTable)
      .where(
        and(
          eq(invoiceCaptureTable.vendorId, effectiveVendorId),
          eq(invoiceCaptureTable.invoiceNumber, invoiceNumber),
          ne(invoiceCaptureTable.status, "VOIDED"),
          sql`${invoiceCaptureTable.id} <> ${params.data.id}`,
        )
      );

    if (exactMatches.length > 0) {
      res.json(
        CheckDuplicateResponse.parse({
          isDuplicate: true,
          matchedIds: exactMatches.map((r) => r.id),
          riskScore: 1.0,
          matchType: "exact",
        })
      );
      return;
    }
  }

  // ── Step 2: Fuzzy match — same vendor, amount ±1%, date ±3 days ─────────────
  if (effectiveVendorId && totalAmount != null && invoiceDate) {
    const amount = Number(totalAmount);
    const minAmount = amount * 0.99;
    const maxAmount = amount * 1.01;

    const fuzzyMatches = await db
      .select({ id: invoiceCaptureTable.id })
      .from(invoiceCaptureTable)
      .where(
        and(
          eq(invoiceCaptureTable.vendorId, effectiveVendorId),
          ne(invoiceCaptureTable.status, "VOIDED"),
          sql`${invoiceCaptureTable.id} <> ${params.data.id}`,
          sql`${invoiceCaptureTable.totalAmount}::numeric BETWEEN ${minAmount}::numeric AND ${maxAmount}::numeric`,
          sql`${invoiceCaptureTable.invoiceDate}::date BETWEEN (${invoiceDate}::date - INTERVAL '3 days') AND (${invoiceDate}::date + INTERVAL '3 days')`,
        )
      );

    if (fuzzyMatches.length > 0) {
      res.json(
        CheckDuplicateResponse.parse({
          isDuplicate: true,
          matchedIds: fuzzyMatches.map((r) => r.id),
          riskScore: 0.7,
          matchType: "fuzzy",
        })
      );
      return;
    }
  }

  // ── No duplicate found ───────────────────────────────────────────────────────
  res.json(
    CheckDuplicateResponse.parse({
      isDuplicate: false,
      matchedIds: [],
      riskScore: 0,
      matchType: "none",
    })
  );
});

// ─── GET /invoices/:id/audit ─────────────────────────────────────────────────
router.get("/invoices/:id/audit", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid invoice ID" });
    return;
  }

  const rows = await db
    .select()
    .from(invoiceAuditLogTable)
    .where(eq(invoiceAuditLogTable.invoiceId, id))
    .orderBy(invoiceAuditLogTable.createdAt);

  res.json(GetInvoiceAuditLogResponse.parse(rows));
});

export default router;
