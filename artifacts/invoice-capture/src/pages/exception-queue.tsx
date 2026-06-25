import { useState } from "react";
import { Link } from "wouter";
import {
  useListInvoices,
  getListInvoicesQueryKey,
  useUpdateInvoiceStatus,
  useUpdateInvoice,
  useGetInvoiceAuditLog,
  getGetInvoiceAuditLogQueryKey,
  useListVendors,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InvoiceCleanupActions } from "@/components/cleanup-actions";
import { Loader2, AlertTriangle, ArrowRight, RotateCcw, ChevronDown, ChevronRight, Pencil, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type Invoice = {
  id: number;
  invoiceNumber: string | null;
  vendorId: number | null;
  vendorName: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  taxAmount: number | null;
  poNumber: string | null;
  currency: string;
  exceptionReason: string | null;
  lowConfidenceFields: string | null;
  updatedAt: string;
};

function InvoiceAuditPanel({ invoiceId }: { invoiceId: number }) {
  const { data: logs, isLoading } = useGetInvoiceAuditLog(invoiceId, {
    query: { enabled: true, queryKey: getGetInvoiceAuditLogQueryKey(invoiceId) },
  });
  if (isLoading)
    return <div className="py-2 text-center text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Loading…</div>;
  if (!logs || logs.length === 0)
    return <div className="py-2 text-xs text-muted-foreground text-center">No audit logs yet</div>;
  return (
    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
      {logs.map((log) => (
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
      ))}
    </div>
  );
}

function EditFieldsModal({
  invoice,
  open,
  onClose,
}: {
  invoice: Invoice;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: vendorsData } = useListVendors({ limit: 100 });
  const updateInvoice = useUpdateInvoice();

  const flagged = invoice.lowConfidenceFields?.split(",").map((f) => f.trim()) ?? [];

  const [form, setForm] = useState({
    vendorId: invoice.vendorId?.toString() ?? "",
    invoiceNumber: invoice.invoiceNumber ?? "",
    invoiceDate: invoice.invoiceDate ? invoice.invoiceDate.split("T")[0] : "",
    totalAmount: invoice.totalAmount?.toString() ?? "",
    taxAmount: invoice.taxAmount?.toString() ?? "",
    poNumber: invoice.poNumber ?? "",
    currency: invoice.currency ?? "USD",
  });

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = { editorRole: "AP_PROCESSOR" };
      if (form.vendorId) payload.vendorId = parseInt(form.vendorId, 10);
      if (form.invoiceNumber !== undefined) payload.invoiceNumber = form.invoiceNumber || null;
      if (form.invoiceDate !== undefined) payload.invoiceDate = form.invoiceDate || null;
      payload.totalAmount = form.totalAmount ? parseFloat(form.totalAmount) : null;
      payload.taxAmount = form.taxAmount ? parseFloat(form.taxAmount) : null;
      if (form.poNumber !== undefined) payload.poNumber = form.poNumber || null;
      payload.currency = form.currency;

      await updateInvoice.mutateAsync({ id: invoice.id, data: payload });
      toast({ title: "Saved", description: "Invoice fields updated" });
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey({ status: "EXCEPTION" }) });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceAuditLogQueryKey(invoice.id) });
      onClose();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save Failed", description: e?.data?.error || "Failed to save changes" });
    }
  };

  const isLow = (field: string) => flagged.includes(field);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Invoice Fields</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invoice.invoiceNumber || "Untitled"} · {invoice.vendorName || "Unknown Vendor"}
          </p>
        </DialogHeader>
        {flagged.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {flagged.map((f) => (
              <Badge key={f} variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-xs">
                <AlertCircle className="h-3 w-3 mr-1" />
                {f}
              </Badge>
            ))}
          </div>
        )}
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="flex items-center gap-1 text-xs">
              Vendor {isLow("vendorId") && <AlertCircle className="h-3 w-3 text-amber-500" />}
            </Label>
            <Select value={form.vendorId} onValueChange={(v) => setForm((p) => ({ ...p, vendorId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select Vendor" /></SelectTrigger>
              <SelectContent>
                {vendorsData?.data?.map((v) => (
                  <SelectItem key={v.id} value={v.id.toString()}>{v.vendorName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                Invoice # {isLow("invoiceNumber") && <AlertCircle className="h-3 w-3 text-amber-500" />}
              </Label>
              <Input value={form.invoiceNumber} onChange={(e) => setForm((p) => ({ ...p, invoiceNumber: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                Invoice Date {isLow("invoiceDate") && <AlertCircle className="h-3 w-3 text-amber-500" />}
              </Label>
              <Input type="date" value={form.invoiceDate} onChange={(e) => setForm((p) => ({ ...p, invoiceDate: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                Total Amount {isLow("totalAmount") && <AlertCircle className="h-3 w-3 text-amber-500" />}
              </Label>
              <Input type="number" step="0.01" value={form.totalAmount} onChange={(e) => setForm((p) => ({ ...p, totalAmount: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                Tax Amount {isLow("taxAmount") && <AlertCircle className="h-3 w-3 text-amber-500" />}
              </Label>
              <Input type="number" step="0.01" value={form.taxAmount} onChange={(e) => setForm((p) => ({ ...p, taxAmount: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                PO Number {isLow("poNumber") && <AlertCircle className="h-3 w-3 text-amber-500" />}
              </Label>
              <Input value={form.poNumber} onChange={(e) => setForm((p) => ({ ...p, poNumber: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((p) => ({ ...p, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateInvoice.isPending}>
            {updateInvoice.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExceptionQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

  const { data: invoicesRes, isLoading } = useListInvoices(
    { status: "EXCEPTION", limit: 100 },
    { query: { queryKey: getListInvoicesQueryKey({ status: "EXCEPTION", limit: 100 }) } }
  );

  const updateStatus = useUpdateInvoiceStatus();

  const resolveToApproval = async (id: number) => {
    try {
      await updateStatus.mutateAsync({
        id,
        data: { status: "PENDING_APPROVAL", reason: "Exception resolved manually" },
      });
      toast({ title: "Resolved", description: "Invoice sent to approval queue" });
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey({ status: "EXCEPTION" }) });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to resolve exception" });
    }
  };

  const rejectToExtraction = async (id: number) => {
    try {
      await updateStatus.mutateAsync({
        id,
        data: { status: "PENDING_EXTRACTION", reason: "Returned to extraction for correction" },
      });
      toast({ title: "Returned", description: "Invoice returned to extraction queue" });
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey({ status: "EXCEPTION" }) });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to return invoice" });
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-destructive flex items-center gap-2">
            <AlertTriangle className="h-6 w-6" />
            Exception Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Invoices requiring manual intervention</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 border-destructive/20">
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Exception Reason</TableHead>
                <TableHead>Date Logged</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : invoicesRes?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                        <ArrowRight className="h-6 w-6" />
                      </div>
                      <p>Queue is empty. All exceptions resolved.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                invoicesRes?.data?.flatMap((invoice) => {
                  const isExpanded = expandedId === invoice.id;
                  return [
                    <TableRow key={invoice.id} data-testid={`row-exception-${invoice.id}`} className="cursor-pointer hover:bg-muted/30">
                      <TableCell
                        className="text-muted-foreground"
                        onClick={() => setExpandedId(isExpanded ? null : invoice.id)}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-medium">{invoice.invoiceNumber || "—"}</TableCell>
                      <TableCell>{invoice.vendorName || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-destructive border-destructive/50 bg-destructive/5">
                          {invoice.exceptionReason || "Data mismatch"}
                        </Badge>
                      </TableCell>
                      <TableCell>{format(new Date(invoice.updatedAt), "MMM d, yyyy HH:mm")}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingInvoice(invoice as Invoice)}
                          data-testid={`button-edit-${invoice.id}`}
                          title="Edit flagged fields"
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => rejectToExtraction(invoice.id)}
                          disabled={updateStatus.isPending}
                          data-testid={`button-reject-${invoice.id}`}
                          title="Return to extraction for correction"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resolveToApproval(invoice.id)}
                          disabled={updateStatus.isPending}
                          data-testid={`button-resolve-${invoice.id}`}
                        >
                          Resolve
                        </Button>
                        <Link href={`/invoices/${invoice.id}`}>
                          <Button size="sm" variant="secondary" data-testid={`button-review-${invoice.id}`}>
                            Review Data
                          </Button>
                        </Link>
                        <InvoiceCleanupActions
                          invoiceId={invoice.id}
                          status={invoice.status}
                          variant="compact"
                        />
                      </TableCell>
                    </TableRow>,
                    isExpanded && (
                      <TableRow key={`audit-${invoice.id}`} className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={6} className="py-3 px-6">
                          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                            Audit History
                          </div>
                          <InvoiceAuditPanel invoiceId={invoice.id} />
                        </TableCell>
                      </TableRow>
                    ),
                  ].filter(Boolean);
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editingInvoice && (
        <EditFieldsModal
          invoice={editingInvoice}
          open={true}
          onClose={() => setEditingInvoice(null)}
        />
      )}
    </div>
  );
}
