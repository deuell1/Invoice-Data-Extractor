import { useParams, useLocation } from "wouter";
import { Button } from "@workspace/mission-control-ds/components/ui/button";
import { ArrowLeft, UploadCloud } from "lucide-react";
import { SourceDocumentSummary } from "@/components/source-document-summary";

export function SourceBatch() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();

  if (!id) {
    return <div className="p-8 text-center text-destructive">Invalid file reference.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto w-full mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation("/invoices")} data-testid="button-back">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Invoices
        </Button>
        <Button variant="outline" onClick={() => setLocation("/invoices/new")} data-testid="button-upload-another">
          <UploadCloud className="mr-2 h-4 w-4" />
          Upload Another
        </Button>
      </div>
      <SourceDocumentSummary sourceDocumentId={id} />
    </div>
  );
}
