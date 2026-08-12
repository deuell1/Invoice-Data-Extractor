import { Router, type IRouter } from "express";
import { and, eq, ilike, inArray, isNull, desc, sql } from "drizzle-orm";
import {
  db,
  sourceDocumentsTable,
  invoiceCaptureTable,
  invoiceAuditLogTable,
} from "@workspace/db";
import {
  CreateSourceDocumentBody,
  GetSourceDocumentParams,
  GetSourceDocumentResponse,
  RemoveSourceDocumentParams,
  RemoveSourceDocumentBody,
  DeleteSourceDocumentParams,
  DeleteSourceDocumentBody,
  ListSourceDocumentsQueryParams,
  ListSourceDocumentsResponse,
  GetSourceDocumentAuditParams,
  GetSourceDocumentAuditResponse,
} from "@workspace/api-zod";
import {
  createSourceDocument,
  getSourceDocumentWithInvoices,
  removeSourceDocument,
  deleteSourceDocument,
  type SourceDocumentWithInvoices,
} from "../services/sourceDocumentService";

const isoOrNull = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : ((v as string | null) ?? null);

/** Convert a raw source_documents row to the API shape (dates → ISO strings). */
function serializeSource(d: typeof sourceDocumentsTable.$inferSelect) {
  return {
    ...d,
    uploadedAt: isoOrNull(d.uploadedAt) as string,
    removedAt: isoOrNull(d.removedAt),
    createdAt: isoOrNull(d.createdAt) as string,
    updatedAt: isoOrNull(d.updatedAt) as string,
  };
}

const router: IRouter = Router();

/** Convert a raw invoice row's numeric (string) columns into numbers. */
function serializeSourceInvoice(
  row: SourceDocumentWithInvoices["invoices"][number],
) {
  return {
    ...row,
    totalAmount: row.totalAmount != null ? Number(row.totalAmount) : null,
    taxAmount: row.taxAmount != null ? Number(row.taxAmount) : null,
    confidenceScore: row.confidenceScore != null ? Number(row.confidenceScore) : null,
    subtotal: row.subtotal != null ? Number(row.subtotal) : null,
    freightAmount: row.freightAmount != null ? Number(row.freightAmount) : null,
    discountAmount: row.discountAmount != null ? Number(row.discountAmount) : null,
    otherChargesAmount:
      row.otherChargesAmount != null ? Number(row.otherChargesAmount) : null,
    tieOutExpectedTotal:
      row.tieOutExpectedTotal != null ? Number(row.tieOutExpectedTotal) : null,
    tieOutDifference: row.tieOutDifference != null ? Number(row.tieOutDifference) : null,
    vendorMatchScore: row.vendorMatchScore != null ? Number(row.vendorMatchScore) : null,
  };
}

/** Build the API response payload (source + invoices + status counts). */
function buildPayload(data: SourceDocumentWithInvoices) {
  const invoices = data.invoices.map(serializeSourceInvoice);
  // Counts reflect only active (non-removed) invoices; removed invoices are
  // surfaced separately via removedCount. The full list is still returned so the
  // frontend can optionally reveal removed rows behind a toggle.
  const active = data.invoices.filter((i) => i.status !== "VOIDED");
  const removedCount = data.invoices.length - active.length;
  const extractedCount = active.filter((i) => i.extractionStatus === "COMPLETED").length;
  const exceptionCount = active.filter((i) => i.status === "EXCEPTION").length;
  const invoiceCount = active.length;
  const duplicateSourceDocument = data.duplicateSourceDocument
    ? {
        id: data.duplicateSourceDocument.id,
        originalFileName: data.duplicateSourceDocument.originalFileName,
        uploadedAt: isoOrNull(data.duplicateSourceDocument.uploadedAt) as string,
      }
    : null;
  return {
    source: data.source,
    invoices,
    invoiceCount,
    extractedCount,
    exceptionCount,
    pendingCount: Math.max(0, invoiceCount - extractedCount - exceptionCount),
    removedCount,
    duplicateSourceDocument,
  };
}

// ─── POST /source-documents ──────────────────────────────────────────────────
router.post("/source-documents", async (req, res): Promise<void> => {
  const parsed = CreateSourceDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = await createSourceDocument({
    fileObjectPath: parsed.data.fileObjectPath,
    originalFileName: parsed.data.originalFileName,
    contentType: parsed.data.contentType ?? null,
    fileHash: parsed.data.fileHash ?? null,
  });

  const data = await getSourceDocumentWithInvoices(id);
  if (!data) {
    res.status(500).json({ error: "Failed to create source document" });
    return;
  }

  res.status(201).json(GetSourceDocumentResponse.parse(buildPayload(data)));
});

// ─── GET /source-documents/:id ───────────────────────────────────────────────
router.get("/source-documents/:id", async (req, res): Promise<void> => {
  const params = GetSourceDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const data = await getSourceDocumentWithInvoices(params.data.id);
  if (!data) {
    res.status(404).json({ error: "Source document not found" });
    return;
  }

  res.json(GetSourceDocumentResponse.parse(buildPayload(data)));
});

// ─── POST /source-documents/:id/remove ───────────────────────────────────────
// Soft-remove a source document and void all of its child invoices with a
// required reason.
router.post("/source-documents/:id/remove", async (req, res): Promise<void> => {
  // Actor must come from the authenticated session — never accept a client-supplied
  // identity on this route (the most destructive in the app).
  const actorId = (req as any).clerkUserId as string | undefined;
  if (!actorId) {
    res.status(401).json({ error: "Authenticated actor required." });
    return;
  }

  const params = RemoveSourceDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = RemoveSourceDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "A removal reason is required." });
    return;
  }

  const data = await removeSourceDocument(params.data.id, {
    reason: parsed.data.reason,
    note: parsed.data.note ?? null,
    actor: actorId,
    actorRole: (req as any).clerkUserRole ?? null,
  });
  if (!data) {
    res.status(404).json({ error: "Source document not found" });
    return;
  }

  res.json(GetSourceDocumentResponse.parse(buildPayload(data)));
});

