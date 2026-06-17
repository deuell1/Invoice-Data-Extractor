import { useState } from "react";
import { 
  useListInvoices, 
  useBulkApproveInvoices,
  useApproveInvoice,
  useSetVoucherId
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Download, CheckSquare, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge } from "@/components/status-badge";

export function ApprovalQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  
  const { data: invoicesRes, isLoading } = useListInvoices({ limit: 100 }); // Getting all to show pending and approved, normally we'd filter or tab this
  
  const pendingInvoices = invoicesRes?.data?.filter(i => i.status === 'PENDING_APPROVAL') || [];
  const approvedInvoices = invoicesRes?.data?.filter(i => i.status === 'APPROVED' || i.status === 'POSTED') || [];

  const bulkApprove = useBulkApproveInvoices();
  const approveInvoice = useApproveInvoice();
  const setVoucher = useSetVoucherId();

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(pendingInvoices.map(i => i.id));
    else setSelectedIds([]);
  };

  const handleSelect = (id: number, checked: boolean) => {
    if (checked) setSelectedIds(prev => [...prev, id]);
    else setSelectedIds(prev => prev.filter(i => i !== id));
  };

  const handleBulkApprove = async () => {
    if (!selectedIds.length) return;
    try {
      await bulkApprove.mutateAsync({ data: { ids: selectedIds } });
      toast({ title: "Approved", description: `${selectedIds.length} invoices approved.` });
      setSelectedIds([]);
      queryClient.invalidateQueries();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Bulk approval failed" });
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await approveInvoice.mutateAsync({ id });
      toast({ title: "Approved", description: "Invoice approved." });
      queryClient.invalidateQueries();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Approval failed" });
    }
  };

  const handleSetVoucher = async (id: number, voucherId: string) => {
    if (!voucherId) return;
    try {
      await setVoucher.mutateAsync({ id, data: { voucherId } });
      toast({ title: "Voucher Set", description: "Voucher ID saved." });
      queryClient.invalidateQueries();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to set voucher ID" });
    }
  };

  const handleExport = () => {
    window.location.href = '/api/invoices/export';
  };

  return (
    <div className="space-y-6 flex flex-col h-full overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CheckSquare className="h-6 w-6" />
            Approvals & Export
          </h1>
        </div>
        <div className="flex gap-3">
          <Button 
            variant="outline" 
            onClick={handleExport}
            data-testid="button-export-csv"
          >
            <Download className="mr-2 h-4 w-4" />
            Export Approved to CSV
          </Button>
          <Button 
            onClick={handleBulkApprove}
            disabled={selectedIds.length === 0 || bulkApprove.isPending}
            data-testid="button-bulk-approve"
          >
            {bulkApprove.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Approve Selected ({selectedIds.length})
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0 overflow-hidden">
        {/* Pending Queue */}
        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="shrink-0 bg-amber-500/10 border-b pb-3">
            <CardTitle className="text-lg">Pending Approval</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-0">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox 
                      checked={selectedIds.length === pendingInvoices.length && pendingInvoices.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-4"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></TableCell></TableRow>
                ) : pendingInvoices.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No pending approvals</TableCell></TableRow>
                ) : (
                  pendingInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.includes(invoice.id)}
                          onCheckedChange={(checked) => handleSelect(invoice.id, checked as boolean)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{invoice.invoiceNumber || "—"}</TableCell>
                      <TableCell>{invoice.vendorName || "—"}</TableCell>
                      <TableCell>
                        {invoice.totalAmount != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency || "USD" }).format(invoice.totalAmount) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => handleApprove(invoice.id)} data-testid={`button-approve-${invoice.id}`}>
                          Approve
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Approved/Posted */}
        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="shrink-0 bg-emerald-500/10 border-b pb-3">
            <CardTitle className="text-lg">Approved & Ready for ERP</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-0">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="text-right">Voucher ID (ERP)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-4"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></TableCell></TableRow>
                ) : approvedInvoices.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No approved invoices</TableCell></TableRow>
                ) : (
                  approvedInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.invoiceNumber || "—"}</TableCell>
                      <TableCell><StatusBadge status={invoice.status} /></TableCell>
                      <TableCell>
                        {invoice.totalAmount != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency || "USD" }).format(invoice.totalAmount) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end items-center gap-2">
                          <Input 
                            placeholder="Enter Voucher ID" 
                            className="w-32 h-8 text-sm"
                            defaultValue={invoice.voucherId || ""}
                            onBlur={(e) => handleSetVoucher(invoice.id, e.target.value)}
                            data-testid={`input-voucher-${invoice.id}`}
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
    </div>
  );
}
