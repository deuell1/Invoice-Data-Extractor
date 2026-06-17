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
import { StatusBadge } from "@/components/status-badge";
import {
  FileText, AlertCircle, CheckSquare, CheckCircle, FilePlus, Loader2,
  Search, ChevronLeft, ChevronRight,
} from "lucide-react";
import { format } from "date-fns";

type StatusFilter = "ALL" | "PENDING_EXTRACTION" | "EXCEPTION" | "PENDING_APPROVAL" | "APPROVED" | "POSTED";

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Extracting", value: "PENDING_EXTRACTION" },
  { label: "Exception", value: "EXCEPTION" },
  { label: "Needs Approval", value: "PENDING_APPROVAL" },
  { label: "Approved", value: "APPROVED" },
  { label: "Posted", value: "POSTED" },
];

const PAGE_SIZE = 10;

export function InvoiceList() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data: stats, isLoading: statsLoading } = useGetInvoiceStats();

  const queryParams = {
    status: statusFilter === "ALL" ? undefined : statusFilter,
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data: invoicesRes, isLoading: invoicesLoading } = useListInvoices(queryParams, {
    query: { queryKey: getListInvoicesQueryKey(queryParams) },
  });

  const totalPages = Math.max(1, Math.ceil((invoicesRes?.total ?? 0) / PAGE_SIZE));

  const handleStatusChange = (status: StatusFilter) => {
    setStatusFilter(status);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 shrink-0">
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
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500" data-testid="stat-approved">
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : stats?.approved || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="shrink-0 pb-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <CardTitle>Invoices</CardTitle>
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
                <TableHead>Vendor</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
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
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="sm" data-testid={`button-review-${invoice.id}`}>
                          Review
                        </Button>
                      </Link>
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
              {statusFilter !== "ALL" ? ` · filtered by ${statusFilter.replace("_", " ").toLowerCase()}` : ""}
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
              <span className="text-sm">
                Page {page} of {totalPages}
              </span>
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
