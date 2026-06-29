import { randomUUID } from "node:crypto";
import { eq, sql, inArray, isNotNull, or, and } from "drizzle-orm";
import {
  db,
  vendorIdTable,
  invoiceCaptureTable,
  poHeaderTable,
  importBatchTable,
  vendorCleanupLogTable,
  vendorAuditLogTable,
  type VendorCleanupDetail,
} from "@workspace/db";

export type CleanupMode = "DELETE_SAFE" | "DELETE_AND_DEACTIVATE" | "FULL_RESET";
export type RecommendedAction = "DELETE" | "DEACTIVATE" | "KEEP";

export interface CleanupItem {
  vendorId: number;
  vendorCode: string;
  vendorName: string;
  importBatchId: string | null;
  lastImportedAt: string | null;
  isActive: boolean;
  onHold: boolean;
  imported: boolean;
  invoiceRefCount: number;
  poRefCount: number;
  canDelete: boolean;
  mustRetain: boolean;
  recommendedAction: RecommendedAction;
}

export interface BatchStatus {
  batchId: string;
  fileName: string;
  cleanupStatus: string;
  importedVendorsRemaining: number;
}

export interface CleanupPreview {
  totalImported: number;
  safeToDelete: number;
  referencedRetained: number;
  toDeactivate: number;
  fullResetAllowed: boolean;
  fullResetBlockReason: string | null;
  items: CleanupItem[];
  batchStatuses: BatchStatus[];
}

const DEACTIVATION_NOTE = "Deactivated during imported vendor cleanup.";

// ─── Core analysis ──────────────────────────────────────────────────────────
// Builds the per-vendor cleanup plan for all imported vendors (optionally scoped
// to a single import batch). An imported vendor has importBatchId OR lastImportedAt.
// A vendor is referenced (and must be retained / can only be deactivated) when it
// is pointed to by an invoice (FK) or a PO header (by vendor code).
async function loadImportedVendors(importBatchId?: string | null) {
  const importedPredicate = or(
    isNotNull(vendorIdTable.importBatchId),
    isNotNull(vendorIdTable.lastImportedAt),
  );
  const where = importBatchId
    ? and(importedPredicate, eq(vendorIdTable.importBatchId, importBatchId))
    : importedPredicate;

  return db.select().from(vendorIdTable).where(where);
}

async function computeReferenceCounts(
  vendorIds: number[],
  vendorCodes: string[],
): Promise<{
  invoiceCounts: Map<number, number>;
  poCounts: Map<string, number>;
}> {
  const invoiceCounts = new Map<number, number>();
  const poCounts = new Map<string, number>();

  if (vendorIds.length > 0) {
    const invoiceRows = await db
      .select({
        vendorId: invoiceCaptureTable.vendorId,
        count: sql<number>`count(*)::int`,
      })
      .from(invoiceCaptureTable)
      .where(inArray(invoiceCaptureTable.vendorId, vendorIds))
      .groupBy(invoiceCaptureTable.vendorId);
    for (const r of invoiceRows) {
      if (r.vendorId != null) invoiceCounts.set(r.vendorId, Number(r.count));
    }
  }

  if (vendorCodes.length > 0) {
    const poRows = await db
      .select({
        vendorCode: poHeaderTable.vendorCode,
        count: sql<number>`count(*)::int`,
      })
      .from(poHeaderTable)
      .where(inArray(poHeaderTable.vendorCode, vendorCodes))
      .groupBy(poHeaderTable.vendorCode);
    for (const r of poRows) {
      if (r.vendorCode != null) poCounts.set(r.vendorCode, Number(r.count));
    }
  }

  return { invoiceCounts, poCounts };
}

