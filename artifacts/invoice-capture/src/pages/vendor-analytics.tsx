import { useMemo, useState } from "react";
import {
  useGetVendorAnalytics,
  getGetVendorAnalyticsQueryKey,
} from "@workspace/api-client-react";
import type {
  GetVendorAnalyticsParams,
  VendorAnalyticsRow,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Loader2, Filter, RotateCcw, Building2, ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";

type SortKey =
  | "vendorName"
  | "invoiceCount"
  | "totalAmount"
  | "avgVendorMatchConfidence"
  | "exceptionCount"
  | "duplicateWarningCount"
  | "tieOutFailCount"
  | "missingPoCount"
  | "exportedCount";
type SortDir = "asc" | "desc";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: amount >= 100000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 100000 ? 1 : 2,
  }).format(amount);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

function VendorStatusBadge({ status }: { status?: string }) {
  switch (status) {
    case "ACTIVE":
      return <Badge variant="outline" className="border-emerald-500 text-emerald-600">Active</Badge>;
    case "ON_HOLD":
      return <Badge variant="outline" className="border-amber-500 text-amber-600">On Hold</Badge>;
    case "INACTIVE":
      return <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">Inactive</Badge>;
    default:
      return <Badge variant="outline">{status || "—"}</Badge>;
  }
}

function SortIcon({ col, sortBy, sortDir }: { col: SortKey; sortBy: SortKey; sortDir: SortDir }) {
  if (sortBy !== col) return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
}

export function VendorAnalytics() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("totalAmount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const queryParams = useMemo<GetVendorAnalyticsParams>(() => ({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }), [dateFrom, dateTo]);

  const { data: analyticsRes, isLoading } = useGetVendorAnalytics(queryParams, {
    query: { queryKey: getGetVendorAnalyticsQueryKey(queryParams) },
  });

  const hasFilters = dateFrom !== "" || dateTo !== "";

  const resetFilters = () => {
    setDateFrom("");
    setDateTo("");
  };

  const handleSort = (col: SortKey) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "vendorName" ? "asc" : "desc");
    }
  };

  const rows = useMemo<VendorAnalyticsRow[]>(() => {
    const data = analyticsRes?.data ? [...analyticsRes.data] : [];
    data.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "vendorName") {
        cmp = a.vendorName.localeCompare(b.vendorName);
      } else {
        const av = (a[sortBy] as number | null | undefined) ?? -Infinity;
        const bv = (b[sortBy] as number | null | undefined) ?? -Infinity;
        cmp = av - bv;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return data;
  }, [analyticsRes, sortBy, sortDir]);

  const SortableHead = ({
    col,
    children,
    className,
  }: {
    col: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => (
    <TableHead
      className={cn("cursor-pointer select-none hover:bg-muted/30 transition-colors", className)}
      onClick={() => handleSort(col)}
      data-testid={`sort-${col}`}
    >
      <span className={cn("flex items-center", className?.includes("text-right") && "justify-end")}>
        {children}
        <SortIcon col={col} sortBy={sortBy} sortDir={sortDir} />
      </span>
    </TableHead>
  );

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Vendor Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invoice volume, value, and data quality by vendor
          </p>
        </div>
      </div>

      <Card className="shrink-0">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground mr-2">
              <Filter className="h-4 w-4" />
              Filters
            </div>
            <div className="space-y-1">
              <Label htmlFor="date-from" className="text-xs">From</Label>
              <Input
                id="date-from"
                type="date"
                className="h-9 w-40"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date-to" className="text-xs">To</Label>
              <Input
                id="date-to"
                type="date"
                className="h-9 w-40"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-date-to"
              />
            </div>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                data-testid="button-reset-filters"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <SortableHead col="vendorName">Vendor</SortableHead>
                <TableHead>Status</TableHead>
                <SortableHead col="invoiceCount" className="text-right">Invoices</SortableHead>
                <SortableHead col="totalAmount" className="text-right">Total Amount</SortableHead>
                <SortableHead col="avgVendorMatchConfidence" className="text-right">Avg Match</SortableHead>
                <SortableHead col="exceptionCount" className="text-right">Exceptions</SortableHead>
                <SortableHead col="duplicateWarningCount" className="text-right">Duplicates</SortableHead>
                <SortableHead col="tieOutFailCount" className="text-right">Tie-Out Fail</SortableHead>
                <SortableHead col="missingPoCount" className="text-right">Missing PO</SortableHead>
                <SortableHead col="exportedCount" className="text-right">Exported</SortableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                    No vendor analytics available.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.vendorId} data-testid={`row-vendor-${row.vendorId}`}>
                    <TableCell>
                      <div className="font-medium">{row.vendorName}</div>
                      <div className="text-xs text-muted-foreground">{row.vendorCode}</div>
                    </TableCell>
                    <TableCell>
                      <VendorStatusBadge status={row.vendorStatus} />
                    </TableCell>
                    <TableCell className="text-right">{row.invoiceCount}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(row.totalAmount)}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.avgVendorMatchConfidence)}</TableCell>
                    <TableCell className={cn("text-right", row.exceptionCount > 0 && "text-destructive font-medium")}>
                      {row.exceptionCount}
                    </TableCell>
                    <TableCell className={cn("text-right", (row.duplicateWarningCount ?? 0) > 0 && "text-amber-600 font-medium")}>
                      {row.duplicateWarningCount ?? 0}
                    </TableCell>
                    <TableCell className={cn("text-right", (row.tieOutFailCount ?? 0) > 0 && "text-destructive font-medium")}>
                      {row.tieOutFailCount ?? 0}
                    </TableCell>
                    <TableCell className={cn("text-right", (row.missingPoCount ?? 0) > 0 && "text-slate-500")}>
                      {row.missingPoCount ?? 0}
                    </TableCell>
                    <TableCell className="text-right">{row.exportedCount}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        {rows.length > 0 && (
          <div className="px-4 py-3 border-t shrink-0 text-sm text-muted-foreground">
            {rows.length} vendor{rows.length !== 1 ? "s" : ""}
          </div>
        )}
      </Card>
    </div>
  );
}
