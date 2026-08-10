import { useState } from "react";
import { Link } from "wouter";
import {
  useListSourceDocuments,
  getListSourceDocumentsQueryKey,
  useGetSourceDocumentAudit,
  getGetSourceDocumentAuditQueryKey,
} from "@workspace/api-client-react";
import type {
  ListSourceDocumentsProcessingStatus,
  SourceDocument,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText, Loader2, Search, ChevronLeft, ChevronRight, FileSearch, History, Eye,
} from "lucide-react";
import { format } from "date-fns";
import { AuditActor } from "@/components/audit-actor";

type StatusFilter = "ALL" | ListSourceDocumentsProcessingStatus;

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: "All statuses", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Detecting", value: "DETECTING" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Exception", value: "EXCEPTION" },
];

const PAGE_SIZE = 20;

function ProcessingBadge({ status }: { status: string }) {
  switch (status) {
    case "PENDING":
      return <Badge variant="secondary" data-testid={`processing-${status}`}>Pending</Badge>;
    case "DETECTING":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100" data-testid={`processing-${status}`}>Detecting</Badge>;
    case "COMPLETED":
      return <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600 text-white" data-testid={`processing-${status}`}>Completed</Badge>;
    case "EXCEPTION":
      return <Badge variant="destructive" data-testid={`processing-${status}`}>Exception</Badge>;
    default:
      return <Badge variant="outline" data-testid="processing-unknown">{status}</Badge>;
  }
}

function SourceAuditDialog({
  source,
  open,
  onClose,
}: {
  source: SourceDocument;
  open: boolean;
  onClose: () => void;
}) {
  const { data: logs, isLoading } = useGetSourceDocumentAudit(source.id, {
    query: { queryKey: getGetSourceDocumentAuditQueryKey(source.id) },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Audit Trail
          </DialogTitle>
          <p className="text-sm text-muted-foreground truncate">{source.originalFileName}</p>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </div>
        ) : !logs || logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="audit-empty">
            No audit entries recorded for this document yet.
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1" data-testid="audit-list">
            {logs.map((log) => (
              <div
                key={log.id}
                className="text-xs flex gap-3 items-start border-l-2 border-muted pl-3 py-1.5"
                data-testid={`audit-entry-${log.id}`}
              >
                <span className="text-muted-foreground whitespace-nowrap">
                  {format(new Date(log.createdAt), "MMM d HH:mm")}
                </span>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium">{log.action}</span>
                    <span className="text-muted-foreground">· invoice #{log.invoiceId}</span>
                    <span className="text-muted-foreground">·</span>
                    <AuditActor
                      actorClerkId={log.actorClerkId}
                      actorName={log.actorName}
                      editorRole={log.editorRole}
                    />
                  </div>
                  {log.fieldName && (
                    <div className="text-muted-foreground">
                      {log.fieldName}: {log.oldValue || "empty"} → {log.newValue || "empty"}
                    </div>
                  )}
                  {log.note && <div className="text-muted-foreground italic">{log.note}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SourceDocuments() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [page, setPage] = useState(1);
  const [auditSource, setAuditSource] = useState<SourceDocument | null>(null);

  const queryParams = {
    processingStatus: statusFilter === "ALL" ? undefined : statusFilter,
    includeRemoved: includeRemoved ? true : undefined,
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data: res, isLoading } = useListSourceDocuments(queryParams, {
    query: { queryKey: getListSourceDocumentsQueryKey(queryParams) },
  });

  const totalPages = Math.max(1, Math.ceil((res?.total ?? 0) / PAGE_SIZE));

  const handleStatusChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileSearch className="h-6 w-6" />
            Source Documents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Uploaded files and their detected invoices</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>Documents</CardTitle>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="w-48">
                <Select value={statusFilter} onValueChange={(v) => handleStatusChange(v as StatusFilter)}>
                  <SelectTrigger data-testid="select-processing-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="include-removed"
                  checked={includeRemoved}
                  onCheckedChange={(v) => {
                    setIncludeRemoved(v);
                    setPage(1);
                  }}
                  data-testid="switch-include-removed"
                />
                <Label htmlFor="include-removed" className="text-sm text-muted-foreground whitespace-nowrap">
                  Include removed
                </Label>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by file name…"
                  className="pl-8 h-9"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  data-testid="input-search"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Pages</TableHead>
                <TableHead className="text-center">Detected</TableHead>
                <TableHead className="text-center">Invoices</TableHead>
                <TableHead className="text-center">Extracted</TableHead>
                <TableHead className="text-center">Exceptions</TableHead>
                <TableHead className="text-center">Removed</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : res?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <FileText className="h-10 w-10 text-muted-foreground/40" />
                      <p>No source documents found.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                res?.data?.map((summary) => {
                  const doc = summary.source;
                  const isRemoved = !!doc.removedAt;
                  return (
                    <TableRow key={doc.id} data-testid={`row-source-${doc.id}`}>
                      <TableCell className="font-medium max-w-xs truncate">
                        <span className={isRemoved ? "line-through text-muted-foreground" : ""}>
                          {doc.originalFileName}
                        </span>
                        {isRemoved && (
                          <Badge variant="outline" className="ml-2 text-muted-foreground border-muted-foreground/40 text-xs">
                            Removed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{doc.sourceChannel}</TableCell>
                      <TableCell><ProcessingBadge status={doc.processingStatus} /></TableCell>
                      <TableCell className="text-center">{doc.pageCount ?? "—"}</TableCell>
                      <TableCell className="text-center">{doc.detectedInvoiceCount ?? "—"}</TableCell>
                      <TableCell className="text-center">{summary.invoiceCount}</TableCell>
                      <TableCell className="text-center">{summary.extractedCount}</TableCell>
                      <TableCell className="text-center">
                        {summary.exceptionCount > 0 ? (
                          <span className="text-destructive font-medium">{summary.exceptionCount}</span>
                        ) : (
                          summary.exceptionCount
                        )}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">{summary.removedCount}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAuditSource(doc)}
                            data-testid={`button-audit-${doc.id}`}
                            title="View audit trail"
                          >
                            <History className="h-3.5 w-3.5 mr-1" />
                            Audit
                          </Button>
                          <Link href={`/sources/${doc.id}`}>
                            <Button variant="secondary" size="sm" data-testid={`button-view-${doc.id}`}>
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              View
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
        {(res?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 text-sm text-muted-foreground">
            <span>
              {res?.total ?? 0} document{res?.total !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">Page {page} of {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {auditSource && (
        <SourceAuditDialog
          source={auditSource}
          open={true}
          onClose={() => setAuditSource(null)}
        />
      )}
    </div>
  );
}