function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export async function computeCleanupPlan(
  importBatchId?: string | null,
): Promise<CleanupPreview> {
  const vendors = await loadImportedVendors(importBatchId);
  const vendorIds = vendors.map((v) => v.id);
  const vendorCodes = vendors.map((v) => v.vendorCode);

  const { invoiceCounts, poCounts } = await computeReferenceCounts(
    vendorIds,
    vendorCodes,
  );

  const items: CleanupItem[] = vendors.map((v) => {
    const invoiceRefCount = invoiceCounts.get(v.id) ?? 0;
    const poRefCount = poCounts.get(v.vendorCode) ?? 0;
    const referenced = invoiceRefCount > 0 || poRefCount > 0;
    const canDelete = !referenced;
    const recommendedAction: RecommendedAction = referenced
      ? "DEACTIVATE"
      : "DELETE";
    return {
      vendorId: v.id,
      vendorCode: v.vendorCode,
      vendorName: v.vendorName,
      importBatchId: v.importBatchId ?? null,
      lastImportedAt: toIsoOrNull(v.lastImportedAt),
      isActive: v.isActive,
      onHold: v.onHold,
      imported: true,
      invoiceRefCount,
      poRefCount,
      canDelete,
      mustRetain: referenced,
      recommendedAction,
    };
  });

  const safeToDelete = items.filter((i) => i.canDelete).length;
  const referencedRetained = items.filter((i) => i.mustRetain).length;
  // Vendors that would be deactivated under DELETE_AND_DEACTIVATE: referenced
  // imported vendors that are still active.
  const toDeactivate = items.filter((i) => i.mustRetain && i.isActive).length;

  const fullResetAllowed = referencedRetained === 0;
  const fullResetBlockReason = fullResetAllowed
    ? null
    : `${referencedRetained} imported vendor(s) are referenced by invoices or purchase orders and cannot be deleted. Full reset is blocked.`;

  const batchStatuses = await computeBatchStatuses();

  return {
    totalImported: items.length,
    safeToDelete,
    referencedRetained,
    toDeactivate,
    fullResetAllowed,
    fullResetBlockReason,
    items,
    batchStatuses,
  };
}

// ─── Import batch cleanup status ────────────────────────────────────────────
// Derives a display status for each vendor-master import batch based on how many
// of its imported vendors still exist and whether the remaining ones are
// referenced. The persisted import_batch.cleanupStatus is updated on commit.
async function computeBatchStatuses(): Promise<BatchStatus[]> {
  const batches = await db
    .select()
    .from(importBatchTable)
    .where(eq(importBatchTable.importType, "VENDOR_MASTER"));

  const remainingRows = await db
    .select({
      importBatchId: vendorIdTable.importBatchId,
      count: sql<number>`count(*)::int`,
    })
    .from(vendorIdTable)
    .where(isNotNull(vendorIdTable.importBatchId))
    .groupBy(vendorIdTable.importBatchId);

  const remainingByBatch = new Map<string, number>();
  for (const r of remainingRows) {
    if (r.importBatchId) remainingByBatch.set(r.importBatchId, Number(r.count));
  }

  return batches.map((b) => ({
    batchId: b.batchId,
    fileName: b.fileName,
    cleanupStatus: b.cleanupStatus,
    importedVendorsRemaining: remainingByBatch.get(b.batchId) ?? 0,
  }));
}

// ─── Commit ─────────────────────────────────────────────────────────────────
export interface CleanupCommitParams {
  mode: CleanupMode;
  actor: string;
  reason: string;
  importBatchId?: string | null;
}

export interface CleanupCommitResult {
  cleanupId: string;
  mode: CleanupMode;
  actor: string;
  reason: string;
  vendorsReviewed: number;
  vendorsDeleted: number;
  vendorsDeactivated: number;
  vendorsSkipped: number;
  details: VendorCleanupDetail[];
  createdAt: string;
}

export class FullResetBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FullResetBlockedError";
  }
}

