import { useState } from "react";
import { useLocation, Link } from "wouter";
import { format } from "date-fns";
import {
  useGetSourceDocument,
  getGetSourceDocumentQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import {
  Loader2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  ScanLine,
  Ban,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { SourceDocumentCleanupActions } from "@/components/cleanup-actions";

const POLL_INTERVAL_MS = 1500;

/** A source document still settling if it's detecting or any invoice is mid-extraction. */
function isInProgress(
  processingStatus: string | undefined,
  invoices: Invoice[] | undefined,
): boolean {
  if (processingStatus === "PENDING" || processingStatus === "DETECTING") return true;
  return (invoices ?? []).some(
    (i) =>
      i.extractionStatus === "PENDING" ||
      i.extractionStatus === "PROCESSING" ||
      !i.extractionStatus,
  );
}

function invoiceLabel(inv: Invoice): string {
  return inv.businessDocumentId || inv.documentId || `#${inv.id}`;
}

function pageRangeLabel(inv: Invoice): string | null {
  if (inv.pageStart == null || inv.pageEnd == null) return null;
  return inv.pageStart === inv.pageEnd
    ? `Page ${inv.pageStart}`
    : `Pages ${inv.pageStart}–${inv.pageEnd}`;
}

export function SourceDocumentSummary({ sourceDocumentId }: { sourceDocumentId: number }) {
  const [, setLocation] = useLocation();
  const [showRemoved, setShowRemoved] = useState(false);

  const { data, isLoading, error } = useGetSourceDocument(sourceDocumentId, {
    query: {
      enabled: !!sourceDocumentId,
      queryKey: getGetSourceDocumentQueryKey(sourceDocumentId),
      refetchInterval: (query) =>
        isInProgress(query.state.data?.source.processingStatus, query.state.data?.invoices)
          ? POLL_INTERVAL_MS
          : false,
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-12" data-testid="source-summary-loading">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center text-destructive" data-testid="source-summary-error">
        Failed to load uploaded file.
      </div>
    );
  }

  const { source, invoices, invoiceCount, extractedCount, exceptionCount, pendingCount, removedCount, duplicateSourceDocument } = data;
  const detecting = source.processingStatus === "PENDING" || source.processingStatus === "DETECTING";
  const detectionFailed = source.processingStatus === "EXCEPTION";
  const isRemoved = source.removedAt != null;
  const hasPostedChild = invoices.some((i) => i.status === "POSTED");
  const activeInvoices = invoices.filter((i) => i.status !== "VOIDED");
  const displayInvoices = showRemoved ? invoices : activeInvoices;

  return (
    <Card data-testid="source-summary">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 shrink-0" />
              <span className="truncate" data-testid="text-source-filename">
                {source.originalFileName}
              </span>
              {isRemoved && (
                <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground shrink-0">
                  Removed
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {detecting
                ? "Detecting invoices in this file…"
                : detectionFailed
                  ? "We couldn't process this file."
                  : `${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"} detected${
                      source.pageCount ? ` across ${source.pageCount} page${source.pageCount === 1 ? "" : "s"}` : ""
                    }.`}
            </CardDescription>
          </div>
          {!detecting && (
            <SourceDocumentCleanupActions
              sourceDocumentId={sourceDocumentId}
              hasPostedChild={hasPostedChild}
              onDeleted={() => setLocation("/invoices")}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isRemoved && (
          <div
            className="flex items-start gap-3 rounded-lg border border-muted-foreground/20 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
            data-testid="source-removed-banner"
          >
            <Ban className="h-5 w-5 shrink-0" />
            <span>
              This file was removed{source.removalReason ? `: ${source.removalReason}` : "."} Its invoices are hidden
              from active queues.
            </span>
          </div>
        )}
        {duplicateSourceDocument && (
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-700"
            data-testid="source-duplicate-warning"
          >
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Possible duplicate upload</p>
              <p className="text-xs mt-0.5 opacity-80">
                This file's content matches{" "}
                <span className="font-medium">{duplicateSourceDocument.originalFileName}</span>
                {duplicateSourceDocument.uploadedAt
                  ? ` uploaded ${format(new Date(duplicateSourceDocument.uploadedAt), "MMM d, yyyy")}`
                  : ""}
                .{" "}
                <Link
                  href={`/sources/${duplicateSourceDocument.id}`}
                  className="underline underline-offset-2"
                >
                  View original
                </Link>
              </p>
            </div>
          </div>
        )}
        {detecting && (
          <div
            className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700"
            data-testid="source-detecting"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Scanning the document for separate invoices…</span>
          </div>
        )}

        {detectionFailed && (
          <div
            className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            data-testid="source-detection-failed"
          >
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{source.processingError || "Detection failed for this file."}</span>
          </div>
        )}

        {!detecting && invoiceCount > 0 && (
          <div className="grid grid-cols-3 gap-3" data-testid="source-counts">
            <div className="rounded-lg border bg-green-50 border-green-200 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-lg font-semibold" data-testid="count-extracted">
                  {extractedCount}
                </span>
              </div>
              <p className="text-xs text-green-700/80 mt-0.5">Extracted</p>
            </div>
            <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-lg font-semibold" data-testid="count-exception">
                  {exceptionCount}
                </span>
              </div>
              <p className="text-xs text-amber-700/80 mt-0.5">Exceptions</p>
            </div>
            <div className="rounded-lg border bg-blue-50 border-blue-200 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-blue-700">
                <Clock className="h-4 w-4" />
                <span className="text-lg font-semibold" data-testid="count-pending">
                  {pendingCount}
                </span>
              </div>
              <p className="text-xs text-blue-700/80 mt-0.5">In progress</p>
            </div>
          </div>
        )}

        {removedCount > 0 && (
          <div className="flex items-center justify-end gap-2">
            <Switch
              id="source-show-removed"
              checked={showRemoved}
              onCheckedChange={setShowRemoved}
              data-testid="switch-source-show-removed"
            />
            <Label htmlFor="source-show-removed" className="text-sm text-muted-foreground">
              Show removed ({removedCount})
            </Label>
          </div>
        )}

        {displayInvoices.length > 0 && (
          <div className="space-y-2" data-testid="source-invoice-list">
            {displayInvoices.map((inv) => {
              const range = pageRangeLabel(inv);
              const extracting =
                inv.extractionStatus === "PENDING" ||
                inv.extractionStatus === "PROCESSING" ||
                !inv.extractionStatus;
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => setLocation(`/invoices/${inv.id}`)}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                  data-testid={`source-invoice-${inv.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {inv.invoiceSequence ?? "—"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{invoiceLabel(inv)}</p>
                      {range && <p className="text-xs text-muted-foreground">{range}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {extracting ? (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Loader2 className="h-3 w-3 animate-spin" /> Extracting
                      </Badge>
                    ) : (
                      <StatusBadge status={inv.status} />
                    )}
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!detecting && invoiceCount === 0 && !detectionFailed && (
          <div
            className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm text-muted-foreground"
            data-testid="source-empty"
          >
            <ScanLine className="h-5 w-5" />
            <span>No invoices were detected in this file.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
