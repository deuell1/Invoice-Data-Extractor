import { Router, type IRouter } from "express";
import {
  CreateSourceDocumentBody,
  GetSourceDocumentParams,
  GetSourceDocumentResponse,
  RemoveSourceDocumentParams,
  RemoveSourceDocumentBody,
  DeleteSourceDocumentParams,
  DeleteSourceDocumentBody,
} from "@workspace/api-zod";
import {
  createSourceDocument,
  getSourceDocumentWithInvoices,
  removeSourceDocument,
  deleteSourceDocument,
  type SourceDocumentWithInvoices,
} from "../services/sourceDocumentService";

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
  return {
    source: data.source,
    invoices,
    invoiceCount,
    extractedCount,
    exceptionCount,
    pendingCount: Math.max(0, invoiceCount - extractedCount - exceptionCount),
    removedCount,
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
    actor: parsed.data.actor ?? null,
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

export default router;