// ─── DELETE /source-documents/:id ────────────────────────────────────────────
// Permanent hard delete (test-data cleanup): removes the source document, every
// child invoice and their audit records, and the stored file. Blocked when any
// child invoice is posted.
router.delete("/source-documents/:id", async (req, res): Promise<void> => {
  const params = DeleteSourceDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = DeleteSourceDocumentBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirm !== true) {
    res.status(422).json({ error: "Deletion must be explicitly confirmed." });
    return;
  }

  const result = await deleteSourceDocument(params.data.id);
  if (!result) {
    res.status(404).json({ error: "Source document not found" });
    return;
  }
  if (!result.deleted) {
    res.status(422).json({ error: result.blockedReason ?? "Cannot delete source document." });
    return;
  }

  res.json({
    deleted: result.deleted,
    deletedInvoiceIds: result.deletedInvoiceIds,
    deletedSourceDocumentId: result.deletedSourceDocumentId,
    fileDeleted: result.fileDeleted,
  });
});

// ─── GET /source-documents ───────────────────────────────────────────────────
// List uploaded source documents (paged) with per-document linked-invoice counts.
router.get("/source-documents", async (req, res): Promise<void> => {
  const parsed = ListSourceDocumentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { processingStatus, includeRemoved, search, page, limit } = parsed.data;
  const offset = ((page ?? 1) - 1) * (limit ?? 20);

  const conds = [];
  if (processingStatus) {
    conds.push(eq(sourceDocumentsTable.processingStatus, processingStatus));
  }
  if (!includeRemoved) {
    conds.push(isNull(sourceDocumentsTable.removedAt));
  }
  if (search) {
    conds.push(ilike(sourceDocumentsTable.originalFileName, `%${search}%`));
  }
  const where = conds.length > 0 ? and(...conds) : undefined;

  const [docs, countRows] = await Promise.all([
    db
      .select()
      .from(sourceDocumentsTable)
      .where(where)
      .orderBy(desc(sourceDocumentsTable.createdAt))
      .limit(limit ?? 20)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sourceDocumentsTable)
      .where(where),
  ]);

  const ids = docs.map((d) => d.id);
  const countsById = new Map<
    number,
    { invoiceCount: number; extractedCount: number; exceptionCount: number; removedCount: number }
  >();
  if (ids.length > 0) {
    const rows = await db
      .select({
        sid: invoiceCaptureTable.sourceDocumentId,
        invoiceCount: sql<number>`(count(*) filter (where ${invoiceCaptureTable.status} <> 'VOIDED'))::int`,
        extractedCount: sql<number>`(count(*) filter (where ${invoiceCaptureTable.status} <> 'VOIDED' and ${invoiceCaptureTable.extractionStatus} = 'COMPLETED'))::int`,
        exceptionCount: sql<number>`(count(*) filter (where ${invoiceCaptureTable.status} = 'EXCEPTION'))::int`,
        removedCount: sql<number>`(count(*) filter (where ${invoiceCaptureTable.status} = 'VOIDED'))::int`,
      })
      .from(invoiceCaptureTable)
      .where(inArray(invoiceCaptureTable.sourceDocumentId, ids))
      .groupBy(invoiceCaptureTable.sourceDocumentId);
    for (const r of rows) {
      if (r.sid != null) {
        countsById.set(r.sid, {
          invoiceCount: r.invoiceCount,
          extractedCount: r.extractedCount,
          exceptionCount: r.exceptionCount,
          removedCount: r.removedCount,
        });
      }
    }
  }

  const data = docs.map((d) => {
    const c =
      countsById.get(d.id) ??
      { invoiceCount: 0, extractedCount: 0, exceptionCount: 0, removedCount: 0 };
    return {
      source: serializeSource(d),
      invoiceCount: c.invoiceCount,
      extractedCount: c.extractedCount,
      exceptionCount: c.exceptionCount,
      removedCount: c.removedCount,
    };
  });

  res.json(
    ListSourceDocumentsResponse.parse({
      data,
      total: countRows[0]?.count ?? 0,
      page: page ?? 1,
      limit: limit ?? 20,
    }),
  );
});

// ─── GET /source-documents/:id/audit ─────────────────────────────────────────
// Aggregated audit trail across every invoice detected in a source document.
router.get("/source-documents/:id/audit", async (req, res): Promise<void> => {
  const params = GetSourceDocumentAuditParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [doc] = await db
    .select({ id: sourceDocumentsTable.id })
    .from(sourceDocumentsTable)
    .where(eq(sourceDocumentsTable.id, params.data.id))
    .limit(1);
  if (!doc) {
    res.status(404).json({ error: "Source document not found" });
    return;
  }

  const invoiceIds = (
    await db
      .select({ id: invoiceCaptureTable.id })
      .from(invoiceCaptureTable)
      .where(eq(invoiceCaptureTable.sourceDocumentId, params.data.id))
  ).map((r) => r.id);

  if (invoiceIds.length === 0) {
    res.json(GetSourceDocumentAuditResponse.parse([]));
    return;
  }

  const rows = await db
    .select()
    .from(invoiceAuditLogTable)
    .where(inArray(invoiceAuditLogTable.invoiceId, invoiceIds))
    .orderBy(desc(invoiceAuditLogTable.createdAt));

  res.json(
    GetSourceDocumentAuditResponse.parse(
      rows.map((r) => ({ ...r, createdAt: isoOrNull(r.createdAt) as string })),
    ),
  );
});

export default router;
