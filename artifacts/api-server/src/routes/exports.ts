import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, exportBatchTable } from "@workspace/db";
import {
  CreateExportBody,
  ListExportsQueryParams,
  ListExportsResponse,
  GetExportParams,
  GetExportResponse,
  DownloadExportParams,
} from "@workspace/api-zod";
import {
  isAggregateExportType,
  buildInvoiceConditions,
  selectInvoiceIds,
  markInvoicesExported,
  buildInvoiceCsvForBatch,
  buildAggregateCsv,
  type ExportFilters,
} from "../services/exportService";

const router: IRouter = Router();

/** Serialize an export_batch row into the API JSON shape (ISO dates). */
function serializeBatch(row: typeof exportBatchTable.$inferSelect) {
  return {
    id: row.id,
    batchId: row.batchId,
    exportType: row.exportType,
    format: row.format,
    filterJson: (row.filterJson ?? {}) as Record<string, unknown>,
    recordCount: row.recordCount,
    exportedBy: row.exportedBy,
    exportedAt: row.exportedAt.toISOString(),
    fileName: row.fileName,
    fileObjectPath: row.fileObjectPath,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── POST /exports ───────────────────────────────────────────────────────────
router.post("/exports", async (req, res): Promise<void> => {
  const parsed = CreateExportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const exportType = body.exportType;
  const format = body.format ?? "CSV";

  const filters: ExportFilters = {
    status: body.status ?? null,
    dateFrom: body.dateFrom ?? null,
    dateTo: body.dateTo ?? null,
    vendorId: body.vendorId ?? null,
  };

  const batchId = `EXP-${exportType}-${Date.now()}`;
  const fileName = `${exportType}_${batchId}.csv`;

  let recordCount = 0;
  if (isAggregateExportType(exportType)) {
    // Aggregate exports never mark invoices; just count the aggregate rows.
    const { count } = await buildAggregateCsv(exportType, filters);
    recordCount = count;
  } else {
    // Invoice-level export: select matching invoices and mark them Exported.
    const where = buildInvoiceConditions(exportType, filters);
    const ids = await selectInvoiceIds(where);
    await markInvoicesExported(ids, batchId, fileName, format);
    recordCount = ids.length;
  }

  const [batch] = await db
    .insert(exportBatchTable)
    .values({
      batchId,
      exportType,
      format,
      filterJson: filters as Record<string, unknown>,
      recordCount,
      exportedBy: body.exportedBy ?? null,
      fileName,
      fileObjectPath: null,
      status: "SUCCESS",
    })
    .returning();

  res.status(201).json(serializeBatch(batch));
});

// ─── GET /exports ────────────────────────────────────────────────────────────
router.get("/exports", async (req, res): Promise<void> => {
  const parsed = ListExportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit } = parsed.data;
  const offset = ((page ?? 1) - 1) * (limit ?? 20);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(exportBatchTable)
      .orderBy(desc(exportBatchTable.createdAt))
      .limit(limit ?? 20)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(exportBatchTable),
  ]);

  res.json(
    ListExportsResponse.parse({
      data: rows.map(serializeBatch),
      total: countRows[0]?.count ?? 0,
      page: page ?? 1,
      limit: limit ?? 20,
    }),
  );
});

// ─── GET /exports/:id ────────────────────────────────────────────────────────
router.get("/exports/:id", async (req, res): Promise<void> => {
  const params = GetExportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [batch] = await db
    .select()
    .from(exportBatchTable)
    .where(eq(exportBatchTable.id, params.data.id))
    .limit(1);
  if (!batch) {
    res.status(404).json({ error: "Export batch not found" });
    return;
  }

  res.json(GetExportResponse.parse(serializeBatch(batch)));
});

// ─── GET /exports/:id/download ───────────────────────────────────────────────
router.get("/exports/:id/download", async (req, res): Promise<void> => {
  const params = DownloadExportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [batch] = await db
    .select()
    .from(exportBatchTable)
    .where(eq(exportBatchTable.id, params.data.id))
    .limit(1);
  if (!batch) {
    res.status(404).json({ error: "Export batch not found" });
    return;
  }

  let csv: string;
  if (isAggregateExportType(batch.exportType)) {
    const filters = (batch.filterJson ?? {}) as ExportFilters;
    csv = (await buildAggregateCsv(batch.exportType, filters)).csv;
  } else {
    // Stable membership: re-select invoices stamped with this batch.
    csv = (await buildInvoiceCsvForBatch(batch.batchId)).csv;
  }

  const fileName = batch.fileName ?? `${batch.batchId}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  // Prepend a UTF-8 BOM so Excel opens the file with correct encoding.
  res.send("\uFEFF" + csv);
});

export default router;
