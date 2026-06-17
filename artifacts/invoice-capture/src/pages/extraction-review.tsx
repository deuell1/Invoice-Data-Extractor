import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { format } from "date-fns";
import {
  useGetInvoice,
  getGetInvoiceQueryKey,
  useUpdateInvoice,
  useListVendors,
  useGetInvoiceAuditLog,
  useSubmitInvoice,
  useUpdateInvoiceStatus,
  getGetInvoiceAuditLogQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function ExtractionReview() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: invoice, isLoading, error } = useGetInvoice(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceQueryKey(id) },
  });

  const { data: vendorsData } = useListVendors({ limit: 100 });
  const { data: auditLogs } = useGetInvoiceAuditLog(id, {
    query: { enabled: !!id, queryKey: getGetInvoiceAuditLogQueryKey(id) },
  });

  const updateInvoice = useUpdateInvoice();
  const submitInvoice = useSubmitInvoice();
  const updateStatus = useUpdateInvoiceStatus();

  const [formData, setFormData] = useState<Record<string, string>>({});
  const initialized = useRef(false);

  useEffect(() => {
    if (invoice && !initialized.current) {
      setFormData({
        vendorId: invoice.vendorId?.toString() || "",
        invoiceNumber: invoice.invoiceNumber || "",
        invoiceDate: invoice.invoiceDate || "",
        totalAmount: invoice.totalAmount?.toString() || "",
        taxAmount: invoice.taxAmount?.toString() || "",
        poNumber: invoice.poNumber || "",
        currency: invoice.currency || "USD",
      });
      initialized.current = true;
    }
  }, [invoice]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const getApiErrorMessage = (e: unknown): string => {
    if (e && typeof e === "object" && "status" in e) {
      const err = e as { status: number; data?: { error?: string }; message?: string };
      if (err.status === 409) {
        return err.data?.error || "Duplicate invoice detected — this invoice number already exists for this vendor.";
      }
      if (err.data?.error) return err.data.error;
    }
    return "";
  };

  const handleSaveField = async (field: string, value: string) => {
    try {
      const payload: Record<string, unknown> = { editorRole: "AP_PROCESSOR" };

      if (field === "totalAmount" || field === "taxAmount") {
        payload[field] = value ? parseFloat(value) : null;
      } else if (field === "vendorId") {
        payload[field] = value ? parseInt(value, 10) : null;
      } else {
        payload[field] = value || null;
      }

      await updateInvoice.mutateAsync({ id, data: payload });
      toast({ title: "Saved", description: `${field} updated` });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceAuditLogQueryKey(id) });
    } catch (e) {
      const msg = getApiErrorMessage(e);
      toast({ variant: "destructive", title: "Save Failed", description: msg || "Failed to save field — please try again." });
    }
  };

  const handleSubmit = async () => {
    try {
      await submitInvoice.mutateAsync({ id });
      toast({ title: "Submitted", description: "Invoice routed for approval" });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      setLocation("/invoices");
    } catch (e) {
      const msg = getApiErrorMessage(e);
      if (msg.toLowerCase().includes("duplicate")) {
        toast({ variant: "destructive", title: "Duplicate Invoice", description: msg });
      } else {
        toast({ variant: "destructive", title: "Submit Failed", description: msg || "Could not submit invoice — please check all required fields." });
      }
    }
  };

  const handleFlagException = async () => {
    try {
      await updateStatus.mutateAsync({
        id,
        data: { status: "EXCEPTION", reason: "Manually flagged as exception" },
      });
      toast({ title: "Flagged", description: "Invoice routed to exception queue" });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      setLocation("/exceptions");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Action failed" });
    }
  };

  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (error || !invoice) return <div className="p-8 text-center text-destructive">Failed to load invoice</div>;

  const isLowConfidence = (field: string) => invoice.lowConfidenceFields?.includes(field) || false;

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Invoice</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
            {invoice.originalFileName} <StatusBadge status={invoice.status} />
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setLocation("/invoices")} data-testid="button-back">
            Back
          </Button>
          <Button
            variant="destructive"
            onClick={handleFlagException}
            disabled={updateStatus.isPending}
            data-testid="button-flag-exception"
          >
            {updateStatus.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Flag Exception
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitInvoice.isPending}
            data-testid="button-submit"
          >
            {submitInvoice.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Submit for Approval
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-0">
        {/* Document Viewer */}
        <Card className="flex flex-col h-full overflow-hidden">
          <CardHeader className="py-3 px-4 shrink-0 bg-muted/30 border-b">
            <CardTitle className="text-sm font-medium">Document Viewer</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 relative bg-gray-100 dark:bg-gray-800">
            {invoice.fileObjectPath ? (
              invoice.originalFileName.toLowerCase().endsWith(".pdf") ? (
                <iframe
                  src={`/api/storage/objects${invoice.fileObjectPath.replace(/^\/objects/, "")}`}
                  className="absolute inset-0 w-full h-full border-0"
                  title="Invoice PDF"
                  data-testid="viewer-pdf"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center overflow-auto p-4">
                  <img
                    src={`/api/storage/objects${invoice.fileObjectPath.replace(/^\/objects/, "")}`}
                    alt="Invoice"
                    className="max-w-full max-h-full object-contain"
                    data-testid="viewer-img"
                  />
                </div>
              )
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                No document available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Data Form */}
        <div className="flex flex-col h-full space-y-4">
          <Card className="flex-1 overflow-auto">
            <CardHeader className="py-3 px-4 shrink-0 bg-muted/30 border-b">
              <div className="flex justify-between items-center">
                <CardTitle className="text-sm font-medium">Extracted Data</CardTitle>
                {invoice.confidenceScore != null && (
                  <Badge variant={invoice.confidenceScore > 0.8 ? "outline" : "secondary"}>
                    {Math.round(Number(invoice.confidenceScore) * 100)}% Confidence
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  Vendor
                  {isLowConfidence("vendorId") && <AlertCircle className="h-3 w-3 text-amber-500" />}
                </Label>
                <Select
                  value={formData.vendorId}
                  onValueChange={(val) => {
                    handleInputChange("vendorId", val);
                    handleSaveField("vendorId", val);
                  }}
                >
                  <SelectTrigger className="w-full" data-testid="select-vendor">
                    <SelectValue placeholder="Select Vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendorsData?.data?.map((v) => (
                      <SelectItem key={v.id} value={v.id.toString()}>
                        {v.vendorName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Invoice Number
                    {isLowConfidence("invoiceNumber") && <AlertCircle className="h-3 w-3 text-amber-500" />}
                  </Label>
                  <Input
                    value={formData.invoiceNumber}
                    onChange={(e) => handleInputChange("invoiceNumber", e.target.value)}
                    onBlur={(e) => handleSaveField("invoiceNumber", e.target.value)}
                    data-testid="input-invoice-number"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Invoice Date
                    {isLowConfidence("invoiceDate") && <AlertCircle className="h-3 w-3 text-amber-500" />}
                  </Label>
                  <Input
                    type="date"
                    value={formData.invoiceDate ? formData.invoiceDate.split("T")[0] : ""}
                    onChange={(e) => handleInputChange("invoiceDate", e.target.value)}
                    onBlur={(e) => handleSaveField("invoiceDate", e.target.value)}
                    data-testid="input-invoice-date"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Total Amount
                    {isLowConfidence("totalAmount") && <AlertCircle className="h-3 w-3 text-amber-500" />}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.totalAmount}
                    onChange={(e) => handleInputChange("totalAmount", e.target.value)}
                    onBlur={(e) => handleSaveField("totalAmount", e.target.value)}
                    data-testid="input-total-amount"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Tax Amount
                    {isLowConfidence("taxAmount") && <AlertCircle className="h-3 w-3 text-amber-500" />}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.taxAmount}
                    onChange={(e) => handleInputChange("taxAmount", e.target.value)}
                    onBlur={(e) => handleSaveField("taxAmount", e.target.value)}
                    data-testid="input-tax-amount"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>PO Number</Label>
                  <Input
                    value={formData.poNumber}
                    onChange={(e) => handleInputChange("poNumber", e.target.value)}
                    onBlur={(e) => handleSaveField("poNumber", e.target.value)}
                    data-testid="input-po-number"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select
                    value={formData.currency}
                    onValueChange={(val) => {
                      handleInputChange("currency", val);
                      handleSaveField("currency", val);
                    }}
                  >
                    <SelectTrigger data-testid="select-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="CAD">CAD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Audit Log Panel */}
          <Card className="shrink-0">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="audit-log" className="border-b-0">
                <AccordionTrigger className="py-3 px-4 hover:no-underline text-sm font-medium">
                  Audit Trail
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3 max-h-40 overflow-y-auto pr-2">
                    {auditLogs && auditLogs.length > 0 ? (
                      auditLogs.map((log) => (
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
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground text-center py-2">No audit logs yet</div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>
        </div>
      </div>
    </div>
  );
}
