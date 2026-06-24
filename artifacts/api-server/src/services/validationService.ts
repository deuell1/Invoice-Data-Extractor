import { db, invoiceCaptureTable, invoiceAuditLogTable, vendorIdTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";

// ─── Thresholds ──────────────────────────────────────────────────────────────
const CONFIDENCE_THRESHOLD = 0.85; // overall confidenceScore is stored 0–1
const FIELD_CONFIDENCE_THRESHOLD = 85; // per-field fieldConfidence is stored 0–100
const VENDOR_MATCH_THRESHOLD = 0.85; // vendorMatchScore is stored 0–1
const TIE_OUT_TOLERANCE = 0.01; // dollars

// ─── Canonical vendor exception reasons ──────────────────────────────────────
// Used by the validation engine and the approval route. The "hard block" reasons
// mean there is NO usable matched vendor (name missing or no confident match) —
// approval is impossible even with a documented override. Inactive/On-Hold are
// matched vendors and remain overridable with a documented reason.
export const VENDOR_REASON = {
  NAME_NOT_EXTRACTED: "Vendor Name Not Extracted",
  NOT_FOUND: "Vendor Not Found",
  LOW_CONFIDENCE: "Low Vendor Match Confidence",
  INACTIVE: "Vendor Inactive",
  ON_HOLD: "Vendor On Hold",
} as const;

export const VENDOR_HARD_BLOCK_REASONS: readonly string[] = [
  VENDOR_REASON.NAME_NOT_EXTRACTED,
  VENDOR_REASON.NOT_FOUND,
  VENDOR_REASON.LOW_CONFIDENCE,
];

// Critical fields whose per-field confidence must clear the threshold.
const CRITICAL_FIELDS = ["vendorRawName", "invoiceNumber", "invoiceDate", "totalAmount"];

// ─── Result types ────────────────────────────────────────────────────────────

export type CheckResult = "PASS" | "FAIL" | "WARNING" | "SKIPPED";
export type ValidationStatus = "PASS" | "NEEDS_REVIEW" | "FAILED";
export type ReviewStatus = "CLEAN" | "NEEDS_REVIEW" | "EXCEPTION";

interface ValidationDetail {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationOutcome {
  validationStatus: ValidationStatus;
  reviewStatus: ReviewStatus;
  blocking: string[];
  warnings: string[];
  checks: {
    duplicateCheck: CheckResult;
    vendorCheck: CheckResult;
    poCheck: CheckResult;
    amountCheck: CheckResult;
    totalTieOut: CheckResult;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse a vendor payment-terms string into a day count, e.g. "Net 30" → 30. */
function parseNetTermsDays(terms: string | null): number | null {
  if (!terms) return null;
  const t = terms.toLowerCase();
  if (t.includes("receipt") || t.includes("due on receipt") || t.includes("cod")) return 0;
  const net = t.match(/net\s*(\d+)/);
  if (net) return parseInt(net[1], 10);
  const any = t.match(/(\d+)\s*days?/);
  if (any) return parseInt(any[1], 10);
  return null;
}

/** Parse a date-ish string to a Date (date-only), or null if invalid. */
function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function addDays(date: Date, days: number): string {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True if another invoice already has this vendor + invoice number. */
async function hasDuplicate(
  invoiceId: number,
  vendorId: number | null,
  invoiceNumber: string | null,
): Promise<boolean> {
  if (vendorId == null || !invoiceNumber) return false;
  const rows = await db
    .select({ id: invoiceCaptureTable.id })
    .from(invoiceCaptureTable)
    .where(
      and(
        eq(invoiceCaptureTable.vendorId, vendorId),
        eq(invoiceCaptureTable.invoiceNumber, invoiceNumber),
        ne(invoiceCaptureTable.id, invoiceId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function parseFieldConfidence(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed != null ? parsed : {};
  } catch {
    return {};
  }
}

// ─── Core engine ─────────────────────────────────────────────────────────────

/**
 * Authoritative validation + routing engine. Runs after extraction, after
 * vendor matching, on submit, and (as a pre-check) on approval. Recomputes all
 * check fields from the current row, persists them, and routes the invoice:
 *   - any blocking issue → EXCEPTION
 *   - warnings/low-confidence only → stays PENDING_APPROVAL, flagged NEEDS_REVIEW
 *   - clean → PENDING_APPROVAL (CLEAN)
 * Already-APPROVED/POSTED invoices keep their workflow status; only the check
 * metadata is refreshed.
 */
export async function validateInvoice(invoiceId: number): Promise<ValidationOutcome> {
  const [row] = await db
    .select({
      id: invoiceCaptureTable.id,
      status: invoiceCaptureTable.status,
      vendorId: invoiceCaptureTable.vendorId,
      vendorRawName: invoiceCaptureTable.vendorRawName,
      vendorMatchScore: invoiceCaptureTable.vendorMatchScore,
      invoiceNumber: invoiceCaptureTable.invoiceNumber,
      invoiceDate: invoiceCaptureTable.invoiceDate,
      dueDate: invoiceCaptureTable.dueDate,
      totalAmount: invoiceCaptureTable.totalAmount,
      taxAmount: invoiceCaptureTable.taxAmount,
      subtotal: invoiceCaptureTable.subtotal,
      freightAmount: invoiceCaptureTable.freightAmount,
      poNumber: invoiceCaptureTable.poNumber,
      currency: invoiceCaptureTable.currency,
      confidenceScore: invoiceCaptureTable.confidenceScore,
      fieldConfidence: invoiceCaptureTable.fieldConfidence,
      paymentTerms: invoiceCaptureTable.paymentTerms,
      vendorCode: vendorIdTable.vendorCode,
      vendorIsActive: vendorIdTable.isActive,
      vendorOnHold: vendorIdTable.onHold,
      vendorPaymentTerms: vendorIdTable.paymentTerms,
      vendorTermsDays: vendorIdTable.termsDays,
    })
    .from(invoiceCaptureTable)
    .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
    .where(eq(invoiceCaptureTable.id, invoiceId))
    .limit(1);

  if (!row) {
    return {
      validationStatus: "FAILED",
      reviewStatus: "EXCEPTION",
      blocking: ["Invoice not found"],
      warnings: [],
      checks: {
        duplicateCheck: "SKIPPED",
        vendorCheck: "FAIL",
        poCheck: "SKIPPED",
        amountCheck: "SKIPPED",
        totalTieOut: "SKIPPED",
      },
    };
  }

  const blocking: string[] = [];
  const warnings: string[] = [];

  // ── Vendor checks ──────────────────────────────────────────────────────────
  // An invoice must ALWAYS be flagged (and approval blocked) when the vendor is
  // missing, unmatched, low-confidence, inactive, or on hold. Canonical reasons
  // are used so the Extraction Review screen and Exception Queue read clearly.
  let vendorCheck: CheckResult = "PASS";
  const vendorScore = row.vendorMatchScore != null ? Number(row.vendorMatchScore) : null;
  if (!row.vendorRawName?.trim()) {
    blocking.push(VENDOR_REASON.NAME_NOT_EXTRACTED);
    vendorCheck = "FAIL";
  } else if (row.vendorId == null) {
    // Vendor name extracted but not assigned a controlled Vendor_ID. A recorded
    // best-match score below threshold is reported as low confidence; otherwise
    // no candidate was found at all.
    if (vendorScore != null && vendorScore < VENDOR_MATCH_THRESHOLD) {
      blocking.push(VENDOR_REASON.LOW_CONFIDENCE);
    } else {
      blocking.push(VENDOR_REASON.NOT_FOUND);
    }
    vendorCheck = "FAIL";
  } else {
    if (row.vendorIsActive === false) {
      blocking.push(VENDOR_REASON.INACTIVE);
      vendorCheck = "FAIL";
    }
    if (row.vendorOnHold === true) {
      blocking.push(VENDOR_REASON.ON_HOLD);
      vendorCheck = "FAIL";
    }
  }

  // ── Invoice number ─────────────────────────────────────────────────────────
  if (!row.invoiceNumber) {
    blocking.push("Invoice number is missing");
  }

  // ── Invoice date ───────────────────────────────────────────────────────────
  const invoiceDate = parseDate(row.invoiceDate);
  if (!row.invoiceDate) {
    blocking.push("Invoice date is missing");
  } else if (!invoiceDate) {
    blocking.push("Invoice date is invalid");
  }

  // ── Due date: required or derivable from vendor terms; must be ≥ invoice date ─
  let derivedDueDate: string | null = null;
  let dueDate = parseDate(row.dueDate);
  if (!row.dueDate) {
    const netDays =
      row.vendorTermsDays ?? parseNetTermsDays(row.vendorPaymentTerms ?? row.paymentTerms);
    if (invoiceDate && netDays != null) {
      derivedDueDate = addDays(invoiceDate, netDays);
      dueDate = parseDate(derivedDueDate);
    } else {
      blocking.push("Due date is missing and cannot be derived from vendor payment terms");
    }
  }
  if (invoiceDate && dueDate && dueDate.getTime() < invoiceDate.getTime()) {
    blocking.push("Due date is before the invoice date");
  }

  // ── Amount > 0 ─────────────────────────────────────────────────────────────
  let amountCheck: CheckResult = "PASS";
  const total = row.totalAmount != null ? Number(row.totalAmount) : null;
  if (total == null) {
    blocking.push("Invoice total is missing");
    amountCheck = "FAIL";
  } else if (!(total > 0)) {
    blocking.push("Invoice total must be greater than zero");
    amountCheck = "FAIL";
  }

  // ── Currency ───────────────────────────────────────────────────────────────
  if (row.currency && row.currency.toUpperCase() !== "USD") {
    blocking.push(`Currency ${row.currency} is not USD (manual approval required)`);
    amountCheck = "FAIL";
  }

  // ── Extraction confidence (overall, 0–1) ───────────────────────────────────
  const score = row.confidenceScore != null ? Number(row.confidenceScore) : null;
  if (score != null && score < CONFIDENCE_THRESHOLD) {
    warnings.push(`Low extraction confidence (${(score * 100).toFixed(0)}%)`);
  }

  // ── Critical field confidence (per-field, 0–100) ───────────────────────────
  const fieldConf = parseFieldConfidence(row.fieldConfidence);
  const lowCritical = CRITICAL_FIELDS.filter(
    (f) => typeof fieldConf[f] === "number" && fieldConf[f] < FIELD_CONFIDENCE_THRESHOLD,
  );
  if (lowCritical.length > 0) {
    warnings.push(`Low confidence on critical fields: ${lowCritical.join(", ")}`);
  }

  // ── Duplicate check ────────────────────────────────────────────────────────
  let duplicateCheck: CheckResult = "PASS";
  if (row.vendorId == null || !row.invoiceNumber) {
    duplicateCheck = "SKIPPED";
  } else if (await hasDuplicate(invoiceId, row.vendorId, row.invoiceNumber)) {
    duplicateCheck = "FAIL";
    blocking.push("Duplicate invoice (same vendor + invoice number)");
  }

  // ── PO check (PO source validation skipped — no PO source configured) ───────
  let poCheck: CheckResult;
  if (row.poNumber) {
    poCheck = "PASS";
  } else {
    poCheck = "WARNING";
    warnings.push("PO number not captured");
  }

  // ── Header total tie-out: subtotal + tax + freight = total (within $0.01) ────
  let totalTieOut: CheckResult = "SKIPPED";
  const subtotal = row.subtotal != null ? Number(row.subtotal) : null;
  if (subtotal != null && total != null) {
    const tax = row.taxAmount != null ? Number(row.taxAmount) : 0;
    const freight = row.freightAmount != null ? Number(row.freightAmount) : 0;
    const computed = subtotal + tax + freight;
    if (Math.abs(computed - total) <= TIE_OUT_TOLERANCE) {
      totalTieOut = "PASS";
    } else {
      totalTieOut = "FAIL";
      blocking.push(
        `Header totals do not tie out: subtotal + tax + freight (${computed.toFixed(2)}) ≠ total (${total.toFixed(2)})`,
      );
    }
  }

  // ── Classify ───────────────────────────────────────────────────────────────
  const validationStatus: ValidationStatus =
    blocking.length > 0 ? "FAILED" : warnings.length > 0 ? "NEEDS_REVIEW" : "PASS";
  const reviewStatus: ReviewStatus =
    blocking.length > 0 ? "EXCEPTION" : warnings.length > 0 ? "NEEDS_REVIEW" : "CLEAN";

  const details: ValidationDetail[] = [
    ...blocking.map((m) => ({ code: "BLOCKING", severity: "error" as const, message: m })),
    ...warnings.map((m) => ({ code: "REVIEW", severity: "warning" as const, message: m })),
  ];

  // ── Determine workflow status ──────────────────────────────────────────────
  const isTerminal = row.status === "APPROVED" || row.status === "POSTED";
  let nextStatus = row.status;
  let overallReviewStatus: string;

  if (isTerminal) {
    overallReviewStatus = row.status === "APPROVED" ? "APPROVED" : "POSTED";
  } else if (blocking.length > 0) {
    nextStatus = "EXCEPTION";
    overallReviewStatus = "EXCEPTION";
  } else {
    nextStatus = "PENDING_APPROVAL";
    overallReviewStatus = warnings.length > 0 ? "NEEDS_REVIEW" : "READY_FOR_APPROVAL";
  }

  // ── Business-facing DocumentID ─────────────────────────────────────────────
  // "VendorID - InvoiceNumber - Amount" using the matched controlled vendor code
  // (never OCR/LLM output). Null until vendor matched and invoice number/total
  // are available — never fabricate a vendor code. The stable internal id and
  // documentId are left untouched (used for audit, file storage, relationships).
  const businessDocumentId =
    row.vendorCode && row.invoiceNumber && total != null
      ? `${row.vendorCode} - ${row.invoiceNumber} - ${total.toFixed(2)}`
      : null;

  // ── Persist ────────────────────────────────────────────────────────────────
  await db
    .update(invoiceCaptureTable)
    .set({
      ...(isTerminal ? {} : { status: nextStatus }),
      ...(derivedDueDate ? { dueDate: derivedDueDate } : {}),
      businessDocumentId,
      exceptionReason: !isTerminal && blocking.length > 0 ? blocking.join("; ") : null,
      validationStatus,
      reviewStatus,
      overallReviewStatus,
      duplicateCheck,
      vendorCheck,
      poCheck,
      amountCheck,
      totalTieOut,
      validationDetails: JSON.stringify(details),
    })
    .where(eq(invoiceCaptureTable.id, invoiceId));

  // ── Audit ──────────────────────────────────────────────────────────────────
  if (!isTerminal) {
    if (blocking.length > 0) {
      await db.insert(invoiceAuditLogTable).values({
        invoiceId,
        action: "ROUTED_TO_EXCEPTION",
        note: blocking.join("; ").slice(0, 500),
      });
    } else if (warnings.length > 0) {
      await db.insert(invoiceAuditLogTable).values({
        invoiceId,
        action: "NEEDS_REVIEW",
        note: warnings.join("; ").slice(0, 500),
      });
    } else {
      await db.insert(invoiceAuditLogTable).values({
        invoiceId,
        action: "VALIDATED",
        note: "Passed validation; routed to pending approval.",
      });
    }
  }

  if (derivedDueDate) {
    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "FIELD_UPDATED",
      fieldName: "dueDate",
      newValue: derivedDueDate,
      note: "Derived from vendor payment terms",
    });
  }

  return {
    validationStatus,
    reviewStatus,
    blocking,
    warnings,
    checks: { duplicateCheck, vendorCheck, poCheck, amountCheck, totalTieOut },
  };
}
