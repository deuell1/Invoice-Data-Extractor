import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, importBatchTable } from "@workspace/db";
import {
  GetImportTemplateQueryParams,
  ValidateImportBody,
  ValidateImportResponse,
  CommitImportBody,
  ListImportsQueryParams,
  ListImportsResponse,
  GetImportParams,
  GetImportResponse,
} from "@workspace/api-zod";
import {
  analyzeImport,
  commitImportData,
  getTemplateCsv,
  templateFileName,
  serializeBatch,
} from "../services/importService";

const router: IRouter = Router();

// ─── GET /imports/template ───────────────────────────────────────────────────
// Declared before /imports/:id so the literal path is matched first.
router.get("/imports/template", async (req, res): Promise<void> => {
  const parsed = GetImportTemplateQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const importType = parsed.data.importType;
  const csv = getTemplateCsv(importType);
  const filename = templateFileName(importType);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

// ─── POST /imports/validate ──────────────────────────────────────────────────
router.post("/imports/validate", async (req, res): Promise<void> => {
  const parsed = ValidateImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await analyzeImport(
    parsed.data.importType,
    parsed.data.fileName,
    parsed.data.content,
    { updateExisting: parsed.data.updateExisting ?? false },
  );

  res.json(
    ValidateImportResponse.parse({
      importType: result.importType,
      fileName: result.fileName,
      columns: result.columns,
      rowCount: result.rowCount,
      rowsValid: result.rowsValid,
      rowsRejected: result.rowsRejected,
      preview: result.preview,
      errorSummary: result.errorSummary,
      hasBlockingErrors: result.hasBlockingErrors,
    }),
  );
});

// ─── POST /imports (commit) ──────────────────────────────────────────────────
router.post("/imports", async (req, res): Promise<void> => {
  const parsed = CommitImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Vendor master import is an admin-only operation. With no auth system in this
  // pilot, enforcement requires an identified actor be recorded for accountability.
  if (
    parsed.data.importType === "VENDOR_MASTER" &&
    !(parsed.data.uploadedBy && parsed.data.uploadedBy.trim().length > 0)
  ) {
    res.status(403).json({
      error:
        "Vendor master import is admin-only — an authorized actor (Uploaded By) is required to commit vendor changes.",
    });
    return;
  }

  const outcome = await commitImportData({
    importType: parsed.data.importType,
    fileName: parsed.data.fileName,
    content: parsed.data.content,
    uploadedBy: parsed.data.uploadedBy ?? null,
    updateExisting: parsed.data.updateExisting ?? false,
  });

  if (outcome.blocked || !outcome.batch) {
    res.status(422).json({
      error: outcome.errorSummary ?? "Import has blocking validation errors",
    });
    return;
  }

  res.status(201).json(GetImportResponse.parse(outcome.batch));
});

// ─── GET /imports (list history) ─────────────────────────────────────────────
router.get("/imports", async (req, res): Promise<void> => {
  const parsed = ListImportsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { importType, page, limit } = parsed.data;
  const offset = ((page ?? 1) - 1) * (limit ?? 20);

  const conditions = [];
  if (importType) {
    conditions.push(eq(importBatchTable.importType, importType));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(importBatchTable)
      .where(whereClause)
      .orderBy(sql`${importBatchTable.createdAt} DESC`)
      .limit(limit ?? 20)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(importBatchTable)
      .where(whereClause),
  ]);

  res.json(
    ListImportsResponse.parse({
      data: rows.map(serializeBatch),
      total: countRows[0]?.count ?? 0,
      page: page ?? 1,
      limit: limit ?? 20,
    }),
  );
});

// ─── GET /imports/:id ────────────────────────────────────────────────────────
router.get("/imports/:id", async (req, res): Promise<void> => {
  const params = GetImportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [batch] = await db
    .select()
    .from(importBatchTable)
    .where(eq(importBatchTable.id, params.data.id))
    .limit(1);

  if (!batch) {
    res.status(404).json({ error: "Import batch not found" });
    return;
  }

  res.json(GetImportResponse.parse(serializeBatch(batch)));
});

export default router;
