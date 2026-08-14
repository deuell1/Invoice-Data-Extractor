import { Link } from "wouter";
import { FileText, CheckSquare, AlertCircle } from "lucide-react";
import { Button } from "@workspace/mission-control-ds/components/ui/button";

export function HomePage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo + name */}
        <div className="space-y-3">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
              <FileText className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-foreground">Invoice Capture</h1>
          <p className="text-muted-foreground text-base">
            AP processing platform for clerks and managers. Sign in to access your queue.
          </p>
        </div>

        {/* Feature bullets */}
        <div className="grid grid-cols-2 gap-3 text-left">
          <div className="bg-card border border-border rounded-lg p-4 space-y-1">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm font-medium text-foreground">Exception Queue</p>
            <p className="text-xs text-muted-foreground">Triage and resolve flagged invoices</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 space-y-1">
            <CheckSquare className="h-5 w-5 text-accent" />
            <p className="text-sm font-medium text-foreground">Approval Queue</p>
            <p className="text-xs text-muted-foreground">Review and approve pending invoices</p>
          </div>
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <Link href="/sign-in">
            <Button className="w-full h-11 text-base font-semibold">
              Sign in
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground">
            Need access? Contact your AP system administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
