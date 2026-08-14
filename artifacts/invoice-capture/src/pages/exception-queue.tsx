import { useState, useEffect } from "react";
import { useUser } from "@clerk/react";
import { useIsManager } from "@/hooks/use-role";
import { Link } from "wouter";
import {
  useListExceptions,
  getListExceptionsQueryKey,
  useUpdateInvoiceStatus,
  useUpdateInvoice,
  useAssignException,
  useGetInvoiceAuditLog,
  getGetInvoiceAuditLogQueryKey,
  useListVendors,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@workspace/mission-control-ds/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/mission-control-ds/components/ui/table";
import { Button } from "@workspace/mission-control-ds/components/ui/button";
import { Badge } from "@workspace/mission-control-ds/components/ui/badge";
import { Input } from "@workspace/mission-control-ds/components/ui/input";
import { Label } from "@workspace/mission-control-ds/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/mission-control-ds/components/ui/select";
import { InvoiceCleanupActions } from "@/components/cleanup-actions";
import { Loader2, AlertTriangle, ArrowRight, RotateCcw, ChevronDown, ChevronRight, Pencil, AlertCircle, UserRound, Users } from "lucide-react";
import { AuditActor } from "@/components/audit-actor";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@workspace/mission-control-ds/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/mission-control-ds/components/ui/dialog";

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
  status: string;
  exceptionOwner?: string | null;
};

function InvoiceAuditPanel({ invoiceId }: { invoiceId: number }) {
  const { data: logs, isLoading, isError } = useGetInvoiceAuditLog(invoiceId, {
    query: { enabled: true, queryKey: getGetInvoiceAuditLogQueryKey(invoiceId) },
  });
  if (isLoading)
    return <div className="py-2 text-center text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Loading…</div>;
  if (isError)
    return (
      <div className="py-2 text-xs text-destructive text-center flex items-center justify-center gap-1" data-testid="audit-panel-error">
        <AlertCircle className="h-3 w-3" />
        Could not load audit history
      </div>
    );
  if (!logs || logs.length === 0)
    return <div className="py-2 text-xs text-muted-foreground text-center">No audit logs yet</div>;
  return (
    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
      {logs.map((log) => (
        <div key={log.id} className="text-xs flex gap-2 items-start border-l-2 border-muted pl-2 py-1">
          <span className="text-muted-foreground whitespace-nowrap">
            {format(new Date(log.createdAt), "MMM d HH:mm")}
          </span>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{log.action}</span>
              <AuditActor
                actorClerkId={log.actorClerkId}
                actorName={log.actorName}
                editorRole={log.editorRole}
              />
            </div>
            {log.fieldName && (
              <span className="text-muted-foreground">
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
  const { data: vendorsData } = useListVendors({ limit: 1000 });
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
      queryClient.invalidateQueries({ queryKey: getListExceptionsQueryKey() });
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

function AssignOwnerModal({
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
  const assignException = useAssignException();
  const [owner, setOwner] = useState(invoice.exceptionOwner ?? "");
  const { user } = useUser();
  // ownerClerkId is auto-filled when assigning to self; manager can override for cross-user.
  const [ownerClerkId, setOwnerClerkId] = useState<string>("");

  // Auto-fill ownerClerkId for self-assign
  useEffect(() => {
    if (user?.id && owner.trim() && owner.trim() === (user.fullName ?? user.username ?? "")) {
      setOwnerClerkId(user.id);
    }
  }, [owner, user?.id, user?.fullName, user?.username]);

  const handleAssign = async () => {
    if (!owner.trim()) return;
    try {
      await assignException.mutateAsync({
        id: invoice.id,
        data: {
          owner: owner.trim(),
          // ownerClerkId enables server-side "My work" scoping for the assignee.
          // It is required for the assignment to appear in the assignee's personal queue.
          ownerClerkId: ownerClerkId.trim() || undefined,
        },
      });
      toast({ title: "Owner assigned", description: `Exception assigned to ${owner.trim()}` });
      queryClient.invalidateQueries({ queryKey: getListExceptionsQueryKey() });
      onClose();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.data?.error || "Could not assign owner" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            Assign Owner
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invoice.invoiceNumber || "Untitled"} · {invoice.vendorName || "Unknown Vendor"}
          </p>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Assign To *</Label>
            <Input
              placeholder="e.g. jane.smith"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              data-testid="input-assign-owner"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">
              Assignee Clerk User ID
              <span className="text-muted-foreground font-normal">(auto-filled for self; required for "My work" scoping)</span>
            </Label>
            <Input
              placeholder={user?.id ?? "user_xxxx..."}
              value={ownerClerkId}
              onChange={(e) => setOwnerClerkId(e.target.value)}
              data-testid="input-assign-owner-clerk-id"
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleAssign}
            disabled={!owner.trim() || assignException.isPending}
            data-testid="button-assign-confirm"
          >
            {assignException.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExceptionQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isManager = useIsManager();
  const { user } = useUser();
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [assigningInvoice, setAssigningInvoice] = useState<Invoice | null>(null);

  // Clerks: server always enforces "My work" scope via req.clerkUserId — no
  // assignedTo needed. Managers: "My work" sends their Clerk user ID; "All"
  // omits assignedTo so the server returns the full queue.
  const effectiveShowAll = isManager && showAll;
  const queryParams = effectiveShowAll
    ? { limit: 100 }
    : { limit: 100, ...(user?.id ? { assignedTo: user.id } : {}) };

  const { data: exceptionsRes, isLoading } = useListExceptions(
    queryParams,
    { query: { queryKey: getListExceptionsQueryKey(queryParams) } }
  );

  const updateStatus = useUpdateInvoiceStatus();

  const resolveToApproval = async (id: number) => {
    try {
      await updateStatus.mutateAsync({
        id,
        data: { status: "PENDING_APPROVAL", reason: "Exception resolved manually" },
      });
      toast({ title: "Resolved", description: "Invoice sent to approval queue" });
      queryClient.invalidateQueries({ queryKey: getListExceptionsQueryKey() });
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
      queryClient.invalidateQueries({ queryKey: getListExceptionsQueryKey() });
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
          <p className="text-sm text-muted-foreground mt-1">
            {effectiveShowAll
              ? "All exceptions across the team"
              : "Your assigned exceptions and unassigned items"}
          </p>
        </div>
        {/* Managers get a My work / All toggle; clerks are always in My work mode */}
        {isManager && (
          <div className="flex items-center gap-1 rounded-md border p-1 bg-muted/30">
            <Button
              variant={!showAll ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowAll(false)}
              className="gap-1.5"
              data-testid="toggle-my-work"
            >
              <UserRound className="h-3.5 w-3.5" />
              My work
            </Button>
            <Button
              variant={showAll ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowAll(true)}
              className="gap-1.5"
              data-testid="toggle-all-work"
            >
              <Users className="h-3.5 w-3.5" />
              All
            </Button>
          </div>
        )}
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
              ) : exceptionsRes?.data?.length === 0 ? (
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
                exceptionsRes?.data?.flatMap((invoice) => {
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
                          onClick={() => setAssigningInvoice(invoice as Invoice)}
                          data-testid={`button-assign-${invoice.id}`}
                          title="Assign owner"
                        >
                          <UserRound className="h-3.5 w-3.5 mr-1" />
                          Assign
                        </Button>
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
      {assigningInvoice && (
        <AssignOwnerModal
          invoice={assigningInvoice}
          open={true}
          onClose={() => setAssigningInvoice(null)}
        />
      )}
    </div>
  );
}
