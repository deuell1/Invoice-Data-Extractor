import { db, vendorIdTable, invoiceCaptureTable, invoiceAuditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const VENDOR_MATCH_THRESHOLD = 0.85;

// ─── Text normalization ───────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // replace punctuation with space
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter((t) => t.length > 0));
}

// ─── Scoring algorithms ───────────────────────────────────────────────────────

function jaccardScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return intersection / union;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1 : 1 - dp[m][n] / maxLen;
}

/**
 * Score how well vendorRawName matches a candidate name.
 * Returns a value 0-1, combining Jaccard (token overlap) and Levenshtein
 * (character edit distance) on normalized strings.
 */
export function scoreVendorSimilarity(a: string, b: string): number {
  return scoreMatch(a, b);
}

function scoreMatch(raw: string, candidate: string): number {
  const normRaw = normalize(raw);
  const normCand = normalize(candidate);

  if (normRaw === normCand) return 1.0;

  // If one fully contains the other as tokens, give a boost
  const tokensRaw = tokenize(raw);
  const tokensCand = tokenize(candidate);
  let containsBonus = 0;
  if (tokensCand.size > 0) {
    let hits = 0;
    for (const t of tokensCand) {
      if (tokensRaw.has(t)) hits++;
    }
    if (hits === tokensCand.size) containsBonus = 0.1;
  }

  const jaccard = jaccardScore(raw, candidate);
  const lev = levenshtein(normRaw, normCand);

  // Weight Jaccard (token overlap) more heavily for business names
  const combined = Math.min(1, 0.6 * jaccard + 0.4 * lev + containsBonus);
  return combined;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface VendorMatchResult {
  vendorId: number;
  vendorName: string;
  vendorCode: string;
  isActive: boolean;
  onHold: boolean;
  score: number;
  matchedAlias: string | null;
}

export type VendorMatchOutcome =
  | { status: "matched"; match: VendorMatchResult }
  | { status: "no_match" }
  | { status: "low_confidence"; match: VendorMatchResult }
  | { status: "inactive"; match: VendorMatchResult }
  | { status: "on_hold"; match: VendorMatchResult };

// ─── Core matching logic ──────────────────────────────────────────────────────

export async function findBestVendorMatch(
  vendorRawName: string
): Promise<VendorMatchOutcome> {
  if (!vendorRawName.trim()) return { status: "no_match" };

  const vendors = await db.select().from(vendorIdTable);

  let bestScore = 0;
  let bestVendor: (typeof vendors)[0] | null = null;
  let bestAlias: string | null = null;

  for (const vendor of vendors) {
    // Score against primary vendorName
    const primaryScore = scoreMatch(vendorRawName, vendor.vendorName);
    if (primaryScore > bestScore) {
      bestScore = primaryScore;
      bestVendor = vendor;
      bestAlias = null;
    }

    // Score against legalName (if set)
    if (vendor.legalName) {
      const legalScore = scoreMatch(vendorRawName, vendor.legalName);
      if (legalScore > bestScore) {
        bestScore = legalScore;
        bestVendor = vendor;
        bestAlias = vendor.legalName;
      }
    }

    // Score against DBA / TradeName (if set)
    if (vendor.dba) {
      const dbaScore = scoreMatch(vendorRawName, vendor.dba);
      if (dbaScore > bestScore) {
        bestScore = dbaScore;
        bestVendor = vendor;
        bestAlias = vendor.dba;
      }
    }

    // Score against each alias
    const aliases = (vendor.aliases as string[] | null) ?? [];
    for (const alias of aliases) {
      const aliasScore = scoreMatch(vendorRawName, alias);
      if (aliasScore > bestScore) {
        bestScore = aliasScore;
        bestVendor = vendor;
        bestAlias = alias;
      }
    }
  }

  if (!bestVendor || bestScore === 0) {
    return { status: "no_match" };
  }

  const matchResult: VendorMatchResult = {
    vendorId: bestVendor.id,
    vendorName: bestVendor.vendorName,
    vendorCode: bestVendor.vendorCode,
    isActive: bestVendor.isActive,
    onHold: bestVendor.onHold,
    score: bestScore,
    matchedAlias: bestAlias,
  };

  if (bestScore < VENDOR_MATCH_THRESHOLD) {
    return { status: "low_confidence", match: matchResult };
  }

  if (!bestVendor.isActive) {
    return { status: "inactive", match: matchResult };
  }

  if (bestVendor.onHold) {
    return { status: "on_hold", match: matchResult };
  }

  return { status: "matched", match: matchResult };
}

// ─── Apply match result to an invoice ────────────────────────────────────────

export async function applyVendorMatch(
  invoiceId: number,
  vendorRawName: string
): Promise<{ routed: boolean; exceptionReason: string | null }> {
  const outcome = await findBestVendorMatch(vendorRawName);

  if (outcome.status === "no_match") {
    await db
      .update(invoiceCaptureTable)
      .set({
        status: "EXCEPTION",
        vendorMatchScore: null,
        exceptionReason: `No vendor match found for "${vendorRawName}"`,
      })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "VENDOR_MATCH_FAILED",
      note: `No vendor found in vendor_id table matching "${vendorRawName}"`,
    });

    return { routed: false, exceptionReason: `No vendor match for "${vendorRawName}"` };
  }

  const { match } = outcome;
  const scoreStr = String(match.score.toFixed(4));

  if (outcome.status === "low_confidence") {
    await db
      .update(invoiceCaptureTable)
      .set({
        status: "EXCEPTION",
        vendorMatchScore: scoreStr,
        exceptionReason: `Vendor match confidence ${(match.score * 100).toFixed(1)}% below 85% threshold (best: "${match.vendorName}")`,
      })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "VENDOR_MATCH_LOW_CONFIDENCE",
      fieldName: "vendorMatchScore",
      newValue: scoreStr,
      note: `Best match "${match.vendorName}" scored ${(match.score * 100).toFixed(1)}% — below 85% threshold`,
    });

    return {
      routed: false,
      exceptionReason: `Low vendor match confidence: ${(match.score * 100).toFixed(1)}%`,
    };
  }

  if (outcome.status === "inactive") {
    await db
      .update(invoiceCaptureTable)
      .set({
        vendorId: match.vendorId,
        vendorMatchScore: scoreStr,
        status: "EXCEPTION",
        exceptionReason: `Matched vendor "${match.vendorName}" is inactive`,
      })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "VENDOR_MATCH_INACTIVE",
      fieldName: "vendorId",
      newValue: String(match.vendorId),
      note: `Matched vendor "${match.vendorName}" (score ${(match.score * 100).toFixed(1)}%) is inactive`,
    });

    return {
      routed: false,
      exceptionReason: `Vendor "${match.vendorName}" is inactive`,
    };
  }

  if (outcome.status === "on_hold") {
    await db
      .update(invoiceCaptureTable)
      .set({
        vendorId: match.vendorId,
        vendorMatchScore: scoreStr,
        status: "EXCEPTION",
        exceptionReason: `Matched vendor "${match.vendorName}" is on hold`,
      })
      .where(eq(invoiceCaptureTable.id, invoiceId));

    await db.insert(invoiceAuditLogTable).values({
      invoiceId,
      action: "VENDOR_MATCH_ON_HOLD",
      fieldName: "vendorId",
      newValue: String(match.vendorId),
      note: `Matched vendor "${match.vendorName}" (score ${(match.score * 100).toFixed(1)}%) is on hold`,
    });

    return {
      routed: false,
      exceptionReason: `Vendor "${match.vendorName}" is on hold`,
    };
  }

  // outcome.status === "matched" — success
  // Fetch current status to decide whether to clear a vendor-related exception
  const [current] = await db
    .select({ status: invoiceCaptureTable.status, exceptionReason: invoiceCaptureTable.exceptionReason })
    .from(invoiceCaptureTable)
    .where(eq(invoiceCaptureTable.id, invoiceId))
    .limit(1);

  const isVendorException =
    current?.status === "EXCEPTION" &&
    (current?.exceptionReason?.toLowerCase().includes("vendor") ||
      current?.exceptionReason?.toLowerCase().includes("match"));

  await db
    .update(invoiceCaptureTable)
    .set({
      vendorId: match.vendorId,
      vendorMatchScore: scoreStr,
      // Clear vendor exception and return to extraction queue only if stuck in a vendor-caused exception
      ...(isVendorException ? { status: "PENDING_EXTRACTION" as const, exceptionReason: null } : {}),
    })
    .where(eq(invoiceCaptureTable.id, invoiceId));

  await db.insert(invoiceAuditLogTable).values({
    invoiceId,
    action: "VENDOR_MATCHED",
    fieldName: "vendorId",
    newValue: String(match.vendorId),
    note: `Matched to "${match.vendorName}" (${match.matchedAlias ? `alias: "${match.matchedAlias}", ` : ""}score ${(match.score * 100).toFixed(1)}%)${isVendorException ? " — cleared vendor exception" : ""}`,
  });

  return { routed: true, exceptionReason: null };
}
