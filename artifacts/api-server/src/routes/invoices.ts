import { Router, type IRouter } from "express";
import { applyVendorMatch } from "../services/vendorMatcher";
import { triggerExtraction } from "../services/extractionService";
import { eq, sql, and, inArray, ilike, or, asc, desc } from "drizzle-orm";
import { db, invoiceCaptureTable, invoiceAuditLogTable, vendorIdTable } from "@workspace/db";
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
} from "@workspace/api-zod";

const router: IRouter = Router();

// Phase 1 requirement: route to EXCEPTION when confidence is below 85%
const CONFIDENCE_THRESHOLD = 0.85;

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
      extractionStatus: invoiceCaptureTable.extractionStatus,
      extractionError: invoiceCaptureTable.extractionError,
      extractionNotes: invoiceCaptureTable.extractionNotes,
      lastExtractedAt: invoiceCaptureTable.lastExtractedAt,
      role: invoiceCaptureTable.role,
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

// ─── Helper: check duplicate (same vendor + invoice number, different id) ────
async function isDuplicate(vendorId: number | null | undefined, invoiceNumber: string | null | undefined, excludeId?: number): Promise<boolean> {
  if (!vendorId || !invoiceNumber) return false;
  const conditions = [
    eq(invoiceCaptureTable.vendorId, vendorId),
    eq(invoiceCaptureTable.invoiceNumber, invoiceNumber),
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
  const { status, vendorId, search, sortBy, sortDir, page, limit } = parsed.data;
  const offset = ((page ?? 1) - 1) * (limit ?? 20);

  const conditions = [];
  if (status) {
    conditions.push(eq(invoiceCaptureTable.status, status));
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
      extractionStatus: invoiceCaptureTable.extractionStatus,
      extractionError: invoiceCaptureTable.extractionError,
      extractionNotes: invoiceCaptureTable.extractionNotes,
      lastExtractedAt: invoiceCaptureTable.lastExtractedAt,
      role: invoiceCaptureTable.role,
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

  if (await isDuplicate(parsed.data.vendorId, parsed.data.invoiceNumber)) {
    res.status(409).json({ error: "Duplicate invoice (same vendor + invoice number)" });
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
  const [countRows, amountRow] = await Promise.all([
    db
      .select({
        status: invoiceCaptureTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(invoiceCaptureTable)
      .groupBy(invoiceCaptureTable.status),
    db
      .select({ total: sql<number>`coalesce(sum(total_amount::numeric), 0)::float` })
      .from(invoiceCaptureTable)
      .where(inArray(invoiceCaptureTable.status, ["APPROVED", "POSTED"])),
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
      status: invoiceCaptureTable.status,
      vendorName: vendorIdTable.vendorName,
      vendorRawName: invoiceCaptureTable.vendorRawName,
      invoiceNumber: invoiceCaptureTable.invoiceNumber,
      invoiceDate: invoiceCaptureTable.invoiceDate,
      dueDate: invoiceCaptureTable.dueDate,
      subtotal: invoiceCaptureTable.subtotal,
      freightAmount: invoiceCaptureTable.freightAmount,
      totalAmount: invoiceCaptureTable.totalAmount,
      taxAmount: invoiceCaptureTable.taxAmount,
      poNumber: invoiceCaptureTable.poNumber,
      paymentTerms: invoiceCaptureTable.paymentTerms,
      currency: invoiceCaptureTable.currency,
      voucherId: invoiceCaptureTable.voucherId,
      confidenceScore: invoiceCaptureTable.confidenceScore,
      vendorMatchScore: invoiceCaptureTable.vendorMatchScore,
      createdAt: invoiceCaptureTable.createdAt,
    })
    .from(invoiceCaptureTable)
    .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
    .where(eq(invoiceCaptureTable.status, status as "APPROVED" | "POSTED"))
    .orderBy(invoiceCaptureTable.createdAt);

  const header = "documentId,id,status,vendorName,vendorRawName,invoiceNumber,invoiceDate,dueDate,subtotal,freightAmount,totalAmount,taxAmount,currency,paymentTerms,poNumber,voucherId,confidenceScore,vendorMatchScore,createdAt";
  const csvRows = rows.map((r) =>
    [
      r.documentId ?? "",
      r.id,
      r.status,
      r.vendorName ?? "",
      r.vendorRawName ?? "",
      r.invoiceNumber ?? "",
      r.invoiceDate ?? "",
      r.dueDate ?? "",
      r.subtotal ?? "",
      r.freightAmount ?? "",
      r.totalAmount ?? "",
      r.taxAmount ?? "",
      r.currency,
      r.paymentTerms ?? "",
      r.poNumber ?? "",
      r.voucherId ?? "",
      r.confidenceScore ?? "",
      r.vendorMatchScore ?? "",
      r.createdAt.toISOString(),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="invoices-${status.toLowerCase()}.csv"`);
  res.send([header, ...csvRows].join("\n"));
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

  if (await isDuplicate(newVendorId, newInvoiceNumber, params.data.id)) {
    res.status(409).json({ error: "Duplicate invoice (same vendor + invoice number)" });
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

  await db
    .update(invoiceCaptureTable)
    .set({ voucherId: parsed.data.voucherId, status: "POSTED" })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendAudit({
    invoiceId: params.data.id,
    action: "VOUCHER_SET",
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

  await db
    .update(invoiceCaptureTable)
    .set({ status: "APPROVED" })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendAudit({
    invoiceId: params.data.id,
    action: "APPROVED",
    oldValue: existing.status,
    newValue: "APPROVED",
    editorRole: "AP_APPROVER",
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

  // Vendor must be matched before submission
  if (!existing.vendorId) {
    res.status(422).json({ error: "A vendor must be selected before submitting this invoice for approval." });
    return;
  }

  // Check for duplicate before submitting
  if (await isDuplicate(existing.vendorId, existing.invoiceNumber, params.data.id)) {
    res.status(409).json({ error: "Duplicate invoice (same vendor + invoice number)" });
    return;
  }

  // Check confidence: route to EXCEPTION if low
  const score = existing.confidenceScore != null ? Number(existing.confidenceScore) : null;
  const hasLowConfidence = existing.lowConfidenceFields && existing.lowConfidenceFields.length > 0;
  const routeToException = score != null && score < CONFIDENCE_THRESHOLD;

  if (routeToException || hasLowConfidence) {
    await db
      .update(invoiceCaptureTable)
      .set({
        status: "EXCEPTION",
        exceptionReason: routeToException
          ? `Low confidence score: ${score?.toFixed(2)}`
          : `Low confidence fields: ${existing.lowConfidenceFields}`,
      })
      .where(eq(invoiceCaptureTable.id, params.data.id));

    await appendAudit({
      invoiceId: params.data.id,
      action: "ROUTED_TO_EXCEPTION",
      oldValue: existing.status,
      newValue: "EXCEPTION",
    });
  } else {
    await db
      .update(invoiceCaptureTable)
      .set({ status: "PENDING_APPROVAL" })
      .where(eq(invoiceCaptureTable.id, params.data.id));

    await appendAudit({
      invoiceId: params.data.id,
      action: "SUBMITTED",
      oldValue: existing.status,
      newValue: "PENDING_APPROVAL",
    });
  }

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
      await db
        .update(invoiceCaptureTable)
        .set({ status: "APPROVED" })
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

  const { vendorId, invoiceNumber, totalAmount, invoiceDate } = invoice;

  // ── Step 1: Exact match — same vendor + invoice number, APPROVED or POSTED ──
  if (vendorId && invoiceNumber) {
    const exactMatches = await db
      .select({ id: invoiceCaptureTable.id })
      .from(invoiceCaptureTable)
      .where(
        and(
          eq(invoiceCaptureTable.vendorId, vendorId),
          eq(invoiceCaptureTable.invoiceNumber, invoiceNumber),
          inArray(invoiceCaptureTable.status, ["APPROVED", "POSTED"]),
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
  if (vendorId && totalAmount != null && invoiceDate) {
    const amount = Number(totalAmount);
    const minAmount = amount * 0.99;
    const maxAmount = amount * 1.01;

    const fuzzyMatches = await db
      .select({ id: invoiceCaptureTable.id })
      .from(invoiceCaptureTable)
      .where(
        and(
          eq(invoiceCaptureTable.vendorId, vendorId),
          inArray(invoiceCaptureTable.status, ["APPROVED", "POSTED"]),
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
