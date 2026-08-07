import { db, invoiceCaptureTable, invoiceAuditLogTable, vendorIdTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { findBestVendorMatch, scoreVendorSimilarity } from "./vendorMatcher";

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

// Soft similarity floor for surfacing a *possible* (non-blocking) duplicate when
// the vendor cannot be resolved to a controlled match at/above threshold.
const POSSIBLE_DUPLICATE_SIMILARITY = 0.6;

/**
 * True if another active invoice already has this vendor + invoice number.
 * Voided/removed invoices are ignored so they never count as duplicates.
 */
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
        ne(invoiceCaptureTable.status, "VOIDED"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Resolve the controlled vendorId to use for duplicate detection. Uses an
 * explicit vendorId when present; otherwise resolves vendorRawName against the
 * controlled Vendor_ID table and returns the id only when the match is at or
 * above the vendor match threshold. Never persisted — detection only.
 */
async function resolveDuplicateVendorId(
  vendorId: number | null,
  vendorRawName: string | null,
): Promise<number | null> {
  if (vendorId != null) return vendorId;
  if (!vendorRawName?.trim()) return null;
  const outcome = await findBestVendorMatch(vendorRawName);
  if (
    outcome.status === "matched" ||
    outcome.status === "inactive" ||
    outcome.status === "on_hold"
  ) {
    return outcome.match.vendorId;
  }
  return null;
}

/**
 * True if another active invoice shares this invoice number and a *similar*
 * vendor raw name. Used to surface a non-blocking "possible duplicate" warning
 * when the vendor cannot be confidently resolved to a controlled match.
 */
async function hasPossibleDuplicate(
  invoiceId: number,
  vendorRawName: string | null,
  invoiceNumber: string | null,
): Promise<boolean> {
  if (!vendorRawName?.trim() || !invoiceNumber) return false;
  const rows = await db
    .select({ vendorRawName: invoiceCaptureTable.vendorRawName })
    .from(invoiceCaptureTable)
    .where(
      and(
        eq(invoiceCaptureTable.invoiceNumber, invoiceNumber),
        ne(invoiceCaptureTable.id, invoiceId),
        ne(invoiceCaptureTable.status, "VOIDED"),
      ),
    );
  return rows.some(
    (r) =>
      r.vendorRawName != null &&
      scoreVendorSimilarity(vendorRawName, r.vendorRawName) >= POSSIBLE_DUPLICATE_SIMILARITY,
  );
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

// ─── Header tie-out ──────────────────────────────────────────────────────────
const TIE_OUT_WARNING_TOLERANCE = 0.05; // dollars — minor rounding allowance

export type TieOutStatus = "PASS" | "WARNING" | "FAIL" | "SKIPPED";

export interface TieOutInput {
  subtotal: number | null;
  tax: number | null;
  freight: number | null;
  /** Discount magnitude (always subtracted); callers pass the absolute value. */
  discount: number | null;
  otherCharges: number | null;
  total: number | null;
}

export interface TieOutResult {
  status: TieOutStatus;
  expectedTotal: number | null;
  difference: number | null;
  explanation: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmtMoney(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

/**
 * Reconcile header amounts. Expected total = subtotal + tax + freight +
 * other charges − discount. The discount magnitude is always subtracted (callers
 * pass its absolute value) so a discount shown as "(50)" or "-50" still reduces
 * the expected total; a credit in other charges (negative) likewise reduces it.
 * Returns an explainable status:
 *   - SKIPPED  — subtotal or total missing (cannot reconcile)
 *   - PASS     — |difference| ≤ $0.01
 *   - WARNING  — |difference| ≤ $0.05 (minor rounding)
 *   - FAIL     — |difference| > $0.05 (material; required amounts present)
 * Optional components (tax/freight/discount/other) default to 0 when absent and
 * never cause a false failure on their own.
 */
export function computeTieOut(input: TieOutInput): TieOutResult {
  const { subtotal, tax, freight, discount, otherCharges, total } = input;

  if (subtotal == null || total == null) {
    const missing: string[] = [];
    if (subtotal == null) missing.push("subtotal");
    if (total == null) missing.push("invoice total");
    return {
      status: "SKIPPED",
      expectedTotal: null,
      difference: null,
      explanation: `Tie-out skipped — ${missing.join(" and ")} ${
        missing.length > 1 ? "are" : "is"
      } missing. Provide the missing amount${
        missing.length > 1 ? "s" : ""
      } to reconcile the header.`,
    };
  }

  const taxN = tax ?? 0;
  const freightN = freight ?? 0;
  const discountN = discount ?? 0;
  const otherN = otherCharges ?? 0;

  const expectedTotal = round2(subtotal + taxN + freightN + otherN - discountN);
  const difference = round2(total - expectedTotal);
  const absDiff = Math.abs(difference);

  const formula =
    `Expected ${fmtMoney(expectedTotal)} = subtotal ${fmtMoney(subtotal)}` +
    ` + tax ${fmtMoney(taxN)} + freight ${fmtMoney(freightN)}` +
    ` + other charges ${fmtMoney(otherN)} − discount ${fmtMoney(discountN)}.` +
    ` Invoice total is ${fmtMoney(total)}`;

  if (absDiff <= TIE_OUT_TOLERANCE) {
    return {
      status: "PASS",
      expectedTotal,
      difference,
      explanation: `${formula} — matches within $${TIE_OUT_TOLERANCE.toFixed(2)}.`,
    };
  }
  if (absDiff <= TIE_OUT_WARNING_TOLERANCE) {
    return {
      status: "WARNING",
      expectedTotal,
      difference,
      explanation: `${formula}, a difference of ${fmtMoney(
        difference,
      )} — within the $${TIE_OUT_WARNING_TOLERANCE.toFixed(
        2,
      )} rounding tolerance. Confirm the amounts before approval.`,
    };
  }
  return {
    status: "FAIL",
    expectedTotal,
    difference,
    explanation: `${formula}, a difference of ${fmtMoney(
      difference,
    )} — exceeds the $${TIE_OUT_WARNING_TOLERANCE.toFixed(
      2,
    )} tolerance. Review the amounts before approval.`,
  };
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
      discountAmount: invoiceCaptureTable.discountAmount,
      otherChargesAmount: invoiceCaptureTable.otherChargesAmount,
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
  // Resolve the controlled vendor from vendorRawName when no vendorId is set, so
  // duplicates are detected even before the vendor is assigned. The resolved id
  // is used for detection only and is never written to the invoice.
  let duplicateCheck: CheckResult = "PASS";
  const dupVendorId = await resolveDuplicateVendorId(row.vendorId, row.vendorRawName);
  if (!row.invoiceNumber) {
    duplicateCheck = "SKIPPED";
  } else if (dupVendorId != null) {
    if (await hasDuplicate(invoiceId, dupVendorId, row.invoiceNumber)) {
      duplicateCheck = "FAIL";
      blocking.push("Duplicate invoice detected for this vendor and invoice number.");
    }
  } else if (await hasPossibleDuplicate(invoiceId, row.vendorRawName, row.invoiceNumber)) {
    // Vendor not confidently resolved, but another active invoice shares this
    // invoice number with a similar vendor name — surface a non-blocking warning.
    duplicateCheck = "WARNING";
    warnings.push("Possible duplicate invoice (similar vendor name and same invoice number).");
  } else {
    duplicateCheck = "SKIPPED";
  }

  // ── PO check (PO source validation skipped — no PO source configured) ───────
  let poCheck: CheckResult;
  if (row.poNumber) {
    poCheck = "PASS";
  } else {
    poCheck = "WARNING";
    warnings.push("PO number not captured");
  }

  // ── Header total tie-out ───────────────────────────────────────────────────
  // Expected = subtotal + tax + freight + other charges − discount.
  const subtotal = row.subtotal != null ? Number(row.subtotal) : null;
  const tieOut = computeTieOut({
    subtotal,
    tax: row.taxAmount != null ? Number(row.taxAmount) : null,
    freight: row.freightAmount != null ? Number(row.freightAmount) : null,
    // Discounts reduce the total regardless of how the source shows the sign,
    // so reconcile on the magnitude.
    discount: row.discountAmount != null ? Math.abs(Number(row.discountAmount)) : null,
    otherCharges: row.otherChargesAmount != null ? Number(row.otherChargesAmount) : null,
    total,
  });
  const totalTieOut: CheckResult = tieOut.status;
  if (tieOut.status === "FAIL") {
    // Material mismatch with required amounts present → blocks approval.
    blocking.push(tieOut.explanation);
  } else if (tieOut.status === "WARNING") {
    // Within rounding tolerance → visible, allows approval.
    warnings.push(tieOut.explanation);
  } else if (tieOut.status === "SKIPPED" && total != null) {
    // Total is present but the subtotal is missing — surface for AP review
    // without auto-blocking (business rules may allow a missing subtotal).
    warnings.push(tieOut.explanation);
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
      tieOutStatus: tieOut.status,
      tieOutExpectedTotal: tieOut.expectedTotal != null ? String(tieOut.expectedTotal) : null,
      tieOutDifference: tieOut.difference != null ? String(tieOut.difference) : null,
      tieOutExplanation: tieOut.explanation,
      validationDetails: JSON.stringify(details),
    })
    .where(eq(invoiceCaptureTable.id, invoiceId));

  // ── Audit ──────────────────────────────────────────────────────────────────
  if (!isTerminal) {
    if (blocking.length > 0) {
      await db.insert(invoiceAuditLogTable).values({
        invoiceId,
        action: "ROUTED_TO_EXCEPTION",
        actorClerkId: "system-pipeline",
        note: blocking.join("; ").slice(0, 500),
      });
    } else if (warnings.length > 0) {
      await db.insert(invoiceAuditLogTable).values({
        invoiceId,
        action: "NEEDS_REVIEW",
        actorClerkId: "system-pipeline",
        note: warnings.join("; ").slice(0, 500),
      });
    } else {
      await db.insert(invoiceAuditLogTable).values({
        invoiceId,
        action: "VALIDATED",
        actorClerkId: "system-pipeline",
        note: "Passed validation; routed to pending approval.",
      });
    }
  }

  if (derivedDueDate) {
    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "FIELD_UPDATED",
      actorClerkId: "system-pipeline",
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
