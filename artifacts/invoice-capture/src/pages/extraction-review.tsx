import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { format } from "date-fns";
import {
  useGetInvoice,
  getGetInvoiceQueryKey,
  useUpdateInvoice,
  useListVendors,
  useGetInvoiceAuditLog,
  useSubmitInvoice,
  useUpdateInvoiceStatus,
  useCheckDuplicate,
  useMatchInvoiceVendor,
  useExtractInvoice,
  getGetInvoiceAuditLogQueryKey,
} from "@workspace/api-client-react";
import type { DuplicateCheckResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle, CheckCircle2, AlertTriangle, RefreshCw, Clock, FileText, Info, ExternalLink, Download, FileWarning } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const FIELD_LABELS: Record<string, string> = {
  vendorId: "Vendor",
  vendorRawName: "Vendor Name",
  invoiceNumber: "Invoice Number",
  invoiceDate: "Invoice Date",
  dueDate: "Due Date",
  paymentTerms: "Payment Terms",
  poNumber: "PO Number",
  subtotal: "Subtotal",
  taxAmount: "Tax Amount",
  freightAmount: "Freight Amount",
  totalAmount: "Total Amount",
  currency: "Currency",
};

const FIELD_CONFIDENCE_THRESHOLD = 85;

const VALIDATION_CHECKS: { key: "vendorCheck" | "duplicateCheck" | "poCheck" | "amountCheck" | "totalTieOut"; label: string }[] = [
  { key: "vendorCheck", label: "Vendor" },
  { key: "duplicateCheck", label: "Duplicate" },
  { key: "amountCheck", label: "Amount" },
  { key: "totalTieOut", label: "Tie-out" },
  { key: "poCheck", label: "PO" },
];

const CHECK_RESULT_CLASS: Record<string, string> = {
  PASS: "border-emerald-500 text-emerald-600",
  WARNING: "border-amber-500 text-amber-600",
  FAIL: "border-destructive text-destructive",
  SKIPPED: "text-muted-foreground",
};

/**
 * Build the secure, same-origin proxy URL for a stored invoice file. Each path
 * segment is encoded so spaces and special characters (#, $, %, …) don't break
 * the URL, and the original filename is passed as ?name= so the server can serve
 * the correct Content-Type (stored objects are extension-less UUIDs).
 */
function buildStorageUrl(fileObjectPath: string, name?: string, download = false): string {
  const rel = fileObjectPath.replace(/^\/objects/, "");
  const encoded = rel
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (download) params.set("download", "1");
  const qs = params.toString();
  return `/api/storage/objects${encoded}${qs ? `?${qs}` : ""}`;
}

