import { useState } from "react";
import { Link } from "wouter";
import {
  useListInvoices,
  getListInvoicesQueryKey,
  type ListInvoicesParams,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import {
  Loader2, Search, ChevronLeft, ChevronRight, SlidersHorizontal, X, Inbox,
} from "lucide-react";

type SortBy = "createdAt" | "invoiceDate" | "dueDate" | "totalAmount" | "vendorName" | "confidenceScore" | "status";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 15;
const ANY = "ANY";

type FilterState = {
  search: string;
  status: string;
  tieOutStatus: string;
  validationStatus: string;
  exportStatus: string;
  poNumber: string;
  voucherId: string;
  businessDocumentId: string;
  exportBatchId: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  confidenceMin: string;
  confidenceMax: string;
  sortBy: SortBy;
  sortDir: SortDir;
};

const EMPTY_FILTERS: FilterState = {
  search: "",
  status: ANY,
  tieOutStatus: ANY,
  validationStatus: ANY,
  exportStatus: ANY,
  poNumber: "",
  voucherId: "",
  businessDocumentId: "",
  exportBatchId: "",
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
  confidenceMin: "",
  confidenceMax: "",
  sortBy: "createdAt",
  sortDir: "desc",
};

function formatAmount(value: number | null | undefined, currency?: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(value);
}

function ExportStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  switch (status) {
    case "READY":
      return <Badge variant="outline" className="border-blue-500 text-blue-600">Export Ready</Badge>;
    case "EXPORTED":
      return <Badge variant="outline" className="border-emerald-500 text-emerald-600">Exported</Badge>;
    case "FAILED":
      return <Badge variant="outline" className="border-destructive text-destructive">Export Failed</Badge>;
    case "BLOCKED":
      return <Badge variant="outline" className="border-amber-500 text-amber-600">Export Blocked</Badge>;
    case "NOT_READY":
      return <Badge variant="outline" className="text-muted-foreground">Not Ready</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function AdvancedSearch() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    setFilters((p) => ({ ...p, [key]: value }));

  const parseNum = (v: string): number | undefined => {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };

  const queryParams: ListInvoicesParams = {
    search: applied.search || undefined,
    status: applied.status === ANY ? undefined : (applied.status as ListInvoicesParams["status"]),
    tieOutStatus: applied.tieOutStatus === ANY ? undefined : (applied.tieOutStatus as ListInvoicesParams["tieOutStatus"]),
    validationStatus: applied.validationStatus === ANY ? undefined : applied.validationStatus,
    exportStatus: applied.exportStatus === ANY ? undefined : (applied.exportStatus as ListInvoicesParams["exportStatus"]),
    poNumber: applied.poNumber || undefined,
    voucherId: applied.voucherId || undefined,
    businessDocumentId: applied.businessDocumentId || undefined,
    exportBatchId: applied.exportBatchId || undefined,
    dateFrom: applied.dateFrom || undefined,
    dateTo: applied.dateTo || undefined,
    amountMin: parseNum(applied.amountMin),
    amountMax: parseNum(applied.amountMax),
    confidenceMin: parseNum(applied.confidenceMin),
    confidenceMax: parseNum(applied.confidenceMax),
    sortBy: applied.sortBy,
    sortDir: applied.sortDir,
    page,
    limit: PAGE_SIZE,
  };

  const { data: res, isLoading } = useListInvoices(queryParams, {
    query: { queryKey: getListInvoicesQueryKey(queryParams) },
  });

  const totalPages = Math.max(1, Math.ceil((res?.total ?? 0) / PAGE_SIZE));

  const handleSearch = () => {
    setApplied(filters);
    setPage(1);
  };

  const handleReset = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SlidersHorizontal className="h-6 w-6" />
          Advanced Search
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Search and filter invoices across all fields</p>
      </div>

      <Card className="shrink-0">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8 h-9"
                placeholder="Invoice #, vendor, PO, voucher, file name, document ID…"
                value={filters.search}
                onChange={(e) => set("search", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                data-testid="filter-search"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={filters.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="h-9" data-testid="filter-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any status</SelectItem>
                  <SelectItem value="PENDING_EXTRACTION">Extracting</SelectItem>
                  <SelectItem value="EXCEPTION">Exception</SelectItem>
                  <SelectItem value="PENDING_APPROVAL">Needs Approval</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="POSTED">Posted</SelectItem>
                  <SelectItem value="VOIDED">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tie-Out Status</Label>
              <Select value={filters.tieOutStatus} onValueChange={(v) => set("tieOutStatus", v)}>
                <SelectTrigger className="h-9" data-testid="filter-tieout"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  <SelectItem value="PASS">Pass</SelectItem>
                  <SelectItem value="WARNING">Warning</SelectItem>
                  <SelectItem value="FAIL">Fail</SelectItem>
                  <SelectItem value="SKIPPED">Skipped</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Validation Status</Label>
              <Select value={filters.validationStatus} onValueChange={(v) => set("validationStatus", v)}>
                <SelectTrigger className="h-9" data-testid="filter-validation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  <SelectItem value="PASS">Pass</SelectItem>
                  <SelectItem value="NEEDS_REVIEW">Needs Review</SelectItem>
                  <SelectItem value="FAIL">Fail</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Export Status</Label>
              <Select value={filters.exportStatus} onValueChange={(v) => set("exportStatus", v)}>
                <SelectTrigger className="h-9" data-testid="filter-export"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  <SelectItem value="NOT_READY">Not Ready</SelectItem>
                  <SelectItem value="READY">Export Ready</SelectItem>
                  <SelectItem value="EXPORTED">Exported</SelectItem>
                  <SelectItem value="FAILED">Export Failed</SelectItem>
                  <SelectItem value="BLOCKED">Export Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">PO Number</Label>
              <Input className="h-9" value={filters.poNumber} onChange={(e) => set("poNumber", e.target.value)} data-testid="filter-po" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Voucher ID</Label>
              <Input className="h-9" value={filters.voucherId} onChange={(e) => set("voucherId", e.target.value)} data-testid="filter-voucher" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Business Document ID</Label>
              <Input className="h-9" value={filters.businessDocumentId} onChange={(e) => set("businessDocumentId", e.target.value)} data-testid="filter-business-doc" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Export Batch ID</Label>
              <Input className="h-9" value={filters.exportBatchId} onChange={(e) => set("exportBatchId", e.target.value)} data-testid="filter-batch" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Invoice Date From</Label>
              <Input type="date" className="h-9" value={filters.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} data-testid="filter-date-from" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Invoice Date To</Label>
              <Input type="date" className="h-9" value={filters.dateTo} onChange={(e) => set("dateTo", e.target.value)} data-testid="filter-date-to" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount Min</Label>
              <Input type="number" step="0.01" className="h-9" value={filters.amountMin} onChange={(e) => set("amountMin", e.target.value)} data-testid="filter-amount-min" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount Max</Label>
              <Input type="number" step="0.01" className="h-9" value={filters.amountMax} onChange={(e) => set("amountMax", e.target.value)} data-testid="filter-amount-max" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Confidence Min (%)</Label>
              <Input type="number" min="0" max="100" className="h-9" value={filters.confidenceMin} onChange={(e) => set("confidenceMin", e.target.value)} data-testid="filter-confidence-min" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Confidence Max (%)</Label>
              <Input type="number" min="0" max="100" className="h-9" value={filters.confidenceMax} onChange={(e) => set("confidenceMax", e.target.value)} data-testid="filter-confidence-max" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sort By</Label>
              <Select value={filters.sortBy} onValueChange={(v) => set("sortBy", v as SortBy)}>
                <SelectTrigger className="h-9" data-testid="filter-sortby"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">Created Date</SelectItem>
                  <SelectItem value="invoiceDate">Invoice Date</SelectItem>
                  <SelectItem value="dueDate">Due Date</SelectItem>
                  <SelectItem value="totalAmount">Amount</SelectItem>
                  <SelectItem value="vendorName">Vendor</SelectItem>
                  <SelectItem value="confidenceScore">Confidence</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sort Direction</Label>
              <Select value={filters.sortDir} onValueChange={(v) => set("sortDir", v as SortDir)}>
                <SelectTrigger className="h-9" data-testid="filter-sortdir"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Descending</SelectItem>
                  <SelectItem value="asc">Ascending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleReset} data-testid="button-reset">
              <X className="mr-2 h-4 w-4" />
              Reset
            </Button>
            <Button onClick={handleSearch} data-testid="button-apply">
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Document ID</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Export Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : res?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                        <Inbox className="h-6 w-6" />
                      </div>
                      <p>No invoices match your search criteria.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                res?.data?.map((invoice) => (
                  <TableRow key={invoice.id} data-testid={`row-invoice-${invoice.id}`}>
                    <TableCell className="font-medium">{invoice.documentId || invoice.invoiceNumber || "—"}</TableCell>
                    <TableCell>{invoice.vendorName || "Unknown Vendor"}</TableCell>
                    <TableCell><StatusBadge status={invoice.status} /></TableCell>
                    <TableCell>{formatAmount(invoice.totalAmount, invoice.currency)}</TableCell>
                    <TableCell>
                      {invoice.confidenceScore != null
                        ? `${Math.round(invoice.confidenceScore)}%`
                        : "—"}
                    </TableCell>
                    <TableCell><ExportStatusBadge status={invoice.exportStatus} /></TableCell>
                    <TableCell className="text-right">
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="sm" data-testid={`button-view-${invoice.id}`}>
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>

        {(res?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 text-sm text-muted-foreground">
            <span>
              {res?.total ?? 0} invoice{res?.total !== 1 ? "s" : ""} found
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
