import { useState } from "react";
import {
  useCreateExport,
  useListExports,
  useListVendors,
  getListExportsQueryKey,
  getDownloadExportUrl,
  type ExportBatch,
} from "@workspace/api-client-react";
import { useIsManager } from "@/hooks/use-role";
import { ExportRequestExportType, ExportRequestFormat } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/mission-control-ds/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/mission-control-ds/components/ui/table";
import { Button } from "@workspace/mission-control-ds/components/ui/button";
import { Input } from "@workspace/mission-control-ds/components/ui/input";
import { Label } from "@workspace/mission-control-ds/components/ui/label";
import { Badge } from "@workspace/mission-control-ds/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/mission-control-ds/components/ui/select";
import { useToast } from "@workspace/mission-control-ds/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Loader2, Download, FileDown, Inbox, CheckCircle2, Lock } from "lucide-react";
import { format } from "date-fns";

type ExportType = (typeof ExportRequestExportType)[keyof typeof ExportRequestExportType];

const EXPORT_TYPES: { value: ExportType; label: string; description: string }[] = [
  { value: ExportRequestExportType.AP_INVOICE_FILE, label: "AP Invoice File", description: "Export-ready AP invoice file package." },
  { value: ExportRequestExportType.APPROVED, label: "Approved Invoices", description: "All approved invoices." },
  { value: ExportRequestExportType.POSTED, label: "Posted Invoices", description: "All posted invoices." },
  { value: ExportRequestExportType.ALL_ACTIVE, label: "All Active Invoices", description: "All active (non-removed) invoices." },
  { value: ExportRequestExportType.EXCEPTIONS, label: "Exceptions", description: "Invoices currently in exception." },
  { value: ExportRequestExportType.TIE_OUT_FAILURES, label: "Tie-Out Failures", description: "Invoices that failed header tie-out." },
  { value: ExportRequestExportType.VENDOR_SUMMARY, label: "Vendor Summary", description: "Aggregated vendor-level summary." },
  { value: ExportRequestExportType.SOURCE_DOCUMENT_SUMMARY, label: "Source Document Summary", description: "Aggregated source document summary." },
];

const STATUS_FILTER_OPTIONS = ["READY", "EXPORTED", "FAILED", "BLOCKED", "NOT_READY"] as const;
const STATUS_FILTER_LABELS: Record<string, string> = {
  READY: "Export Ready",
  EXPORTED: "Exported",
  FAILED: "Export Failed",
  BLOCKED: "Export Blocked",
  NOT_READY: "Not Ready",
};

const HISTORY_PAGE_SIZE = 10;

function ExportStatusBadge({ status }: { status: string }) {
  const isSuccess = status === "SUCCESS";
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs",
        isSuccess ? "text-emerald-700 border-emerald-300 bg-emerald-50" : "text-destructive border-destructive/40 bg-destructive/5",
      )}
      data-testid={`badge-export-status-${status}`}
    >
      {status}
    </Badge>
  );
}

