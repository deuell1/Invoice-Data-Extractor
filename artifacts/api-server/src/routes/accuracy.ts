import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, accuracyRunTable } from "@workspace/db";
import {
  ListAccuracyRunsResponse,
  CreateAccuracyRunBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

/** Serialize an accuracy_run row to the API shape (numerics→Number, dates→ISO). */
function serializeRun(row: typeof accuracyRunTable.$inferSelect) {
  return {
    id: row.id,
    runDate:
      row.runDate instanceof Date ? row.runDate.toISOString() : row.runDate,
    testPackName: row.testPackName,
    invoicesTested: row.invoicesTested,
    fieldsTested: row.fieldsTested,
    correctFields: row.correctFields,
    incorrectFields: row.incorrectFields,
    missingFields: row.missingFields,
    overallAccuracy:
      row.overallAccuracy != null ? Number(row.overallAccuracy) : null,
    accuracyByCategory: row.accuracyByCategory ?? {},
    threshold: row.threshold != null ? Number(row.threshold) : null,
    passed: row.passed,
    reportRef: row.reportRef,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

// ─── GET /accuracy-runs ───────────────────────────────────────────────────────
router.get("/accuracy-runs", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(accuracyRunTable)
    .orderBy(desc(accuracyRunTable.runDate));

  const data = rows.map(serializeRun);
  // measured=false when no labeled accuracy run has been recorded; the frontend
  // renders "Not measured" for the empty list.
  res.json(ListAccuracyRunsResponse.parse({ data, measured: data.length > 0 }));
});

// ─── POST /accuracy-runs ──────────────────────────────────────────────────────
router.post("/accuracy-runs", async (req, res): Promise<void> => {
  const parsed = CreateAccuracyRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // No labeled ground-truth pack is wired in this MVP — never fabricate accuracy
  // numbers. Record a placeholder run with zero counts and a "Not measured" note.
  const [row] = await db
    .insert(accuracyRunTable)
    .values({
      testPackName: parsed.data.testPackName,
      invoicesTested: 0,
      fieldsTested: 0,
      correctFields: 0,
      incorrectFields: 0,
      missingFields: 0,
      overallAccuracy: null,
      accuracyByCategory: {},
      threshold: null,
      passed: null,
      reportRef: "Not measured — no labeled pack",
    })
    .returning();

  res.status(201).json(serializeRun(row));
});

export default router;