export async function commitCleanup(
  params: CleanupCommitParams,
): Promise<CleanupCommitResult> {
  const { mode, actor, reason, importBatchId } = params;
  const cleanupId = `CLN-${randomUUID()}`;

  return db.transaction(async (tx) => {
    // Re-derive the plan inside the transaction for consistency.
    const importedPredicate = or(
      isNotNull(vendorIdTable.importBatchId),
      isNotNull(vendorIdTable.lastImportedAt),
    );
    const where = importBatchId
      ? and(importedPredicate, eq(vendorIdTable.importBatchId, importBatchId))
      : importedPredicate;
    const vendors = await tx.select().from(vendorIdTable).where(where);

    const vendorIds = vendors.map((v) => v.id);
    const vendorCodes = vendors.map((v) => v.vendorCode);

    const invoiceCounts = new Map<number, number>();
    const poCounts = new Map<string, number>();
    if (vendorIds.length > 0) {
      const invoiceRows = await tx
        .select({
          vendorId: invoiceCaptureTable.vendorId,
          count: sql<number>`count(*)::int`,
        })
        .from(invoiceCaptureTable)
        .where(inArray(invoiceCaptureTable.vendorId, vendorIds))
        .groupBy(invoiceCaptureTable.vendorId);
      for (const r of invoiceRows) {
        if (r.vendorId != null) invoiceCounts.set(r.vendorId, Number(r.count));
      }
    }
    if (vendorCodes.length > 0) {
      const poRows = await tx
        .select({
          vendorCode: poHeaderTable.vendorCode,
          count: sql<number>`count(*)::int`,
        })
        .from(poHeaderTable)
        .where(inArray(poHeaderTable.vendorCode, vendorCodes))
        .groupBy(poHeaderTable.vendorCode);
      for (const r of poRows) {
        if (r.vendorCode != null) poCounts.set(r.vendorCode, Number(r.count));
      }
    }

    const annotated = vendors.map((v) => {
      const invoiceRefCount = invoiceCounts.get(v.id) ?? 0;
      const poRefCount = poCounts.get(v.vendorCode) ?? 0;
      const referenced = invoiceRefCount > 0 || poRefCount > 0;
      return { v, referenced, invoiceRefCount, poRefCount };
    });

    const anyReferenced = annotated.some((a) => a.referenced);

    // FULL_RESET is only permitted when no imported vendor is referenced.
    if (mode === "FULL_RESET" && anyReferenced) {
      const blockedCount = annotated.filter((a) => a.referenced).length;
      throw new FullResetBlockedError(
        `Full reset blocked: ${blockedCount} imported vendor(s) are referenced by invoices or purchase orders. Use "Delete safe + deactivate referenced" mode instead.`,
      );
    }

    const details: VendorCleanupDetail[] = [];
    const idsToDelete: number[] = [];
    let vendorsDeleted = 0;
    let vendorsDeactivated = 0;
    let vendorsSkipped = 0;

    for (const { v, referenced } of annotated) {
      const oldStatus = v.isActive ? "ACTIVE" : "INACTIVE";

      if (!referenced) {
        // Safe to delete in all three modes.
        idsToDelete.push(v.id);
        vendorsDeleted += 1;
        details.push({
          vendorId: v.id,
          vendorCode: v.vendorCode,
          vendorName: v.vendorName,
          oldStatus,
          newStatus: "DELETED",
          action: "DELETED",
          reason: "Imported vendor with no invoice or PO references.",
        });
        continue;
      }

      // Referenced vendor: never delete.
      if (mode === "DELETE_AND_DEACTIVATE") {
        if (v.isActive) {
          await tx
            .update(vendorIdTable)
            .set({
              isActive: false,
              notes: v.notes
                ? `${v.notes}\n${DEACTIVATION_NOTE}`
                : DEACTIVATION_NOTE,
              updatedBy: actor,
            })
            .where(eq(vendorIdTable.id, v.id));

          await tx.insert(vendorAuditLogTable).values({
            vendorId: v.id,
            action: "DEACTIVATE",
            fieldName: "isActive",
            oldValue: "true",
            newValue: "false",
            actor,
            reason: `${DEACTIVATION_NOTE} (${reason})`,
          });

          vendorsDeactivated += 1;
          details.push({
            vendorId: v.id,
            vendorCode: v.vendorCode,
            vendorName: v.vendorName,
            oldStatus,
            newStatus: "INACTIVE",
            action: "DEACTIVATED",
            reason: "Referenced imported vendor deactivated instead of deleted.",
          });
        } else {
          vendorsSkipped += 1;
          details.push({
            vendorId: v.id,
            vendorCode: v.vendorCode,
            vendorName: v.vendorName,
            oldStatus,
            newStatus: oldStatus,
            action: "SKIPPED",
            reason: "Referenced imported vendor already inactive.",
          });
        }
      } else {
        // DELETE_SAFE (and FULL_RESET path never reaches here because it would
        // have thrown above): leave referenced vendors untouched.
        vendorsSkipped += 1;
        details.push({
          vendorId: v.id,
          vendorCode: v.vendorCode,
          vendorName: v.vendorName,
          oldStatus,
          newStatus: oldStatus,
          action: "SKIPPED",
          reason: "Referenced by invoices or POs — retained (not deleted).",
        });
      }
    }

    // Batches that lost at least one vendor to deletion this run.
    const deletedBatchIds = new Set<string>();
    // Batches that had at least one referenced vendor retained (deactivated or
    // skipped) this run — used to mark RETAINED when nothing was deleted.
    const retainedBatchIds = new Set<string>();
    for (const { v, referenced } of annotated) {
      if (!v.importBatchId) continue;
      if (referenced) retainedBatchIds.add(v.importBatchId);
      else deletedBatchIds.add(v.importBatchId);
    }

    // Audit each deleted vendor before removing it, then delete.
    if (idsToDelete.length > 0) {
      const deletedDetails = details.filter((d) => d.action === "DELETED");
      if (deletedDetails.length > 0) {
        await tx.insert(vendorAuditLogTable).values(
          deletedDetails.map((d) => ({
            vendorId: d.vendorId,
            action: "DELETE",
            fieldName: null,
            oldValue: `${d.vendorCode} — ${d.vendorName}`,
            newValue: null,
            actor,
            reason: `Imported vendor cleanup (${cleanupId}): ${reason}`,
          })),
        );
      }
      await tx
        .delete(vendorIdTable)
        .where(inArray(vendorIdTable.id, idsToDelete));
    }

    // Update import_batch cleanup statuses for affected vendor-master batches.
    await updateBatchCleanupStatuses(tx, deletedBatchIds, retainedBatchIds);

    const [logRow] = await tx
      .insert(vendorCleanupLogTable)
      .values({
        cleanupId,
        mode,
        actor,
        reason,
        vendorsReviewed: annotated.length,
        vendorsDeleted,
        vendorsDeactivated,
        vendorsSkipped,
        details,
      })
      .returning();

    return {
      cleanupId,
      mode,
      actor,
      reason,
      vendorsReviewed: logRow.vendorsReviewed,
      vendorsDeleted: logRow.vendorsDeleted,
      vendorsDeactivated: logRow.vendorsDeactivated,
      vendorsSkipped: logRow.vendorsSkipped,
      details,
      createdAt:
        logRow.createdAt instanceof Date
          ? logRow.createdAt.toISOString()
          : String(logRow.createdAt),
    };
  });
}

