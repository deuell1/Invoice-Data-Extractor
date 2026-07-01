import { useRef, useState } from "react";
import {
  useValidateImport,
  useCommitImport,
  useListImports,
  getListImportsQueryKey,
  getGetImportTemplateUrl,
  type ImportValidationResult,
  type ImportBatch,
} from "@workspace/api-client-react";
import { ImportValidationInputImportType, ListImportsImportType } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  Loader2, Upload, Download, FileText, CheckCircle2, AlertTriangle,
  ShieldAlert, Inbox, CheckCircle, XCircle,
} from "lucide-react";
import { format } from "date-fns";

type ImportType = (typeof ImportValidationInputImportType)[keyof typeof ImportValidationInputImportType];

const IMPORT_TYPES: { value: ImportType; label: string; description: string; adminOnly?: boolean }[] = [
  {
    value: ImportValidationInputImportType.VENDOR_MASTER,
    label: "Vendor Master",
    description: "Create or update vendor master records.",
    adminOnly: true,
  },
  {
    value: ImportValidationInputImportType.PO_REFERENCE,
    label: "PO Reference",
    description: "Load purchase order reference data.",
  },
  {
    value: ImportValidationInputImportType.INVOICE_CORRECTION,
    label: "Invoice Correction",
    description: "Apply field corrections to existing invoices.",
  },
];

const HISTORY_PAGE_SIZE = 10;

function ImportStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    COMMITTED: "text-emerald-700 border-emerald-300 bg-emerald-50",
    VALIDATED: "text-blue-700 border-blue-300 bg-blue-50",
    PENDING: "text-slate-700 border-slate-300 bg-slate-50",
    CANCELLED: "text-amber-700 border-amber-300 bg-amber-50",
    FAILED: "text-destructive border-destructive/40 bg-destructive/5",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", map[status] ?? "")} data-testid={`badge-import-status-${status}`}>
      {status}
    </Badge>
  );
}

