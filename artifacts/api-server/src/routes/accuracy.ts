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

  // Guard metric invariants beyond the generated schema: counts must be finite
  // non-negative integers that reconcile, and percentages must be finite 0–100.
  // Otherwise a bad payload could persist nonsense as "measured" evidence or
  // crash the numeric column insert (String(NaN) → DB error).
  const b = parsed.data;
  const badCount = (n: number) =>
    !Number.isInteger(n) || n < 0;
  const badPct = (n: number) =>
    !Number.isFinite(n) || n < 0 || n > 100;
  const countErrors: string[] = [];
  for (const [name, value] of Object.entries({
    invoicesTested: b.invoicesTested,
    fieldsTested: b.fieldsTested,
    correctFields: b.correctFields,
    incorrectFields: b.incorrectFields,
    missingFields: b.missingFields,
  })) {
    if (badCount(value)) countErrors.push(`${name} must be a non-negative integer`);
  }
  if (
    countErrors.length === 0 &&
    b.correctFields + b.incorrectFields + b.missingFields !== b.fieldsTested
  ) {
    countErrors.push(
      "correctFields + incorrectFields + missingFields must equal fieldsTested",
    );
  }
  if (b.overallAccuracy != null && badPct(b.overallAccuracy)) {
    countErrors.push("overallAccuracy must be a finite percentage between 0 and 100");
  }
  if (b.threshold != null && badPct(b.threshold)) {
    countErrors.push("threshold must be a finite percentage between 0 and 100");
  }
  for (const [cat, value] of Object.entries(b.accuracyByCategory ?? {})) {
    if (badPct(value)) countErrors.push(`accuracyByCategory.${cat} must be a finite percentage between 0 and 100`);
  }
  if (countErrors.length > 0) {
    res.status(400).json({ error: countErrors.join("; ") });
    return;
  }

  // Persist the metrics exactly as submitted by the accuracy harness. These
  // values come from a measured run against a labeled ground-truth pack
  // (uat/extraction-accuracy) — never fabricate numbers when calling this
  // endpoint; the harness output is the only legitimate source.
  const [row] = await db
    .insert(accuracyRunTable)
    .values({
      testPackName: parsed.data.testPackName,
      invoicesTested: parsed.data.invoicesTested,
      fieldsTested: parsed.data.fieldsTested,
      correctFields: parsed.data.correctFields,
      incorrectFields: parsed.data.incorrectFields,
      missingFields: parsed.data.missingFields,
      overallAccuracy:
        parsed.data.overallAccuracy != null
          ? String(parsed.data.overallAccuracy)
          : null,
      accuracyByCategory: parsed.data.accuracyByCategory ?? {},
      threshold:
        parsed.data.threshold != null ? String(parsed.data.threshold) : null,
      passed: parsed.data.passed ?? null,
      reportRef: parsed.data.reportRef ?? null,
    })
    .returning();

  res.status(201).json(serializeRun(row));
});

export default router;