export function ExtractionReview() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: invoice, isLoading, error } = useGetInvoice(id, {
    query: {
      enabled: !!id,
      queryKey: getGetInvoiceQueryKey(id),
      // Keep polling while extraction is still running.
      refetchInterval: (query) =>
        query.state.data?.extractionStatus === "PROCESSING" ? 1500 : false,
    },
  });

  const { data: vendorsData } = useListVendors({ limit: 100 });
  const { data: auditLogs } = useGetInvoiceAuditLog(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceAuditLogQueryKey(id) },
  });

  const updateInvoice = useUpdateInvoice();
  const submitInvoice = useSubmitInvoice();
  const updateStatus = useUpdateInvoiceStatus();
  const checkDuplicate = useCheckDuplicate();
  const matchVendor = useMatchInvoiceVendor();
  const extractInvoice = useExtractInvoice();

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [duplicateResult, setDuplicateResult] = useState<DuplicateCheckResult | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [confirmRerunOpen, setConfirmRerunOpen] = useState(false);
  const initialized = useRef(false);
  const duplicateChecked = useRef(false);

  // Reset the preview error state whenever we navigate to a different invoice.
  useEffect(() => {
    setPreviewError(false);
  }, [id]);

  const hasManualEdits = useMemo(
    () => (auditLogs ?? []).some((log) => log.action === "FIELD_UPDATED"),
    [auditLogs],
  );

  const fieldConfidence = useMemo<Record<string, number>>(() => {
    if (!invoice?.fieldConfidence) return {};
    try {
      const parsed = JSON.parse(invoice.fieldConfidence);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
    } catch {
      return {};
    }
  }, [invoice?.fieldConfidence]);

  const lowConfidenceList = useMemo<string[]>(
    () =>
      (invoice?.lowConfidenceFields ?? "")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
    [invoice?.lowConfidenceFields],
  );

  useEffect(() => {
    if (invoice && !initialized.current) {
      setFormData({
        vendorId: invoice.vendorId?.toString() || "",
        invoiceNumber: invoice.invoiceNumber || "",
        invoiceDate: invoice.invoiceDate || "",
        dueDate: invoice.dueDate || "",
        totalAmount: invoice.totalAmount?.toString() || "",
        taxAmount: invoice.taxAmount?.toString() || "",
        poNumber: invoice.poNumber || "",
        currency: invoice.currency || "USD",
        vendorRawName: invoice.vendorRawName || "",
      });
      initialized.current = true;
    }
    if (invoice && !duplicateChecked.current) {
      duplicateChecked.current = true;
      checkDuplicate.mutateAsync({ id }).then((result) => {
        setDuplicateResult(result);
      }).catch(() => {});
    }
  }, [invoice]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const getApiErrorMessage = (e: unknown): string => {
    if (e && typeof e === "object" && "status" in e) {
      const err = e as { status: number; data?: { error?: string }; message?: string };
      if (err.status === 409) {
        return err.data?.error || "Duplicate invoice detected — this invoice number already exists for this vendor.";
      }
      if (err.data?.error) return err.data.error;
    }
    return "";
  };

  const handleSaveField = async (field: string, value: string) => {
    try {
      const payload: Record<string, unknown> = { editorRole: "AP_PROCESSOR" };

      if (field === "totalAmount" || field === "taxAmount") {
        payload[field] = value ? parseFloat(value) : null;
      } else if (field === "vendorId") {
        payload[field] = value ? parseInt(value, 10) : null;
      } else {
        payload[field] = value || null;
      }

      await updateInvoice.mutateAsync({ id, data: payload });
      toast({ title: "Saved", description: `${field} updated` });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceAuditLogQueryKey(id) });
    } catch (e) {
      const msg = getApiErrorMessage(e);
      toast({ variant: "destructive", title: "Save Failed", description: msg || "Failed to save field — please try again." });
    }
  };

  const handleSubmit = async () => {
    if (!formData.vendorId) {
      toast({ variant: "destructive", title: "Vendor Required", description: "Please select a vendor before submitting this invoice for approval." });
      return;
    }
    try {
      await submitInvoice.mutateAsync({ id });
      toast({ title: "Submitted", description: "Invoice routed for approval" });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      setLocation("/invoices");
    } catch (e) {
      const msg = getApiErrorMessage(e);
      if (msg.toLowerCase().includes("duplicate")) {
        toast({ variant: "destructive", title: "Duplicate Invoice", description: msg });
      } else if (msg.toLowerCase().includes("vendor")) {
        toast({ variant: "destructive", title: "Vendor Required", description: msg });
      } else {
        toast({ variant: "destructive", title: "Submit Failed", description: msg || "Could not submit invoice — please check all required fields." });
      }
    }
  };

  const handleRetryExtraction = async () => {
    try {
      await extractInvoice.mutateAsync({ id });
      toast({ title: "Extraction restarted", description: "Re-running data extraction…" });
      initialized.current = false;
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceAuditLogQueryKey(id) });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not restart extraction." });
    }
  };

  // Re-run extraction. If the user has manually edited any field, warn before
  // overwriting their work; otherwise re-run immediately. The audit history is
  // always preserved server-side.
  const handleRerunExtraction = () => {
    if (hasManualEdits) {
      setConfirmRerunOpen(true);
    } else {
      handleRetryExtraction();
    }
  };

  const confirmRerunExtraction = () => {
    setConfirmRerunOpen(false);
    handleRetryExtraction();
  };

  const handleRerunVendorMatch = async () => {
    try {
      await matchVendor.mutateAsync({ id });
      toast({ title: "Vendor Match Complete", description: "Vendor matching has been re-run." });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceAuditLogQueryKey(id) });
    } catch {
      toast({ variant: "destructive", title: "Match Failed", description: "Could not re-run vendor matching." });
    }
  };

  const handleFlagException = async () => {
    try {
      await updateStatus.mutateAsync({
        id,
        data: { status: "EXCEPTION", reason: "Manually flagged as exception" },
      });
      toast({ title: "Flagged", description: "Invoice routed to exception queue" });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      setLocation("/exceptions");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Action failed" });
    }
  };

  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (error || !invoice) return <div className="p-8 text-center text-destructive">Failed to load invoice</div>;

  const confidenceFor = (field: string): number | null => {
    const v = fieldConfidence[field];
    return typeof v === "number" ? v : null;
  };

  const isLowConfidence = (field: string) => {
    const c = confidenceFor(field);
    if (c != null) return c < FIELD_CONFIDENCE_THRESHOLD;
    return lowConfidenceList.includes(field);
  };

  // Visual emphasis applied to the field control itself when confidence is low,
  // so reviewers can spot fields needing attention at a glance.
  const lowConfidenceClass = (field: string) =>
    isLowConfidence(field)
      ? "border-amber-400 bg-amber-50/60 focus-visible:ring-amber-400 dark:border-amber-500/60 dark:bg-amber-500/10"
      : "";

  // Per-field confidence indicator shown beside each label. Renders the % when a
  // per-field score exists, otherwise a plain low-confidence flag.
  const renderConfidence = (field: string) => {
    const c = confidenceFor(field);
    if (c == null) {
      return isLowConfidence(field) ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400" data-testid={`confidence-${field}`}>
          <AlertCircle className="h-3 w-3" /> Low
        </span>
      ) : null;
    }
    const low = c < FIELD_CONFIDENCE_THRESHOLD;
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-medium ${low ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
        data-testid={`confidence-${field}`}
      >
        {low && <AlertCircle className="h-3 w-3" />}
        {Math.round(c)}%
      </span>
    );
  };

  const formatTimestamp = (value?: string | null) =>
    value ? format(new Date(value), "MMM d, yyyy HH:mm") : null;

  return (
    <div className="flex flex-col h-full space-y-4">
      {invoice.extractionStatus === "PROCESSING" && (
        <div
          className="flex items-center gap-3 rounded-md border border-primary/40 bg-primary/5 px-4 py-3 text-sm text-primary"
          data-testid="extraction-banner-processing"
        >
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <p className="font-medium">Extracting invoice data… fields will populate automatically.</p>
        </div>
      )}

      {invoice.extractionStatus === "FAILED" && (
        <div
          className="flex items-start justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="extraction-banner-failed"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Extraction failed</p>
              <p className="text-xs mt-0.5 opacity-80">
                {invoice.extractionError || "The document could not be processed."} You can retry, or enter the fields manually below.
              </p>
              {(invoice.extractionAttempts ?? 0) > 1 && (
                <p className="text-xs mt-1 opacity-60" data-testid="text-extraction-attempts">
                  {invoice.extractionAttempts} extraction attempts so far.
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleRetryExtraction}
            disabled={extractInvoice.isPending}
            data-testid="button-retry-extraction"
          >
            {extractInvoice.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Retry Extraction
          </Button>
        </div>
      )}

      {duplicateResult?.isDuplicate && (
        <div
          className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${
            duplicateResult.matchType === "exact"
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          }`}
          data-testid="duplicate-warning-banner"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              {duplicateResult.matchType === "exact"
                ? "Exact duplicate detected"
                : "Possible duplicate detected"}
            </p>
            <p className="text-xs mt-0.5 opacity-80">
              {duplicateResult.matchType === "exact"
                ? "This invoice number already exists for this vendor in an approved or posted invoice."
                : "An invoice with a similar amount and date exists for this vendor."}
              {" "}Matched invoice{duplicateResult.matchedIds.length > 1 ? "s" : ""}{" "}
              #{duplicateResult.matchedIds.join(", #")}.
              {" "}Risk score: {Math.round(duplicateResult.riskScore * 100)}%.
            </p>
          </div>
        </div>
      )}

      {invoice.extractionStatus === "COMPLETED" && (lowConfidenceList.length > 0 || invoice.extractionNotes) && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"
          data-testid="validation-summary"
        >
          {lowConfidenceList.length > 0 && (
            <div className="flex items-start gap-3 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">
                  {lowConfidenceList.length} field{lowConfidenceList.length > 1 ? "s" : ""} need review (confidence below {FIELD_CONFIDENCE_THRESHOLD}%)
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {lowConfidenceList.map((f) => {
                    const c = fieldConfidence[f];
                    return (
                      <Badge key={f} variant="secondary" className="text-[10px]" data-testid={`low-confidence-${f}`}>
                        {FIELD_LABELS[f] ?? f}
                        {typeof c === "number" ? ` · ${Math.round(c)}%` : ""}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {invoice.extractionNotes && (
            <div
              className={`flex items-start gap-3 text-muted-foreground ${lowConfidenceList.length > 0 ? "mt-3 pt-3 border-t border-amber-500/20" : ""}`}
              data-testid="extraction-notes"
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">Extraction notes</p>
                <p className="text-xs mt-0.5">{invoice.extractionNotes}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {invoice.validationStatus && (
        <div
          className="rounded-md border bg-muted/30 px-4 py-3 text-sm"
          data-testid="validation-checks-summary"
        >
          <div className="flex items-center gap-2 mb-2">
            <p className="font-medium">Validation checks</p>
            <Badge
              variant={
                invoice.validationStatus === "FAILED"
                  ? "destructive"
                  : invoice.validationStatus === "NEEDS_REVIEW"
                    ? "outline"
                    : "secondary"
              }
              className={
                invoice.validationStatus === "NEEDS_REVIEW"
                  ? "border-amber-500 text-amber-600"
                  : invoice.validationStatus === "PASS"
                    ? "border-emerald-500 text-emerald-600"
                    : ""
              }
              data-testid="badge-validation-status"
            >
              {invoice.validationStatus === "FAILED"
                ? "Exception"
                : invoice.validationStatus === "NEEDS_REVIEW"
                  ? "Needs Review"
                  : "Passed"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {VALIDATION_CHECKS.map(({ key, label }) => {
              const result = invoice[key] as string | null | undefined;
              if (!result) return null;
              return (
                <Badge
                  key={key}
                  variant="outline"
                  className={`text-[10px] gap-1 ${CHECK_RESULT_CLASS[result] ?? ""}`}
                  data-testid={`check-${key}`}
                >
                  {label}: {result}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Invoice</h1>
          <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
            {invoice.originalFileName} <StatusBadge status={invoice.status} />
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setLocation("/invoices")} data-testid="button-back">
            Back
          </Button>
          <Button
            variant="destructive"
            onClick={handleFlagException}
            disabled={updateStatus.isPending}
            data-testid="button-flag-exception"
          >
            {updateStatus.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Flag Exception
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitInvoice.isPending}
            data-testid="button-submit"
          >
            {submitInvoice.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Submit for Approval
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-0">
        {/* Document Viewer */}
        <Card className="flex flex-col h-full overflow-hidden">
          <CardHeader className="py-3 px-4 shrink-0 bg-muted/30 border-b">
            <CardTitle className="text-sm font-medium">Document Viewer</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 relative bg-gray-100 dark:bg-gray-800">
            {invoice.fileObjectPath ? (() => {
              const fileUrl = buildStorageUrl(invoice.fileObjectPath, invoice.originalFileName);
              const downloadUrl = buildStorageUrl(
                invoice.fileObjectPath,
                invoice.originalFileName,
                true,
              );
              const isPdf = invoice.originalFileName.toLowerCase().endsWith(".pdf");
              return (
                <>
                  {previewError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6">
                      <FileWarning className="h-10 w-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Document preview blocked or unavailable.
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button asChild variant="outline" size="sm" data-testid="button-open-document">
                          <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open document in new tab
                          </a>
                        </Button>
                        <Button asChild variant="outline" size="sm" data-testid="button-download-document">
                          <a href={downloadUrl}>
                            <Download className="mr-2 h-4 w-4" />
                            Download original file
                          </a>
                        </Button>
                      </div>
                    </div>
                  ) : isPdf ? (
                    <iframe
                      src={fileUrl}
                      className="absolute inset-0 w-full h-full border-0"
                      title="Invoice PDF"
                      data-testid="viewer-pdf"
                      onError={() => setPreviewError(true)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center overflow-auto p-4">
                      <img
                        src={fileUrl}
                        alt="Invoice"
                        className="max-w-full max-h-full object-contain"
                        data-testid="viewer-img"
                        onError={() => setPreviewError(true)}
                      />
                    </div>
                  )}
                  {!previewError && (
                    <div className="absolute top-2 right-2 flex gap-2">
                      <Button
                        asChild
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs shadow-sm"
                        data-testid="button-open-document"
                      >
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />
                          Open
                        </a>
                      </Button>
                      <Button
                        asChild
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs shadow-sm"
                        data-testid="button-download-document"
                      >
                        <a href={downloadUrl}>
                          <Download className="mr-1 h-3.5 w-3.5" />
                          Download
                        </a>
                      </Button>
                    </div>
                  )}
                </>
              );
            })() : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                No document available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Data Form */}
        <div className="flex flex-col h-full space-y-4">
          <Card className="flex-1 overflow-auto">
            <CardHeader className="py-3 px-4 shrink-0 bg-muted/30 border-b space-y-2">
              <div className="flex justify-between items-center">
                <CardTitle className="text-sm font-medium">Extracted Data</CardTitle>
                <div className="flex items-center gap-2">
                  {invoice.vendorMatchScore != null && (
                    <Badge variant={invoice.vendorMatchScore >= 0.85 ? "outline" : "secondary"} className="text-xs">
                      Vendor {Math.round(Number(invoice.vendorMatchScore) * 100)}%
                    </Badge>
                  )}
                  {invoice.confidenceScore != null && (
                    <Badge
                      variant={invoice.confidenceScore >= 0.85 ? "outline" : "secondary"}
                      data-testid="badge-overall-confidence"
                    >
                      {Math.round(Number(invoice.confidenceScore) * 100)}% Confidence
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium capitalize" data-testid="text-extraction-status">
                    {(invoice.extractionStatus ?? "PENDING").toLowerCase()}
                  </span>
                  {invoice.lastExtractedAt && (
                    <span className="flex items-center gap-1 truncate" data-testid="text-last-extracted">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      {formatTimestamp(invoice.lastExtractedAt)}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={handleRerunExtraction}
                  disabled={extractInvoice.isPending || invoice.extractionStatus === "PROCESSING"}
                  data-testid="button-rerun-extraction"
                >
                  {extractInvoice.isPending || invoice.extractionStatus === "PROCESSING" ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  )}
                  Re-run Extraction
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  Vendor
                  {renderConfidence("vendorId")}
                </Label>
                <Select
                  value={formData.vendorId}
                  onValueChange={(val) => {
                    handleInputChange("vendorId", val);
                    handleSaveField("vendorId", val);
                  }}
                >
                  <SelectTrigger className={`w-full ${lowConfidenceClass("vendorId")}`} data-testid="select-vendor">
                    <SelectValue placeholder="Select Vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendorsData?.data?.map((v) => (
                      <SelectItem key={v.id} value={v.id.toString()}>
                        {v.vendorName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  Vendor Name (as on document)
                  {renderConfidence("vendorRawName")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={formData.vendorRawName}
                    onChange={(e) => handleInputChange("vendorRawName", e.target.value)}
                    onBlur={(e) => handleSaveField("vendorRawName", e.target.value)}
                    placeholder="Raw vendor name from invoice"
                    data-testid="input-vendor-raw-name"
                    className={`flex-1 ${lowConfidenceClass("vendorRawName")}`}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRerunVendorMatch}
                    disabled={matchVendor.isPending || !formData.vendorRawName}
                    title="Re-run vendor matching"
                    data-testid="button-rerun-match"
                  >
                    {matchVendor.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Invoice Number
                    {renderConfidence("invoiceNumber")}
                  </Label>
                  <Input
                    value={formData.invoiceNumber}
                    onChange={(e) => handleInputChange("invoiceNumber", e.target.value)}
                    onBlur={(e) => handleSaveField("invoiceNumber", e.target.value)}
                    data-testid="input-invoice-number"
                    className={lowConfidenceClass("invoiceNumber")}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Invoice Date
                    {renderConfidence("invoiceDate")}
                  </Label>
                  <Input
                    type="date"
                    value={formData.invoiceDate ? formData.invoiceDate.split("T")[0] : ""}
                    onChange={(e) => handleInputChange("invoiceDate", e.target.value)}
                    onBlur={(e) => handleSaveField("invoiceDate", e.target.value)}
                    data-testid="input-invoice-date"
                    className={lowConfidenceClass("invoiceDate")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Due Date
                    {renderConfidence("dueDate")}
                  </Label>
                  <Input
                    type="date"
                    value={formData.dueDate ? formData.dueDate.split("T")[0] : ""}
                    onChange={(e) => handleInputChange("dueDate", e.target.value)}
                    onBlur={(e) => handleSaveField("dueDate", e.target.value)}
                    data-testid="input-due-date"
                    className={lowConfidenceClass("dueDate")}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Document ID</Label>
                  <div className="h-9 px-3 py-2 text-sm rounded-md border bg-muted/50 text-muted-foreground font-mono">
                    {invoice.businessDocumentId || invoice.documentId || "—"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Total Amount
                    {renderConfidence("totalAmount")}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.totalAmount}
                    onChange={(e) => handleInputChange("totalAmount", e.target.value)}
                    onBlur={(e) => handleSaveField("totalAmount", e.target.value)}
                    data-testid="input-total-amount"
                    className={lowConfidenceClass("totalAmount")}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Tax Amount
                    {renderConfidence("taxAmount")}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.taxAmount}
                    onChange={(e) => handleInputChange("taxAmount", e.target.value)}
                    onBlur={(e) => handleSaveField("taxAmount", e.target.value)}
                    data-testid="input-tax-amount"
                    className={lowConfidenceClass("taxAmount")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    PO Number
                    {renderConfidence("poNumber")}
                  </Label>
                  <Input
                    value={formData.poNumber}
                    onChange={(e) => handleInputChange("poNumber", e.target.value)}
                    onBlur={(e) => handleSaveField("poNumber", e.target.value)}
                    data-testid="input-po-number"
                    className={lowConfidenceClass("poNumber")}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Currency
                    {renderConfidence("currency")}
                  </Label>
                  <Select
                    value={formData.currency}
                    onValueChange={(val) => {
                      handleInputChange("currency", val);
                      handleSaveField("currency", val);
                    }}
                  >
                    <SelectTrigger className={lowConfidenceClass("currency")} data-testid="select-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="CAD">CAD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Audit Log Panel */}
          <Card className="shrink-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="audit-log" className="border-b-0">
                <AccordionTrigger className="py-3 px-4 hover:no-underline text-sm font-medium">
                  Audit Trail
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3 max-h-40 overflow-y-auto pr-2">
                    {auditLogs && auditLogs.length > 0 ? (
                      auditLogs.map((log) => (
                        <div key={log.id} className="text-xs flex gap-2 items-start border-l-2 border-muted pl-2 py-1">
                          <span className="text-muted-foreground whitespace-nowrap">
                            {format(new Date(log.createdAt), "MMM d HH:mm")}
                          </span>
                          <div>
                            <span className="font-medium">{log.action}</span>
                            {log.fieldName && (
                              <span className="text-muted-foreground ml-1">
                                on {log.fieldName}: {log.oldValue || "empty"} → {log.newValue || "empty"}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground text-center py-2">No audit logs yet</div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmRerunOpen} onOpenChange={setConfirmRerunOpen}>
        <AlertDialogContent data-testid="dialog-confirm-rerun">
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run extraction?</AlertDialogTitle>
            <AlertDialogDescription>
              This invoice has manual edits. Re-running extraction will overwrite the
              current field values with fresh results from the document. Your manual
              changes will be replaced, but the full edit history is preserved in the
              audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-rerun">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRerunExtraction} data-testid="button-confirm-rerun">
              Re-run &amp; Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
