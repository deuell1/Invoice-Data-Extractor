import { Construction, Ban, FileOutput, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const futureScope = [
  {
    title: "ERP connector framework",
    body: "Pluggable adapters for common AP targets (NetSuite, SAP, Oracle, QuickBooks, Microsoft Dynamics).",
  },
  {
    title: "Outbound posting",
    body: "Transform an Export Ready invoice into the target system's voucher/bill payload and post it via API, capturing the returned document id.",
  },
  {
    title: "Status reconciliation",
    body: "Receive webhooks or poll to reflect downstream approval, payment, and void status back into the capture system.",
  },
  {
    title: "Master-data sync",
    body: "Replace file-based vendor/PO import with scheduled or event-driven sync from the system of record.",
  },
  {
    title: "Error handling & retries",
    body: "Formal retry/backoff and a dead-letter queue for failed posts, surfaced through the existing exception workflow.",
  },
  {
    title: "Audit & compliance",
    body: "Extend the audit trail to record outbound request and response payloads for each posting attempt.",
  },
];

export function Phase3Placeholder() {
  return (
    <div className="space-y-6" data-testid="page-phase3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
          <Construction className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Phase 3 — Future ERP Integration
          </h1>
          <p className="text-sm text-muted-foreground">
            Planned scope. Not implemented in this release.
          </p>
        </div>
        <Badge
          variant="outline"
          className="ml-auto border-amber-300 text-amber-700 dark:text-amber-400"
          data-testid="badge-phase3-status"
        >
          Placeholder — Not Started
        </Badge>
      </div>

      <Alert data-testid="alert-phase3-boundary">
        <Ban className="h-4 w-4" />
        <AlertTitle>No live integration is performed here</AlertTitle>
        <AlertDescription>
          Phase 2 demonstrates the full Accounts Payable capture lifecycle using
          import/export files only. This screen performs no live action against
          any external accounting system, holds no credentials, and calls no
          external endpoints.
        </AlertDescription>
      </Alert>

      <Card data-testid="card-phase3-boundary">
        <CardHeader>
          <CardTitle className="text-base">Scope boundary</CardTitle>
          <CardDescription>
            What this product intentionally does not do today.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• No real-time posting of invoices to an external accounting system.</p>
          <p>• No bi-directional sync of vendors, POs, or GL data.</p>
          <p>• No external credentials, endpoints, or webhooks are configured or called.</p>
          <p className="text-foreground">
            Export readiness is described only as{" "}
            <span className="font-medium">Export Ready</span>,{" "}
            <span className="font-medium">Exported</span>,{" "}
            <span className="font-medium">Export Failed</span>, or{" "}
            <span className="font-medium">Export Blocked</span>.
          </p>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Candidate scope for Phase 3
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {futureScope.map((item) => (
            <Card key={item.title} data-testid={`card-scope-${item.title}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {item.body}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card data-testid="card-phase3-migration">
        <CardHeader>
          <CardTitle className="text-base">Migration path from Phase 2</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <FileOutput className="h-3 w-3" /> Export Ready engine
            </Badge>
            <ArrowRight className="h-4 w-4" />
            <Badge variant="secondary">Phase 3 posting trigger</Badge>
          </div>
          <p className="mt-3">
            The Phase 2 export-readiness engine already determines which invoices
            are Export Ready. Phase 3 would reuse that same readiness signal as
            its posting trigger, so no rework of the readiness rules is expected.
            File export remains available as a fallback.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