// Recompute each vendor-master batch's cleanup status after deletions.
// Statuses: FULLY_CLEANED (no imported vendors remain), PARTIALLY_CLEANED (some
// were deleted but referenced ones remain), RETAINED (had deletions blocked /
// only referenced vendors remain), ACTIVE (untouched).
async function updateBatchCleanupStatuses(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  deletedBatchIds: Set<string>,
  retainedBatchIds: Set<string>,
): Promise<void> {
  const batches = await tx
    .select()
    .from(importBatchTable)
    .where(eq(importBatchTable.importType, "VENDOR_MASTER"));

  for (const b of batches) {
    const remaining = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(vendorIdTable)
      .where(eq(vendorIdTable.importBatchId, b.batchId));

    const total = Number(remaining[0]?.total ?? 0);
    const hadDeletions = deletedBatchIds.has(b.batchId);
    const hadRetained = retainedBatchIds.has(b.batchId);

    let cleanupStatus = b.cleanupStatus;
    if (total === 0) {
      cleanupStatus = "FULLY_CLEANED";
    } else if (hadDeletions) {
      // Some vendors deleted, some remain.
      cleanupStatus = "PARTIALLY_CLEANED";
    } else if (hadRetained) {
      // Nothing deleted this run, but its imported vendors were all retained
      // because they are referenced by invoices or POs.
      cleanupStatus = "RETAINED";
    }
    // Otherwise untouched this run — leave the existing status unchanged.

    if (cleanupStatus !== b.cleanupStatus) {
      await tx
        .update(importBatchTable)
        .set({ cleanupStatus })
        .where(eq(importBatchTable.id, b.id));
    }
  }
}
