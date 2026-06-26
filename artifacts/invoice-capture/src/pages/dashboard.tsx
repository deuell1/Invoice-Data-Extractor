import { useMemo, useState } from "react";
import {
  useGetDashboardMetrics,
  getGetDashboardMetricsQueryKey,
  useListVendors,
} from "@workspace/api-client-react";
import type {
  GetDashboardMetricsParams,
  GetDashboardMetricsStatus,
  GetDashboardMetricsExportStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  FileText, AlertCircle, CheckSquare, CheckCircle, Send, Loader2,
  FileCheck, FileUp, FileX, FileWarning, Eye, Scale, Copy, FileQuestion,
  CalendarX, Percent, DollarSign, Gauge, Target, Filter, RotateCcw,
  BarChart3, LayoutDashboard,
} from "lucide-react";

type StatusOption = GetDashboardMetricsStatus | "ALL";
type ExportStatusOption = GetDashboardMetricsExportStatus | "ALL";

const STATUS_OPTIONS: { label: string; value: StatusOption }[] = [
  { label: "All Statuses", value: "ALL" },
  { label: "Pending Extraction", value: "PENDING_EXTRACTION" },
  { label: "Exception", value: "EXCEPTION" },
  { label: "Pending Approval", value: "PENDING_APPROVAL" },
  { label: "Approved", value: "APPROVED" },
  { label: "Posted", value: "POSTED" },
  { label: "Voided", value: "VOIDED" },
];

const EXPORT_STATUS_OPTIONS: { label: string; value: ExportStatusOption }[] = [
  { label: "All Export States", value: "ALL" },
  { label: "Not Ready", value: "NOT_READY" },
  { label: "Export Ready", value: "READY" },
  { label: "Exported", value: "EXPORTED" },
  { label: "Export Failed", value: "FAILED" },
  { label: "Export Blocked", value: "BLOCKED" },
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: amount >= 100000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 100000 ? 1 : 0,
  }).format(amount);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

