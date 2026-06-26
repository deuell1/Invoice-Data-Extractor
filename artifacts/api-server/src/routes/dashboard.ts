import { Router, type IRouter } from "express";
import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import { db, invoiceCaptureTable, vendorIdTable } from "@workspace/db";
import {
  GetDashboardMetricsQueryParams,
  GetDashboardMetricsResponse,
  GetVendorAnalyticsQueryParams,
  GetVendorAnalyticsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Active invoice statuses (everything except VOIDED).
const ACTIVE_STATUSES = [
  "PENDING_EXTRACTION",
  "EXCEPTION",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
] as const;

const toNum = (v: unknown): number | null =>
  v != null && v !== "" ? Number(v as string) : null;

const isBlank = (v: unknown): boolean =>
  v == null || String(v).trim() === "";

// A duplicate warning is any non-empty duplicateCheck verdict that is not a
// clean pass (PASS/OK/NONE).
const isDuplicateWarning = (v: unknown): boolean => {
  if (isBlank(v)) return false;
  const up = String(v).trim().toUpperCase();
  return up !== "PASS" && up !== "OK" && up !== "NONE";
};

// Average of *100-scaled scores over rows that have a value; null if none.
const avgScorePct = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  const sum = present.reduce((acc, v) => acc + v * 100, 0);
  return sum / present.length;
};

// ─── GET /dashboard/metrics ─────────────────────────────────────────────────
router.get("/dashboard/metrics", async (req, res): Promise<void> => {
  const parsed = GetDashboardMetricsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { dateFrom, dateTo, vendorId, status, exportStatus } = parsed.data;

  const conditions: SQL[] = [];
  if (dateFrom) conditions.push(gte(invoiceCaptureTable.invoiceDate, dateFrom));
  if (dateTo) conditions.push(lte(invoiceCaptureTable.invoiceDate, dateTo));
  if (vendorId != null) conditions.push(eq(invoiceCaptureTable.vendorId, vendorId));
  if (status) conditions.push(eq(invoiceCaptureTable.status, status));
  if (exportStatus) conditions.push(eq(invoiceCaptureTable.exportStatus, exportStatus));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      status: invoiceCaptureTable.status,
      reviewStatus: invoiceCaptureTable.reviewStatus,
      exportStatus: invoiceCaptureTable.exportStatus,
      tieOutStatus: invoiceCaptureTable.tieOutStatus,
      duplicateCheck: invoiceCaptureTable.duplicateCheck,
      poNumber: invoiceCaptureTable.poNumber,
      dueDate: invoiceCaptureTable.dueDate,
      confidenceScore: invoiceCaptureTable.confidenceScore,
      vendorMatchScore: invoiceCaptureTable.vendorMatchScore,
      totalAmount: invoiceCaptureTable.totalAmount,
    })
    .from(invoiceCaptureTable)
    .where(whereClause);

  const active = rows.filter((r) => r.status !== "VOIDED");

  const byStatus: Record<string, number> = {};
  for (const r of active) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  const total = active.length;
  const exception = byStatus["EXCEPTION"] ?? 0;

  const valueByStatus = ACTIVE_STATUSES.map((s) => {
    const group = active.filter((r) => r.status === s);
    const totalAmount = group.reduce((acc, r) => acc + (toNum(r.totalAmount) ?? 0), 0);
    return { status: s, count: group.length, totalAmount };
  });

  const totalApprovedAmount = active
    .filter((r) => r.status === "APPROVED")
    .reduce((acc, r) => acc + (toNum(r.totalAmount) ?? 0), 0);

  const metrics = {
    total,
    pendingExtraction: byStatus["PENDING_EXTRACTION"] ?? 0,
    exception,
    pendingApproval: byStatus["PENDING_APPROVAL"] ?? 0,
    approved: byStatus["APPROVED"] ?? 0,
    posted: byStatus["POSTED"] ?? 0,
    voided: rows.length - active.length,
    needsReview: active.filter((r) => r.reviewStatus === "NEEDS_REVIEW").length,
    exportReady: active.filter((r) => r.exportStatus === "READY").length,
    exported: active.filter((r) => r.exportStatus === "EXPORTED").length,
    exportFailed: active.filter((r) => r.exportStatus === "FAILED").length,
    exportBlocked: active.filter((r) => r.exportStatus === "BLOCKED").length,
    tieOutFail: active.filter((r) => r.tieOutStatus === "FAIL").length,
    tieOutWarning: active.filter((r) => r.tieOutStatus === "WARNING").length,
    duplicateWarning: active.filter((r) => isDuplicateWarning(r.duplicateCheck)).length,
    missingPo: active.filter((r) => isBlank(r.poNumber)).length,
    missingDueDate: active.filter((r) => isBlank(r.dueDate)).length,
    avgExtractionConfidence: avgScorePct(active.map((r) => toNum(r.confidenceScore))),
    avgVendorMatchConfidence: avgScorePct(active.map((r) => toNum(r.vendorMatchScore))),
    exceptionRate: total > 0 ? exception / total : 0,
    totalApprovedAmount,
    valueByStatus,
  };

  res.json(GetDashboardMetricsResponse.parse(metrics));
});

