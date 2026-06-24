import { useState } from "react";
import { useLocation } from "wouter";
import {
  UploadCloud,
  File,
  Loader2,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import {
  useCreateInvoice,
  useRequestUploadUrl,
  useGetInvoice,
  useExtractInvoice,
  getGetInvoiceQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

type Phase = "idle" | "uploading" | "tracking";

const EXTRACTION_POLL_INTERVAL_MS = 1500;

/** Client-side upload guardrails — mirrored server-side as the source of truth. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_UPLOAD_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
];

/** Returns a user-friendly error if the file is unsupported, else null. */
function validateUploadFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The maximum is 25 MB.`;
  }
  const type = file.type || "";
  const isAllowed =
    ALLOWED_UPLOAD_TYPES.includes(type) || /\.(pdf|png|jpe?g|webp|gif)$/i.test(file.name);
  if (!isAllowed) {
    return "Unsupported file type. Upload a PDF or an image (PNG, JPEG, WebP, GIF).";
  }
  return null;
}

type StatusTone = "progress" | "success" | "warning" | "error";

interface FriendlyStatus {
  label: string;
  description: string;
  tone: StatusTone;
  inProgress: boolean;
}

// Map the raw extraction + workflow status onto a single user-facing state.
function deriveStatus(invoice: Invoice | undefined): FriendlyStatus {
  if (!invoice) {
    return {
      label: "Uploaded",
      description: "Your invoice was uploaded. Preparing extraction…",
      tone: "progress",
      inProgress: true,
    };
  }

  if (invoice.extractionStatus === "FAILED") {
    return {
      label: "Extraction Failed",
      description: "We couldn't extract data from this document.",
      tone: "error",
      inProgress: false,
    };
  }

  if (invoice.extractionStatus === "PROCESSING") {
    return {
      label: "Extraction Running",
      description: "Reading the document and extracting invoice fields…",
      tone: "progress",
      inProgress: true,
    };
  }

  if (invoice.extractionStatus === "PENDING" || !invoice.extractionStatus) {
    return {
      label: "Extraction Pending",
      description: "Extraction is queued and will begin shortly…",
      tone: "progress",
      inProgress: true,
    };
  }

  // extractionStatus === "COMPLETED" — route on the workflow status.
  switch (invoice.status) {
    case "EXCEPTION":
      return {
        label: "Exception",
        description: "Extraction finished but the invoice needs attention before approval.",
        tone: "warning",
        inProgress: false,
      };
    case "PENDING_APPROVAL":
      return {
        label: "Pending Approval",
        description: "Extraction finished. The invoice is ready for approval.",
        tone: "success",
        inProgress: false,
      };
    case "PENDING_EXTRACTION":
      return {
        label: "Needs Review",
        description: "Extraction finished. Please review the extracted fields.",
        tone: "warning",
        inProgress: false,
      };
    default:
      return {
        label: "Extraction Complete",
        description: "Extraction finished. You can open the review screen.",
        tone: "success",
        inProgress: false,
      };
  }
}

const toneClasses: Record<StatusTone, string> = {
  progress: "bg-blue-50 text-blue-700 border-blue-200",
  success: "bg-green-50 text-green-700 border-green-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

function StatusIcon({ tone, inProgress }: { tone: StatusTone; inProgress: boolean }) {
  if (inProgress) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (tone === "success") return <CheckCircle2 className="h-5 w-5" />;
  if (tone === "warning") return <AlertTriangle className="h-5 w-5" />;
  if (tone === "error") return <XCircle className="h-5 w-5" />;
  return <ScanLine className="h-5 w-5" />;
}

export function InvoiceIntake() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);

  const requestUploadUrl = useRequestUploadUrl();
  const createInvoice = useCreateInvoice();
  const extractInvoice = useExtractInvoice();

  const { data: invoice } = useGetInvoice(invoiceId ?? 0, {
    query: {
      enabled: invoiceId !== null,
      queryKey: getGetInvoiceQueryKey(invoiceId ?? 0),
      // Poll while extraction is still pending/running.
      refetchInterval: (query) => {
        const es = query.state.data?.extractionStatus;
        return es === "PENDING" || es === "PROCESSING" || !es
          ? EXTRACTION_POLL_INTERVAL_MS
          : false;
      },
    },
  });

  const status = deriveStatus(invoice);
  const documentLabel =
    invoice?.businessDocumentId || invoice?.documentId || (invoiceId ? `#${invoiceId}` : "");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      const validationError = validateUploadFile(selected);
      if (validationError) {
        toast({
          title: "File can't be uploaded",
          description: validationError,
          variant: "destructive",
        });
        e.target.value = "";
        return;
      }
      setFile(selected);
    }
  };

  const resetForm = () => {
    setFile(null);
    setPhase("idle");
    setProgress(0);
    setInvoiceId(null);
  };

  const handleUpload = async () => {
    if (!file) return;

    setPhase("uploading");
    setProgress(10);

    try {
      const uploadData = await requestUploadUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        },
      });

      setProgress(30);

      const uploadRes = await fetch(uploadData.uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!uploadRes.ok) {
        throw new Error(`File upload failed (${uploadRes.status} ${uploadRes.statusText})`);
      }

      setProgress(70);

      // Create the invoice record — this also triggers extraction server-side.
      const created = await createInvoice.mutateAsync({
        data: {
          fileObjectPath: uploadData.objectPath,
          originalFileName: file.name,
        },
      });

      setProgress(100);
      setInvoiceId(created.id);
      setPhase("tracking");

      toast({
        title: "Upload successful",
        description: "Invoice uploaded. Extracting data…",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "There was an error uploading your invoice. Please try again.",
      });
      setPhase("idle");
      setProgress(0);
    }
  };

  const handleRetryExtraction = async () => {
    if (invoiceId === null) return;
    try {
      await extractInvoice.mutateAsync({ id: invoiceId });
      await queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId) });
      toast({ title: "Extraction restarted", description: "Re-running data extraction…" });
    } catch {
      toast({
        variant: "destructive",
        title: "Could not restart extraction",
        description: "Please try again in a moment.",
      });
    }
  };

  // ---- Tracking view -------------------------------------------------------
  if (phase === "tracking" && invoiceId !== null) {
    return (
      <div className="max-w-2xl mx-auto w-full mt-8">
        <Card>
          <CardHeader>
            <CardTitle>Processing Invoice</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span data-testid="text-document-id">Document: {documentLabel}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div
                className={`flex items-start gap-3 rounded-lg border p-4 ${toneClasses[status.tone]}`}
                data-testid="extraction-status"
                data-status={status.label}
              >
                <StatusIcon tone={status.tone} inProgress={status.inProgress} />
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold" data-testid="text-status-label">
                    {status.label}
                  </p>
                  <p className="text-sm opacity-90">{status.description}</p>
                </div>
              </div>

              {status.inProgress && (
                <div className="space-y-2">
                  <Progress value={undefined} className="h-2" data-testid="progress-extraction" />
                  <p className="text-xs text-muted-foreground text-center">
                    You can wait here — this updates automatically.
                  </p>
                </div>
              )}

              {status.tone === "error" && (
                <p className="text-sm text-red-600" data-testid="text-extraction-error">
                  Extraction couldn't be completed for this document. Re-run extraction, or
                  open the review screen to enter the fields manually.
                </p>
              )}

              {/* Next actions, only once extraction settles. */}
              {!status.inProgress && (
                <div className="flex flex-col gap-3">
                  {status.label === "Extraction Failed" ? (
                    <Button
                      onClick={handleRetryExtraction}
                      disabled={extractInvoice.isPending}
                      data-testid="button-retry-extraction"
                    >
                      {extractInvoice.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Re-run Extraction
                    </Button>
                  ) : status.label === "Pending Approval" ? (
                    <Button
                      onClick={() => setLocation("/approvals")}
                      data-testid="button-go-approvals"
                    >
                      Go to Approval Queue
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : status.label === "Exception" ? (
                    <Button
                      onClick={() => setLocation("/exceptions")}
                      data-testid="button-go-exceptions"
                    >
                      Go to Exception Queue
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : null}

                  <Button
                    variant={status.label === "Needs Review" || status.label === "Extraction Complete" ? "default" : "outline"}
                    onClick={() => setLocation(`/invoices/${invoiceId}`)}
                    data-testid="button-open-review"
                  >
                    Open Review
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={resetForm}
                    data-testid="button-upload-another"
                  >
                    Upload Another Invoice
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Upload view ---------------------------------------------------------
  const isUploading = phase === "uploading";

  return (
    <div className="max-w-2xl mx-auto w-full mt-8">
      <Card>
        <CardHeader>
          <CardTitle>Upload Invoice</CardTitle>
          <CardDescription>
            Upload a PDF or image file. Our system will automatically extract the relevant fields.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center hover:bg-muted/50 transition-colors">
              <input
                type="file"
                id="file-upload"
                className="hidden"
                accept="application/pdf,image/jpeg,image/png,image/tiff"
                onChange={handleFileChange}
                disabled={isUploading}
                data-testid="input-file"
              />
              <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center justify-center">
                {file ? (
                  <File className="h-12 w-12 text-primary mb-4" />
                ) : (
                  <UploadCloud className="h-12 w-12 text-muted-foreground mb-4" />
                )}
                <span className="text-sm font-medium">
                  {file ? file.name : "Click to select a file"}
                </span>
                <span className="text-xs text-muted-foreground mt-1">
                  PDF, JPEG, PNG up to 10MB
                </span>
              </label>
            </div>

            {isUploading && (
              <div className="space-y-2" data-testid="upload-status">
                <div className="flex justify-between text-xs">
                  <span>Uploading…</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" data-testid="progress-upload" />
              </div>
            )}

            <div className="flex justify-end gap-4">
              <Button
                variant="outline"
                onClick={() => setLocation("/invoices")}
                disabled={isUploading}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!file || isUploading}
                data-testid="button-upload"
              >
                {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Upload & Process
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
