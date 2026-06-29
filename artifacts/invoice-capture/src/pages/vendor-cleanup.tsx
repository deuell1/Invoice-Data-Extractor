import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePreviewVendorCleanup,
  useCommitVendorCleanup,
  getListVendorCleanupsQueryKey,
  useListVendorCleanups,
  type VendorCleanupPreview,
  type VendorCleanupResult,
  type VendorCleanupItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage, cn } from "@/lib/utils";
import {
  Loader2, Trash2, Eye, ShieldAlert, ShieldCheck, AlertTriangle,
  CheckCircle2, Inbox, History, RotateCcw,
} from "lucide-react";
import { format } from "date-fns";

type CleanupMode = "DELETE_SAFE" | "DELETE_AND_DEACTIVATE" | "FULL_RESET";
type PageMode = "PREVIEW" | CleanupMode;

const MODES: { value: PageMode; label: string; description: string; destructive: boolean }[] = [
  {
    value: "PREVIEW",
    label: "Mode A — Preview only",
    description: "No data changes. Shows the full cleanup plan.",
    destructive: false,
  },
  {
    value: "DELETE_SAFE",
    label: "Mode B — Delete safe imported vendors only",
    description: "Deletes imported vendors with no references. Referenced vendors are left unchanged.",
    destructive: true,
  },
  {
    value: "DELETE_AND_DEACTIVATE",
    label: "Mode C — Delete safe + deactivate referenced",
    description: "Deletes unreferenced imported vendors and deactivates referenced imported vendors.",
    destructive: true,
  },
  {
    value: "FULL_RESET",
    label: "Mode D — Full vendor test reset",
    description: "Deletes all imported vendors. Blocked if any imported vendor is referenced.",
    destructive: true,
  },
];

const HISTORY_PAGE_SIZE = 10;

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    DELETE: "text-destructive border-destructive/40 bg-destructive/5",
    DELETED: "text-destructive border-destructive/40 bg-destructive/5",
    DEACTIVATE: "text-amber-700 border-amber-300 bg-amber-50",
    DEACTIVATED: "text-amber-700 border-amber-300 bg-amber-50",
    KEEP: "text-slate-700 border-slate-300 bg-slate-50",
    SKIPPED: "text-slate-700 border-slate-300 bg-slate-50",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", map[action] ?? "")}>
      {action}
    </Badge>
  );
}

function BatchStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "text-blue-700 border-blue-300 bg-blue-50",
    FULLY_CLEANED: "text-emerald-700 border-emerald-300 bg-emerald-50",
    PARTIALLY_CLEANED: "text-amber-700 border-amber-300 bg-amber-50",
    RETAINED: "text-slate-700 border-slate-300 bg-slate-50",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", map[status] ?? "")}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function VendorCleanupPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<PageMode>("PREVIEW");
  const [actor, setActor] = useState("");
  const [reason, setReason] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [preview, setPreview] = useState<VendorCleanupPreview | null>(null);
  const [result, setResult] = useState<VendorCleanupResult | null>(null);

  const [historyPage, setHistoryPage] = useState(1);

  const previewMutation = usePreviewVendorCleanup();
  const commitMutation = useCommitVendorCleanup();

  const historyParams = { page: historyPage, limit: HISTORY_PAGE_SIZE };
  const { data: history, isLoading: historyLoading } = useListVendorCleanups(historyParams, {
    query: { queryKey: getListVendorCleanupsQueryKey(historyParams) },
  });
  const totalHistoryPages = Math.max(1, Math.ceil((history?.total ?? 0) / HISTORY_PAGE_SIZE));

  const selectedMode = MODES.find((m) => m.value === mode);
  const isCommitMode = mode !== "PREVIEW";

  const handlePreview = async () => {
    setResult(null);
    try {
      const res = await previewMutation.mutateAsync({ data: {} });
      setPreview(res);
      toast({
        title: "Preview ready",
        description: `${res.totalImported} imported vendor(s): ${res.safeToDelete} safe to delete, ${res.referencedRetained} referenced.`,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Preview failed", description: getApiErrorMessage(e) || "Could not compute cleanup plan." });
    }
  };

  const confirmSatisfied = confirmChecked && confirmText.trim().toUpperCase() === "CONFIRM";
  const fullResetBlocked = mode === "FULL_RESET" && preview != null && !preview.fullResetAllowed;
  const canCommit =
    isCommitMode &&
    preview != null &&
    actor.trim().length > 0 &&
    reason.trim().length > 0 &&
    confirmSatisfied &&
    !fullResetBlocked;

  const handleCommit = async () => {
    if (!canCommit) return;
    try {
      const res = await commitMutation.mutateAsync({
        data: { mode, actor: actor.trim(), reason: reason.trim(), confirm: true },
      });
      setResult(res);
      toast({
        title: "Cleanup committed",
        description: `${res.vendorsDeleted} deleted, ${res.vendorsDeactivated} deactivated, ${res.vendorsSkipped} skipped.`,
      });
      // Reset confirmation + refresh preview and dependent data.
      setConfirmChecked(false);
      setConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/vendors/cleanup/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      const refreshed = await previewMutation.mutateAsync({ data: {} });
      setPreview(refreshed);
    } catch (e) {
      toast({ variant: "destructive", title: "Commit failed", description: getApiErrorMessage(e) || "Could not commit the cleanup." });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <RotateCcw className="h-6 w-6" />
          Vendor Cleanup
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Safely clear vendors that were loaded through imports. Preview first, then commit with an
          identified actor, reason, and explicit confirmation.
        </p>
      </div>

      {/* Safety banner */}
      <div
        className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
        data-testid="banner-safety"
      >
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Admin-only. Vendors referenced by invoices or purchase orders are <strong>never deleted</strong> —
          they can only be deactivated. Invoices and source documents are never touched, and every action is
          written to the audit log.
        </span>
      </div>

      {/* Configure */}
      <Card>
        <CardHeader>
          <CardTitle>Cleanup Plan</CardTitle>
          <CardDescription>Choose a cleanup mode, then preview the plan before committing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Cleanup Mode</Label>
            <div className="grid gap-2 md:grid-cols-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => {
                    setMode(m.value);
                    setConfirmChecked(false);
                    setConfirmText("");
                    setResult(null);
                  }}
                  className={cn(
                    "text-left rounded-md border p-3 transition-colors",
                    mode === m.value
                      ? "border-primary ring-1 ring-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                  data-testid={`mode-${m.value}`}
                >
                  <div className="flex items-center gap-2 font-medium text-sm">
                    {m.destructive ? (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                    {m.label}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{m.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Button onClick={handlePreview} disabled={previewMutation.isPending} data-testid="button-preview">
              {previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
              Preview cleanup plan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview result */}
      {preview && (
        <Card data-testid="card-preview">
          <CardHeader>
            <CardTitle>Cleanup Preview</CardTitle>
            <CardDescription>
              {preview.totalImported} imported vendor(s) reviewed. No data has been changed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Imported</div>
                <div className="text-xl font-semibold" data-testid="stat-total-imported">{preview.totalImported}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Safe to delete</div>
                <div className="text-xl font-semibold text-destructive" data-testid="stat-safe-delete">{preview.safeToDelete}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Referenced (retain)</div>
                <div className="text-xl font-semibold text-slate-600" data-testid="stat-referenced">{preview.referencedRetained}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Will deactivate</div>
                <div className="text-xl font-semibold text-amber-600" data-testid="stat-deactivate">{preview.toDeactivate}</div>
              </div>
            </div>

            {mode === "FULL_RESET" && !preview.fullResetAllowed && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="banner-fullreset-blocked">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{preview.fullResetBlockReason}</span>
              </div>
            )}

            <PreviewTable items={preview.items} />

            {preview.batchStatuses.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Import Batch Cleanup Status</h3>
                <div className="rounded-md border overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Batch ID</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead className="text-right">Vendors remaining</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.batchStatuses.map((b) => (
                        <TableRow key={b.batchId} data-testid={`row-batch-${b.batchId}`}>
                          <TableCell className="font-mono text-xs">{b.batchId}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{b.fileName}</TableCell>
                          <TableCell className="text-right">{b.importedVendorsRemaining}</TableCell>
                          <TableCell><BatchStatusBadge status={b.cleanupStatus} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Commit controls (only for destructive modes) */}
      {preview && isCommitMode && (
        <Card data-testid="card-commit" className={cn(selectedMode?.destructive && "border-destructive/30")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Confirm &amp; Commit
            </CardTitle>
            <CardDescription>{selectedMode?.label} — requires actor, reason, and explicit confirmation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cleanup-actor">
                  Actor / user name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cleanup-actor"
                  placeholder="e.g. ap.admin"
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                  data-testid="input-actor"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cleanup-reason">
                  Cleanup reason <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cleanup-reason"
                  placeholder="e.g. Clear pilot/test vendor data"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  data-testid="input-reason"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={confirmChecked}
                  onCheckedChange={(v) => setConfirmChecked(v === true)}
                  data-testid="checkbox-confirm"
                />
                I understand referenced vendors will not be deleted and this action is audited.
              </label>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-text">
                  Type <span className="font-mono font-semibold">CONFIRM</span> to enable commit
                </Label>
                <Input
                  id="confirm-text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="CONFIRM"
                  className="max-w-xs"
                  data-testid="input-confirm-text"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="destructive"
                onClick={handleCommit}
                disabled={!canCommit || commitMutation.isPending}
                data-testid="button-commit"
              >
                {commitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Commit cleanup
              </Button>
              {fullResetBlocked && (
                <span className="text-sm text-destructive">Full reset is blocked — resolve referenced vendors first.</span>
              )}
              {!fullResetBlocked && !canCommit && (
                <span className="text-sm text-muted-foreground">Enter actor, reason, tick the box, and type CONFIRM.</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commit result */}
      {result && (
        <Card className="border-emerald-200" data-testid="card-result">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              Cleanup Committed
            </CardTitle>
            <CardDescription>
              {result.cleanupId} · {result.mode} · by {result.actor}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              <div><span className="text-muted-foreground">Reviewed: </span>{result.vendorsReviewed}</div>
              <div><span className="text-muted-foreground">Deleted: </span>{result.vendorsDeleted}</div>
              <div><span className="text-muted-foreground">Deactivated: </span>{result.vendorsDeactivated}</div>
              <div><span className="text-muted-foreground">Skipped: </span>{result.vendorsSkipped}</div>
            </div>
            {result.details.length > 0 && (
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Old → New</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.details.map((d) => (
                      <TableRow key={`${d.vendorId}-${d.action}`}>
                        <TableCell>
                          <div className="font-medium">{d.vendorName}</div>
                          <div className="font-mono text-xs text-muted-foreground">{d.vendorCode}</div>
                        </TableCell>
                        <TableCell className="text-xs">{d.oldStatus} → {d.newStatus}</TableCell>
                        <TableCell><ActionBadge action={d.action} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[280px]">{d.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Cleanup History
          </CardTitle>
          <CardDescription>Every committed cleanup run is recorded here.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cleanup ID</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Reviewed</TableHead>
                <TableHead className="text-right">Deleted</TableHead>
                <TableHead className="text-right">Deactivated</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : history?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <Inbox className="h-8 w-8" />
                      <p>No cleanups yet.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                history?.data?.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-cleanup-${entry.id}`}>
                    <TableCell className="font-mono text-xs">{entry.cleanupId}</TableCell>
                    <TableCell className="text-xs">{entry.mode}</TableCell>
                    <TableCell>{entry.actor}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{entry.reason}</TableCell>
                    <TableCell className="text-right">{entry.vendorsReviewed}</TableCell>
                    <TableCell className="text-right text-destructive">{entry.vendorsDeleted}</TableCell>
                    <TableCell className="text-right text-amber-600">{entry.vendorsDeactivated}</TableCell>
                    <TableCell className="text-right text-slate-600">{entry.vendorsSkipped}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {(history?.total ?? 0) > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>{history?.total ?? 0} cleanup{history?.total !== 1 ? "s" : ""}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={historyPage <= 1} data-testid="button-history-prev">
                  Previous
                </Button>
                <span>Page {historyPage} of {totalHistoryPages}</span>
                <Button variant="outline" size="sm" onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))} disabled={historyPage >= totalHistoryPages} data-testid="button-history-next">
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

function PreviewTable({ items }: { items: VendorCleanupItem[] }) {
  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vendor</TableHead>
            <TableHead>Import Batch</TableHead>
            <TableHead>Last Imported</TableHead>
            <TableHead>Active</TableHead>
            <TableHead>On Hold</TableHead>
            <TableHead className="text-right">Invoice refs</TableHead>
            <TableHead className="text-right">PO refs</TableHead>
            <TableHead>Recommended</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                <div className="flex flex-col items-center justify-center space-y-3">
                  <Inbox className="h-8 w-8" />
                  <p>No imported vendors found. Nothing to clean up.</p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.vendorId} data-testid={`row-vendor-${item.vendorId}`}>
                <TableCell>
                  <div className="font-medium">{item.vendorName}</div>
                  <div className="font-mono text-xs text-muted-foreground">{item.vendorCode}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{item.importBatchId ?? "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {item.lastImportedAt ? format(new Date(item.lastImportedAt), "MMM d, yyyy") : "—"}
                </TableCell>
                <TableCell>{item.isActive ? "Yes" : "No"}</TableCell>
                <TableCell>{item.onHold ? "Yes" : "No"}</TableCell>
                <TableCell className="text-right">{item.invoiceRefCount}</TableCell>
                <TableCell className="text-right">{item.poRefCount}</TableCell>
                <TableCell><ActionBadge action={item.recommendedAction} /></TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
