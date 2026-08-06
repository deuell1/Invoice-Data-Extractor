import { useState } from "react";
import { Link } from "wouter";
import {
  useListInvoices,
  useGetInvoiceStats,
  getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { InvoiceCleanupActions } from "@/components/cleanup-actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, AlertCircle, CheckSquare, CheckCircle, FilePlus, Loader2,
  Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
  Send, DollarSign, Inbox, Eye, Percent, Download,
} from "lucide-react";
import { format } from "date-fns";

type StatusFilter = "ALL" | "PENDING_EXTRACTION" | "EXCEPTION" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "VOIDED";
type SortBy = "createdAt" | "invoiceDate" | "totalAmount" | "vendorName";
type SortDir = "asc" | "desc";

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Extracting", value: "PENDING_EXTRACTION" },
  { label: "Exception", value: "EXCEPTION" },
  { label: "Needs Approval", value: "PENDING_APPROVAL" },
  { label: "Approved", value: "APPROVED" },
  { label: "Posted", value: "POSTED" },
  { label: "Removed", value: "VOIDED" },
];

const PAGE_SIZE = 10;

function SortIcon({ col, sortBy, sortDir }: { col: SortBy; sortBy: SortBy; sortDir: SortDir }) {
  if (sortBy !== col) return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
}

export function InvoiceList() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showRemoved, setShowRemoved] = useState(false);
  const [exporting, setExporting] = useState<null | "APPROVED" | "POSTED">(null);
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading } = useGetInvoiceStats();

  const viewingRemoved = statusFilter === "VOIDED";

  const queryParams = {
    status: statusFilter === "ALL" ? undefined : statusFilter,
    search: search || undefined,
    sortBy,
    sortDir,
    page,
    limit: PAGE_SIZE,
    includeRemoved: showRemoved || viewingRemoved ? true : undefined,
  };

  const { data: invoicesRes, isLoading: invoicesLoading } = useListInvoices(queryParams, {
    query: { queryKey: getListInvoicesQueryKey(queryParams) },
  });

  const totalPages = Math.max(1, Math.ceil((invoicesRes?.total ?? 0) / PAGE_SIZE));

  // Export the approved/exportable invoices to CSV. Voided/removed records are
  // excluded by the backend export endpoint. The file is fetched as a blob so we
  // can show loading/error states instead of a bare link.
  const handleExport = async (status: "APPROVED" | "POSTED") => {
    setExporting(status);
    try {
      const res = await fetch(`/api/invoices/export?status=${status}`, {
        headers: { Accept: "text/csv" },
      });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoices-${status.toLowerCase()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Export ready",
        description: `Downloaded ${status.toLowerCase()} invoices as CSV.`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not export invoices to CSV.",
      });
    } finally {
      setExporting(null);
    }
  };

  const handleStatusChange = (status: StatusFilter) => {
    setStatusFilter(status);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
    setPage(1);
  };

  const SortableHead = ({ col, children }: { col: SortBy; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-muted/30 transition-colors"
      onClick={() => handleSort(col)}
      data-testid={`sort-${col}`}
    >
      <span className="flex items-center">
        {children}
        <SortIcon col={col} sortBy={sortBy} sortDir={sortDir} />
      </span>
    </TableHead>
  );

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-center shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <Link href="/invoices/new">
          <Button data-testid="button-new-invoice">
            <FilePlus className="mr-2 h-4 w-4" />
            Upload Invoice
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 shrink-0">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.total || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Extraction</CardTitle>
            <Inbox className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground" data-testid="stat-pending-extraction">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.pendingExtraction || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Exceptions</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive" data-testid="stat-exceptions">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.exception || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
            <CheckSquare className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500" data-testid="stat-pending">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.pendingApproval || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
            <Eye className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500" data-testid="stat-needs-review">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.needsReview || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500" data-testid="stat-approved">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.approved || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Posted</CardTitle>
            <Send className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500" data-testid="stat-posted">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.posted || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved Value</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-approved-amount">
              {statsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  notation: (stats?.totalApprovedAmount ?? 0) >= 100000 ? "compact" : "standard",
                  maximumFractionDigits: (stats?.totalApprovedAmount ?? 0) >= 100000 ? 1 : 0,
                }).format(stats?.totalApprovedAmount ?? 0)
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Exception Rate</CardTitle>
            <Percent className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500" data-testid="stat-exception-rate">
              {statsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `${(stats?.total ? ((stats.exception / stats.total) * 100) : 0).toFixed(1)}%`
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="shrink-0 pb-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Invoices</CardTitle>
              <div className="flex items-center gap-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exporting !== null}
                      data-testid="button-export-csv"
                    >
                      {exporting !== null ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      {exporting !== null ? "Exporting…" : "Export CSV"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleExport("APPROVED")}
                      data-testid="menu-export-approved"
                    >
                      Approved invoices
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExport("POSTED")}
                      data-testid="menu-export-posted"
                    >
                      Posted invoices
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex items-center gap-2">
                  <Switch
                    id="show-removed"
                    checked={showRemoved}
                    onCheckedChange={(v) => {
                      setShowRemoved(v);
                      setPage(1);
                    }}
                    disabled={viewingRemoved}
                    data-testid="switch-show-removed"
                  />
                  <Label htmlFor="show-removed" className="text-sm text-muted-foreground whitespace-nowrap">
                    Show removed
                  </Label>
                </div>
                <div className="relative w-64">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search invoice # or vendor…"
                    className="pl-8 h-9"
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    data-testid="input-search"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-1 border-b pb-0 overflow-x-auto">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => handleStatusChange(tab.value)}
                  data-testid={`tab-status-${tab.value}`}
                  className={[
                    "px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                    statusFilter === tab.value
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <SortableHead col="vendorName">Vendor</SortableHead>
                <SortableHead col="invoiceDate">Date</SortableHead>
                <SortableHead col="totalAmount">Amount</SortableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoicesLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : invoicesRes?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No invoices found.
                  </TableCell>
                </TableRow>
              ) : (
                invoicesRes?.data?.map((invoice) => (
                  <TableRow key={invoice.id} data-testid={`row-invoice-${invoice.id}`}>
                    <TableCell className="font-medium">{invoice.invoiceNumber || "—"}</TableCell>
                    <TableCell>{invoice.vendorName || "Unknown Vendor"}</TableCell>
                    <TableCell>{invoice.invoiceDate ? format(new Date(invoice.invoiceDate), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell>
                      {invoice.totalAmount != null
                        ? new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency || "USD" }).format(invoice.totalAmount)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={invoice.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/invoices/${invoice.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-review-${invoice.id}`}>
                            Review
                          </Button>
                        </Link>
                        <InvoiceCleanupActions
                          invoiceId={invoice.id}
                          status={invoice.status}
                          variant="compact"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        {(invoicesRes?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 text-sm text-muted-foreground">
            <span>
              {invoicesRes?.total ?? 0} invoice{invoicesRes?.total !== 1 ? "s" : ""}
              {statusFilter !== "ALL" ? ` · ${statusFilter.replace(/_/g, " ").toLowerCase()}` : ""}
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
    </div>
  );
}