function StatCard({
  title,
  value,
  icon,
  loading,
  color,
  testId,
}: {
  title: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  loading: boolean;
  color?: string;
  testId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", color)} data-testid={testId}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : value}
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState<StatusOption>("ALL");
  const [exportStatus, setExportStatus] = useState<ExportStatusOption>("ALL");
  const [vendorId, setVendorId] = useState<string>("ALL");

  const { data: vendorsData } = useListVendors({ limit: 1000 });

  const queryParams = useMemo<GetDashboardMetricsParams>(() => ({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    status: status === "ALL" ? undefined : status,
    exportStatus: exportStatus === "ALL" ? undefined : exportStatus,
    vendorId: vendorId === "ALL" ? undefined : parseInt(vendorId, 10),
  }), [dateFrom, dateTo, status, exportStatus, vendorId]);

  const { data: metrics, isLoading } = useGetDashboardMetrics(queryParams, {
    query: { queryKey: getGetDashboardMetricsQueryKey(queryParams) },
  });

  const hasFilters =
    dateFrom !== "" || dateTo !== "" || status !== "ALL" ||
    exportStatus !== "ALL" || vendorId !== "ALL";

  const resetFilters = () => {
    setDateFrom("");
    setDateTo("");
    setStatus("ALL");
    setExportStatus("ALL");
    setVendorId("ALL");
  };

  const exceptionRatePct = metrics ? (metrics.exceptionRate * 100).toFixed(1) : "0.0";

  const maxStatusAmount = useMemo(() => {
    if (!metrics?.valueByStatus?.length) return 0;
    return Math.max(...metrics.valueByStatus.map((s) => s.totalAmount));
  }, [metrics]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6" />
          Dashboard
        </h1>
      </div>

      {/* Filter bar */}
      <Card>
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
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusOption)}>
                <SelectTrigger className="h-9 w-48" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Export State</Label>
              <Select value={exportStatus} onValueChange={(v) => setExportStatus(v as ExportStatusOption)}>
                <SelectTrigger className="h-9 w-48" data-testid="select-export-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPORT_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger className="h-9 w-56" data-testid="select-vendor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Vendors</SelectItem>
                  {vendorsData?.data?.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>{v.vendorName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      {/* Phase 1 summary cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          title="Total Invoices"
          value={metrics?.total ?? 0}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          loading={isLoading}
          testId="metric-total"
        />
        <StatCard
          title="Exceptions"
          value={metrics?.exception ?? 0}
          icon={<AlertCircle className="h-4 w-4 text-destructive" />}
          loading={isLoading}
          color="text-destructive"
          testId="metric-exception"
        />
        <StatCard
          title="Pending Approval"
          value={metrics?.pendingApproval ?? 0}
          icon={<CheckSquare className="h-4 w-4 text-amber-500" />}
          loading={isLoading}
          color="text-amber-500"
          testId="metric-pending-approval"
        />
        <StatCard
          title="Approved"
          value={metrics?.approved ?? 0}
          icon={<CheckCircle className="h-4 w-4 text-emerald-500" />}
          loading={isLoading}
          color="text-emerald-500"
          testId="metric-approved"
        />
        <StatCard
          title="Posted"
          value={metrics?.posted ?? 0}
          icon={<Send className="h-4 w-4 text-blue-500" />}
          loading={isLoading}
          color="text-blue-500"
          testId="metric-posted"
        />
        <StatCard
          title="Pending Extraction"
          value={metrics?.pendingExtraction ?? 0}
          icon={<FileText className="h-4 w-4 text-slate-500" />}
          loading={isLoading}
          color="text-slate-500"
          testId="metric-pending-extraction"
        />
      </div>

      {/* Export Readiness */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileUp className="h-5 w-5 text-muted-foreground" />
          Export Readiness
        </h2>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Export Ready"
            value={metrics?.exportReady ?? 0}
            icon={<FileCheck className="h-4 w-4 text-emerald-500" />}
            loading={isLoading}
            color="text-emerald-500"
            testId="metric-export-ready"
          />
          <StatCard
            title="Exported"
            value={metrics?.exported ?? 0}
            icon={<FileUp className="h-4 w-4 text-blue-500" />}
            loading={isLoading}
            color="text-blue-500"
            testId="metric-exported"
          />
          <StatCard
            title="Export Failed"
            value={metrics?.exportFailed ?? 0}
            icon={<FileX className="h-4 w-4 text-destructive" />}
            loading={isLoading}
            color="text-destructive"
            testId="metric-export-failed"
          />
          <StatCard
            title="Export Blocked"
            value={metrics?.exportBlocked ?? 0}
            icon={<FileWarning className="h-4 w-4 text-amber-500" />}
            loading={isLoading}
            color="text-amber-500"
            testId="metric-export-blocked"
          />
        </div>
      </div>

      {/* Data Quality */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-muted-foreground" />
          Data Quality
        </h2>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <StatCard
            title="Needs Review"
            value={metrics?.needsReview ?? 0}
            icon={<Eye className="h-4 w-4 text-orange-500" />}
            loading={isLoading}
            color="text-orange-500"
            testId="metric-needs-review"
          />
          <StatCard
            title="Tie-Out Fail"
            value={metrics?.tieOutFail ?? 0}
            icon={<Scale className="h-4 w-4 text-destructive" />}
            loading={isLoading}
            color="text-destructive"
            testId="metric-tieout-fail"
          />
          <StatCard
            title="Tie-Out Warning"
            value={metrics?.tieOutWarning ?? 0}
            icon={<Scale className="h-4 w-4 text-amber-500" />}
            loading={isLoading}
            color="text-amber-500"
            testId="metric-tieout-warning"
          />
          <StatCard
            title="Duplicate Warning"
            value={metrics?.duplicateWarning ?? 0}
            icon={<Copy className="h-4 w-4 text-amber-500" />}
            loading={isLoading}
            color="text-amber-500"
            testId="metric-duplicate-warning"
          />
          <StatCard
            title="Missing PO"
            value={metrics?.missingPo ?? 0}
            icon={<FileQuestion className="h-4 w-4 text-slate-500" />}
            loading={isLoading}
            color="text-slate-500"
            testId="metric-missing-po"
          />
          <StatCard
            title="Missing Due Date"
            value={metrics?.missingDueDate ?? 0}
            icon={<CalendarX className="h-4 w-4 text-slate-500" />}
            loading={isLoading}
            color="text-slate-500"
            testId="metric-missing-due-date"
          />
        </div>
      </div>

      {/* Confidence, exception rate, approved value */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Gauge className="h-5 w-5 text-muted-foreground" />
          Quality & Value Metrics
        </h2>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Avg Extraction Confidence"
            value={formatPercent(metrics?.avgExtractionConfidence)}
            icon={<Gauge className="h-4 w-4 text-indigo-500" />}
            loading={isLoading}
            color="text-indigo-500"
            testId="metric-avg-extraction-confidence"
          />
          <StatCard
            title="Avg Vendor Match Confidence"
            value={formatPercent(metrics?.avgVendorMatchConfidence)}
            icon={<Target className="h-4 w-4 text-indigo-500" />}
            loading={isLoading}
            color="text-indigo-500"
            testId="metric-avg-vendor-match-confidence"
          />
          <StatCard
            title="Exception Rate"
            value={`${exceptionRatePct}%`}
            icon={<Percent className="h-4 w-4 text-rose-500" />}
            loading={isLoading}
            color="text-rose-500"
            testId="metric-exception-rate"
          />
          <StatCard
            title="Approved Value"
            value={formatCurrency(metrics?.totalApprovedAmount ?? 0)}
            icon={<DollarSign className="h-4 w-4 text-emerald-600" />}
            loading={isLoading}
            testId="metric-approved-amount"
          />
        </div>
      </div>

      {/* Value by status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            Value by Status
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
                <TableHead className="w-1/3">Distribution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : !metrics?.valueByStatus?.length ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No value data available.
                  </TableCell>
                </TableRow>
              ) : (
                metrics.valueByStatus.map((row) => (
                  <TableRow key={row.status} data-testid={`row-value-status-${row.status}`}>
                    <TableCell className="font-medium">{row.status.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.totalAmount)}</TableCell>
                    <TableCell>
                      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${maxStatusAmount > 0 ? (row.totalAmount / maxStatusAmount) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