// ─── GET /analytics/vendors ─────────────────────────────────────────────────
router.get("/analytics/vendors", async (req, res): Promise<void> => {
  const parsed = GetVendorAnalyticsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { dateFrom, dateTo } = parsed.data;

  // Only active (non-VOIDED) invoices that are assigned to a controlled vendor.
  const conditions: SQL[] = [];
  if (dateFrom) conditions.push(gte(invoiceCaptureTable.invoiceDate, dateFrom));
  if (dateTo) conditions.push(lte(invoiceCaptureTable.invoiceDate, dateTo));

  const rows = await db
    .select({
      vendorId: vendorIdTable.id,
      vendorCode: vendorIdTable.vendorCode,
      vendorName: vendorIdTable.vendorName,
      isActive: vendorIdTable.isActive,
      onHold: vendorIdTable.onHold,
      status: invoiceCaptureTable.status,
      exportStatus: invoiceCaptureTable.exportStatus,
      tieOutStatus: invoiceCaptureTable.tieOutStatus,
      duplicateCheck: invoiceCaptureTable.duplicateCheck,
      poNumber: invoiceCaptureTable.poNumber,
      vendorMatchScore: invoiceCaptureTable.vendorMatchScore,
      totalAmount: invoiceCaptureTable.totalAmount,
    })
    .from(invoiceCaptureTable)
    .innerJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  type Row = (typeof rows)[number];
  const groups = new Map<number, Row[]>();
  for (const r of rows) {
    if (r.status === "VOIDED") continue;
    const list = groups.get(r.vendorId);
    if (list) list.push(r);
    else groups.set(r.vendorId, [r]);
  }

  const data = Array.from(groups.values()).map((group) => {
    const first = group[0]!;
    const vendorStatus = !first.isActive
      ? "INACTIVE"
      : first.onHold
        ? "ON_HOLD"
        : "ACTIVE";
    return {
      vendorId: first.vendorId,
      vendorCode: first.vendorCode,
      vendorName: first.vendorName,
      vendorStatus,
      invoiceCount: group.length,
      totalAmount: group.reduce((acc, r) => acc + (toNum(r.totalAmount) ?? 0), 0),
      avgVendorMatchConfidence: avgScorePct(group.map((r) => toNum(r.vendorMatchScore))),
      exceptionCount: group.filter((r) => r.status === "EXCEPTION").length,
      duplicateWarningCount: group.filter((r) => isDuplicateWarning(r.duplicateCheck)).length,
      tieOutFailCount: group.filter((r) => r.tieOutStatus === "FAIL").length,
      missingPoCount: group.filter((r) => isBlank(r.poNumber)).length,
      exportedCount: group.filter((r) => r.exportStatus === "EXPORTED").length,
    };
  });

  data.sort((a, b) => b.totalAmount - a.totalAmount);

  res.json(GetVendorAnalyticsResponse.parse({ data }));
});

export default router;