export function ImportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importType, setImportType] = useState<ImportType>(ImportValidationInputImportType.PO_REFERENCE);
  const [fileName, setFileName] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [uploadedBy, setUploadedBy] = useState<string>("");
  const [updateExisting, setUpdateExisting] = useState<boolean>(false);
  const [result, setResult] = useState<ImportValidationResult | null>(null);
  const [committedBatch, setCommittedBatch] = useState<ImportBatch | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [historyFilter, setHistoryFilter] = useState<"ALL" | ImportType>("ALL");
  const [page, setPage] = useState(1);

  const validate = useValidateImport();
  const commit = useCommitImport();

  const historyParams = {
    importType: historyFilter === "ALL" ? undefined : (historyFilter as ListImportsImportType),
    page,
    limit: HISTORY_PAGE_SIZE,
  };
  const { data: history, isLoading: historyLoading } = useListImports(historyParams, {
    query: { queryKey: getListImportsQueryKey(historyParams) },
  });
  const totalPages = Math.max(1, Math.ceil((history?.total ?? 0) / HISTORY_PAGE_SIZE));

  const selectedTypeMeta = IMPORT_TYPES.find((t) => t.value === importType);

  const resetForFile = () => {
    setResult(null);
    setCommittedBatch(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setFileName(file.name);
      setContent(text);
      resetForFile();
    } catch {
      toast({ variant: "destructive", title: "Could not read file", description: "Failed to read the selected CSV file." });
    }
  };

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      // Use raw fetch so we can call .blob() explicitly.
      // customFetch auto-detects text/csv as "text" and returns a string,
      // which is not a valid argument for URL.createObjectURL().
      const response = await fetch(getGetImportTemplateUrl({ importType }));

      if (!response.ok) {
        let msg = "Could not download the import template.";
        try {
          const errBody = await response.json();
          msg = errBody?.error ?? msg;
        } catch {
          // non-JSON error body — keep generic message
        }
        throw new Error(msg);
      }

      // Prefer the backend-provided filename from Content-Disposition.
      const cd = response.headers.get("content-disposition");
      const cdMatch = cd?.match(/filename="([^"]+)"/);
      const fileName =
        cdMatch?.[1] ?? `${importType.toLowerCase().replace(/_/g, "-")}-template.csv`;

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast({ title: "Template downloaded", description: `${selectedTypeMeta?.label} CSV template downloaded.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Download failed", description: e?.message ?? "Could not download the import template." });
    } finally {
      setDownloading(false);
    }
  };

  const handleValidate = async () => {
    if (!fileName || !content) {
      toast({ variant: "destructive", title: "No file selected", description: "Select a CSV file to validate." });
      return;
    }
    setCommittedBatch(null);
    try {
      const res = await validate.mutateAsync({ data: { importType, fileName, content, updateExisting } });
      setResult(res);
      toast({
        title: "Validation complete",
        description: `${res.rowsValid} valid, ${res.rowsRejected} rejected of ${res.rowCount} rows.`,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Validation failed", description: e?.data?.error || "Could not validate the import file." });
    }
  };

  const handleCommit = async () => {
    if (!result || result.hasBlockingErrors) return;
    try {
      const batch = await commit.mutateAsync({
        data: {
          importType,
          fileName,
          content,
          uploadedBy: uploadedBy.trim() || null,
          updateExisting,
        },
      });
      setCommittedBatch(batch);
      toast({
        title: "Import committed",
        description: `${batch.rowsAccepted} rows accepted, ${batch.rowsRejected} rejected.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Commit failed", description: e?.data?.error || "Could not commit the import." });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Upload className="h-6 w-6" />
          Imports
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Validate and commit reference data imports from CSV files.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Import</CardTitle>
          <CardDescription>Pick an import type, upload a CSV, validate, then commit.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="import-type">Import Type</Label>
              <Select
                value={importType}
                onValueChange={(v) => {
                  setImportType(v as ImportType);
                  resetForFile();
                }}
              >
                <SelectTrigger id="import-type" data-testid="select-import-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} data-testid={`option-import-type-${t.value}`}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTypeMeta && (
                <p className="text-xs text-muted-foreground">{selectedTypeMeta.description}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Template</Label>
              <div>
                <Button
                  variant="outline"
                  onClick={handleDownloadTemplate}
                  disabled={downloading}
                  data-testid="button-download-template"
                >
                  {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Download template
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Download a CSV template for the selected import type.</p>
            </div>
          </div>

          {importType === ImportValidationInputImportType.VENDOR_MASTER && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
              data-testid="note-admin-only"
            >
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Vendor master import is admin-only. Ensure you are authorized before committing changes.</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="import-file">CSV File</Label>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                id="import-file"
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-import-file"
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-choose-file">
                <FileText className="mr-2 h-4 w-4" />
                Choose CSV…
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-file-name">
                {fileName || "No file selected"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleValidate}
              disabled={!fileName || !content || validate.isPending}
              data-testid="button-validate"
            >
              {validate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Validate
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card data-testid="card-validation-result">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Validation Result
              {result.hasBlockingErrors ? (
                <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/5" data-testid="badge-has-blocking">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Blocking errors
                </Badge>
              ) : (
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50" data-testid="badge-no-blocking">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Ready to commit
                </Badge>
              )}
            </CardTitle>
            <CardDescription>{result.fileName} · {result.importType}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Rows</div>
                <div className="text-xl font-semibold" data-testid="stat-row-count">{result.rowCount}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Valid</div>
                <div className="text-xl font-semibold text-emerald-600" data-testid="stat-rows-valid">{result.rowsValid}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Rejected</div>
                <div className="text-xl font-semibold text-destructive" data-testid="stat-rows-rejected">{result.rowsRejected}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Columns</div>
                <div className="text-xl font-semibold" data-testid="stat-column-count">{result.columns.length}</div>
              </div>
            </div>

            {result.errorSummary && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="text-error-summary">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{result.errorSummary}</span>
              </div>
            )}

            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead className="w-20">Valid</TableHead>
                    {result.columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                    <TableHead>Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.preview.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={result.columns.length + 3} className="text-center py-8 text-muted-foreground">
                        No preview rows.
                      </TableCell>
                    </TableRow>
                  ) : (
                    result.preview.map((row) => (
                      <TableRow key={row.rowNumber} data-testid={`row-preview-${row.rowNumber}`}>
                        <TableCell className="font-medium">{row.rowNumber}</TableCell>
                        <TableCell>
                          {row.valid ? (
                            <CheckCircle className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                        {result.columns.map((c) => (
                          <TableCell key={c} className="whitespace-nowrap">{row.data[c] ?? ""}</TableCell>
                        ))}
                        <TableCell className="text-xs text-destructive">
                          {row.errors.length > 0 ? row.errors.join("; ") : ""}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="uploaded-by">Uploaded By</Label>
                <Input
                  id="uploaded-by"
                  placeholder="ap.clerk"
                  value={uploadedBy}
                  onChange={(e) => setUploadedBy(e.target.value)}
                  data-testid="input-uploaded-by"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={updateExisting}
                    onCheckedChange={(v) => setUpdateExisting(v === true)}
                    data-testid="checkbox-update-existing"
                  />
                  Update existing rows (otherwise duplicates are skipped)
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleCommit}
                disabled={
                  result.hasBlockingErrors ||
                  commit.isPending ||
                  (importType === ImportValidationInputImportType.VENDOR_MASTER && !uploadedBy.trim())
                }
                data-testid="button-commit"
              >
                {commit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Commit Import
              </Button>
              {result.hasBlockingErrors && (
                <span className="text-sm text-muted-foreground">Resolve blocking errors before committing.</span>
              )}
              {!result.hasBlockingErrors &&
                importType === ImportValidationInputImportType.VENDOR_MASTER &&
                !uploadedBy.trim() && (
                  <span className="text-sm text-muted-foreground" data-testid="text-admin-required">
                    Vendor master import is admin-only — enter an authorized actor in “Uploaded By” to commit.
                  </span>
                )}
            </div>
          </CardContent>
        </Card>
      )}

      {committedBatch && (
        <Card className="border-emerald-200" data-testid="card-committed-batch">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              Import Committed
            </CardTitle>
            <CardDescription>Batch {committedBatch.batchId}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              <div><span className="text-muted-foreground">File: </span>{committedBatch.fileName}</div>
              <div><span className="text-muted-foreground">Rows: </span>{committedBatch.rowCount}</div>
              <div><span className="text-muted-foreground">Accepted: </span>{committedBatch.rowsAccepted}</div>
              <div><span className="text-muted-foreground">Rejected: </span>{committedBatch.rowsRejected}</div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">Status: </span><ImportStatusBadge status={committedBatch.status} /></div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Import History</CardTitle>
            <div className="w-56">
              <Select
                value={historyFilter}
                onValueChange={(v) => {
                  setHistoryFilter(v as "ALL" | ImportType);
                  setPage(1);
                }}
              >
                <SelectTrigger data-testid="select-history-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {IMPORT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Accepted</TableHead>
                <TableHead className="text-right">Rejected</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded</TableHead>
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
                      <p>No imports yet.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                history?.data?.map((batch) => (
                  <TableRow key={batch.id} data-testid={`row-import-${batch.id}`}>
                    <TableCell className="font-mono text-xs">{batch.batchId}</TableCell>
                    <TableCell>{batch.importType}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{batch.fileName}</TableCell>
                    <TableCell className="text-right">{batch.rowCount}</TableCell>
                    <TableCell className="text-right text-emerald-600">{batch.rowsAccepted}</TableCell>
                    <TableCell className="text-right text-destructive">{batch.rowsRejected}</TableCell>
                    <TableCell><ImportStatusBadge status={batch.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {format(new Date(batch.uploadedAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {(history?.total ?? 0) > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>{history?.total ?? 0} import{history?.total !== 1 ? "s" : ""}</span>
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