export function ExportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isManager = useIsManager();

  const [exportType, setExportType] = useState<ExportType>(ExportRequestExportType.APPROVED);
  const [statusFilter, setStatusFilter] = useState<string>("ANY");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [vendorId, setVendorId] = useState<string>("ANY");
  const [exportedBy, setExportedBy] = useState("");
  const [createdBatch, setCreatedBatch] = useState<ExportBatch | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const [page, setPage] = useState(1);

  const createExport = useCreateExport();
  const { data: vendorsData } = useListVendors({ limit: 1000 });

  const historyParams = { page, limit: HISTORY_PAGE_SIZE };
  const { data: history, isLoading: historyLoading } = useListExports(historyParams, {
    query: { queryKey: getListExportsQueryKey(historyParams) },
  });
  const totalPages = Math.max(1, Math.ceil((history?.total ?? 0) / HISTORY_PAGE_SIZE));

  const selectedTypeMeta = EXPORT_TYPES.find((t) => t.value === exportType);

  const handleCreate = async () => {
    try {
      const batch = await createExport.mutateAsync({
        data: {
          exportType,
          format: ExportRequestFormat.CSV,
          status: statusFilter === "ANY" ? null : statusFilter,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          vendorId: vendorId === "ANY" ? null : parseInt(vendorId, 10),
          exportedBy: exportedBy.trim() || null,
        },
      });
      setCreatedBatch(batch);
      toast({
        title: "Export created",
        description: `Batch ${batch.batchId} · ${batch.recordCount} records.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/exports"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Export failed", description: e?.data?.error || "Could not create the export." });
    }
  };

  /**
   * A batch is downloadable when:
   *  - status is SUCCESS (backend always regenerates the CSV on demand — no file storage required)
   *  - record count is >= 0 (zero-row exports are still valid downloads)
   */
  const downloadable = (batch: ExportBatch) => batch.status === "SUCCESS";

  const handleDownload = async (batch: ExportBatch) => {
    if (downloadingId !== null) return;
    setDownloadingId(batch.id);
    try {
      // Use raw fetch so we can call .blob() explicitly.
      // customFetch auto-detects text/csv as "text" and returns a string,
      // which is not a valid argument for URL.createObjectURL().
      const response = await fetch(getDownloadExportUrl(batch.id));

      if (!response.ok) {
        let msg = "Export file could not be downloaded.";
        try {
          const errBody = await response.json();
          msg = errBody?.error ?? msg;
        } catch {
          // response body wasn't JSON — keep generic message
        }
        if (response.status === 404) msg = "Export batch was not found.";
        throw new Error(msg);
      }

      // Extract filename from Content-Disposition header when available.
      const cd = response.headers.get("content-disposition");
      const cdMatch = cd?.match(/filename="([^"]+)"/);
      const fileName = cdMatch?.[1] ?? batch.fileName ?? `${batch.batchId}.csv`;

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      const msg = e?.message ?? "Export file could not be downloaded.";
      toast({ variant: "destructive", title: "Download failed", description: msg });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileDown className="h-6 w-6" />
          Exports
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate CSV export files and download previously generated batches.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Export</CardTitle>
          <CardDescription>Choose an export type and optional filters, then generate the file.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="export-type">Export Type</Label>
              <Select value={exportType} onValueChange={(v) => setExportType(v as ExportType)}>
                <SelectTrigger id="export-type" data-testid="select-export-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPORT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} data-testid={`option-export-type-${t.value}`}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTypeMeta && <p className="text-xs text-muted-foreground">{selectedTypeMeta.description}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="export-format">Format</Label>
              <Select value={ExportRequestFormat.CSV} disabled>
                <SelectTrigger id="export-format" data-testid="select-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ExportRequestFormat.CSV}>CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="export-status">Export Readiness (optional)</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="export-status" data-testid="select-export-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">Any</SelectItem>
                  {STATUS_FILTER_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_FILTER_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="export-vendor">Vendor (optional)</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger id="export-vendor" data-testid="select-export-vendor">
                  <SelectValue placeholder="All vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">All vendors</SelectItem>
                  {vendorsData?.data?.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>{v.vendorName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="date-from">Date From (optional)</Label>
              <Input id="date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="input-date-from" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="date-to">Date To (optional)</Label>
              <Input id="date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="input-date-to" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exported-by">Exported By (optional)</Label>
              <Input id="exported-by" placeholder="ap.clerk" value={exportedBy} onChange={(e) => setExportedBy(e.target.value)} data-testid="input-exported-by" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleCreate}
              disabled={createExport.isPending || !isManager}
              data-testid="button-create-export"
              title={!isManager ? "AP Manager role required to create exports" : undefined}
            >
              {createExport.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : !isManager ? (
                <Lock className="mr-2 h-4 w-4" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Generate Export
            </Button>
            {!isManager && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Lock className="h-3 w-3" />
                AP Manager role required
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {createdBatch && (
        <Card className="border-emerald-200" data-testid="card-created-batch">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              Export Generated
            </CardTitle>
            <CardDescription>Batch {createdBatch.batchId}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm items-center">
              <div><span className="text-muted-foreground">Type: </span>{createdBatch.exportType}</div>
              <div><span className="text-muted-foreground">Records: </span>{createdBatch.recordCount}</div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">Status: </span><ExportStatusBadge status={createdBatch.status} /></div>
              <div>
                {downloadable(createdBatch) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(createdBatch)}
                    disabled={downloadingId === createdBatch.id}
                    data-testid="button-download-created"
                  >
                    {downloadingId === createdBatch.id
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Download className="mr-2 h-4 w-4" />}
                    Download
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Not available for download</span>
                )}
              </div>
            </div>
            {createdBatch.fileName && (
              <p className="mt-2 text-xs text-muted-foreground font-mono">{createdBatch.fileName}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Export History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Exported</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : history?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <Inbox className="h-8 w-8" />
                      <p>No exports yet.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                history?.data?.map((batch) => (
                  <TableRow key={batch.id} data-testid={`row-export-${batch.id}`}>
                    <TableCell className="font-mono text-xs">{batch.batchId}</TableCell>
                    <TableCell>{batch.exportType}</TableCell>
                    <TableCell>{batch.format}</TableCell>
                    <TableCell className="text-right">{batch.recordCount}</TableCell>
                    <TableCell><ExportStatusBadge status={batch.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {format(new Date(batch.exportedAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground font-mono">
                      {batch.fileName || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {downloadable(batch) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(batch)}
                          disabled={downloadingId === batch.id}
                          data-testid={`button-download-${batch.id}`}
                          title={`Download ${batch.fileName ?? batch.batchId}`}
                        >
                          {downloadingId === batch.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Download className="h-4 w-4" />}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground" title={`Status: ${batch.status}`}>—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {(history?.total ?? 0) > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>{history?.total ?? 0} export{history?.total !== 1 ? "s" : ""}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} data-testid="button-history-prev">
                  Previous
                </Button>
                <span>Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} data-testid="button-history-next">
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
