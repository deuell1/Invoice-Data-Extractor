import { Router, type IRouter } from "express";
import {
  CreateSourceDocumentBody,
  GetSourceDocumentParams,
  GetSourceDocumentResponse,
} from "@workspace/api-zod";
import {
  createSourceDocument,
  getSourceDocumentWithInvoices,
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
  const extractedCount = data.invoices.filter((i) => i.extractionStatus === "COMPLETED").length;
  const exceptionCount = data.invoices.filter((i) => i.status === "EXCEPTION").length;
  const invoiceCount = data.invoices.length;
  return {
    source: data.source,
    invoices,
    invoiceCount,
    extractedCount,
    exceptionCount,
    pendingCount: Math.max(0, invoiceCount - extractedCount - exceptionCount),
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

export default router;
