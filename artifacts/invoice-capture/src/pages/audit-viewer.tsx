import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceAuditLog,
  getGetInvoiceAuditLogQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, History, Search, FileQuestion } from "lucide-react";
import { AuditActor } from "@/components/audit-actor";
import { format } from "date-fns";

export function AuditViewer() {
  const [inputValue, setInputValue] = useState("");
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: logs, isLoading, isError } = useGetInvoiceAuditLog(invoiceId ?? 0, {
    query: {
      enabled: invoiceId != null && invoiceId > 0,
      queryKey: getGetInvoiceAuditLogQueryKey(invoiceId ?? 0),
      // Do not auto-retry: the user controls retries via the "Try Again" button.
      // Immediate failure surfacing keeps the error state predictable.
      retry: false,
      // Treat a non-array 200 body as a load failure so the error state
      // (with retry) is shown rather than silently falling through to an
      // empty-state or crashing on .map().
      select: (data) => {
        if (!Array.isArray(data)) {
          throw new Error("Unexpected audit log response shape");
        }
        return data;
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(inputValue, 10);
    setInvoiceId(Number.isNaN(parsed) || parsed <= 0 ? null : parsed);
  };

  const handleRetry = () => {
    queryClient.invalidateQueries({
      queryKey: getGetInvoiceAuditLogQueryKey(invoiceId ?? 0),
    });
  };

  const hasQuery = invoiceId != null && invoiceId > 0;

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-6 w-6" />
          Audit Log Viewer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Inspect the change history for a single invoice</p>
      </div>

      <Card className="shrink-0">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="invoice-id" className="text-xs">Invoice ID</Label>
              <Input
                id="invoice-id"
                type="number"
                min={1}
                className="w-48"
                placeholder="e.g. 123"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                data-testid="input-invoice-id"
              />
            </div>
            <Button type="submit" data-testid="button-load-audit">
              <Search className="mr-2 h-4 w-4" />
              Load Audit Log
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="shrink-0">
          <CardTitle>
            {hasQuery ? `Audit History — Invoice #${invoiceId}` : "Audit History"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto">
          {!hasQuery ? (
            <div className="flex flex-col items-center justify-center text-center py-16 space-y-3 text-muted-foreground" data-testid="prompt-enter-id">
              <FileQuestion className="h-10 w-10 text-muted-foreground/40" />
              <p>Enter an invoice ID above to view its audit log.</p>
            </div>
          ) : isLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center space-y-3" data-testid="audit-error">
              <p className="text-destructive">Could not load the audit log for invoice #{invoiceId}.</p>
              <Button variant="outline" size="sm" onClick={handleRetry} data-testid="button-retry-audit">
                Try Again
              </Button>
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 space-y-3 text-muted-foreground" data-testid="audit-empty">
              <History className="h-10 w-10 text-muted-foreground/40" />
              <p>No audit entries found for invoice #{invoiceId}.</p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="audit-timeline">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex gap-4 items-start border-l-2 border-primary/30 pl-4 py-2"
                  data-testid={`audit-entry-${log.id}`}
                >
                  <div className="text-xs text-muted-foreground whitespace-nowrap pt-0.5 w-32 shrink-0">
                    {format(new Date(log.createdAt), "MMM d, yyyy HH:mm")}
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{log.action}</span>
                      <AuditActor
                        actorClerkId={log.actorClerkId}
                        actorName={log.actorName}
                        editorRole={log.editorRole}
                      />
                    </div>
                    {log.fieldName && (
                      <div className="text-xs text-muted-foreground" data-testid={`audit-field-change-${log.id}`}>
                        <span className="font-medium text-foreground" data-testid={`audit-field-name-${log.id}`}>{log.fieldName}:</span>{" "}
                        <span data-testid={`audit-old-value-${log.id}`}>{log.oldValue || "empty"}</span>{" → "}
                        <span data-testid={`audit-new-value-${log.id}`}>{log.newValue || "empty"}</span>
                      </div>
                    )}
                    {log.note && (
                      <div className="text-xs text-muted-foreground italic" data-testid={`audit-note-${log.id}`}>{log.note}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
