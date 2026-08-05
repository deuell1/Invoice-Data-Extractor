import { Link } from "wouter";
import { FileText, CheckSquare, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo + name */}
        <div className="space-y-3">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg">
              <FileText className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">Invoice Capture</h1>
          <p className="text-slate-400 text-base">
            AP processing platform for clerks and managers. Sign in to access your queue.
          </p>
        </div>

        {/* Feature bullets */}
        <div className="grid grid-cols-2 gap-3 text-left">
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-1">
            <AlertCircle className="h-5 w-5 text-amber-400" />
            <p className="text-sm font-medium text-white">Exception Queue</p>
            <p className="text-xs text-slate-400">Triage and resolve flagged invoices</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-1">
            <CheckSquare className="h-5 w-5 text-green-400" />
            <p className="text-sm font-medium text-white">Approval Queue</p>
            <p className="text-xs text-slate-400">Review and approve pending invoices</p>
          </div>
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <Link href="/sign-in">
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 text-base font-semibold">
              Sign in
            </Button>
          </Link>
          <p className="text-xs text-slate-500">
            Need access? Contact your AP system administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
