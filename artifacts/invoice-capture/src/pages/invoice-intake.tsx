import { useState } from "react";
import { useLocation } from "wouter";
import { UploadCloud, File, Loader2, ScanLine } from "lucide-react";
import { useCreateInvoice, useRequestUploadUrl, getInvoice } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

type Phase = "idle" | "uploading" | "extracting";

const EXTRACTION_POLL_INTERVAL_MS = 1500;
const EXTRACTION_MAX_POLLS = 20;

export function InvoiceIntake() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);

  const isUploading = phase !== "idle";

  const requestUploadUrl = useRequestUploadUrl();
  const createInvoice = useCreateInvoice();

  // Poll the invoice until extraction completes (or fails), then navigate.
  const waitForExtraction = async (invoiceId: number): Promise<void> => {
    for (let i = 0; i < EXTRACTION_MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, EXTRACTION_POLL_INTERVAL_MS));
      try {
        const inv = await getInvoice(invoiceId);
        if (inv.extractionStatus === "COMPLETED") {
          toast({
            title: "Extraction complete",
            description: "Invoice data was extracted. Please review.",
          });
          return;
        }
        if (inv.extractionStatus === "FAILED") {
          toast({
            variant: "destructive",
            title: "Extraction failed",
            description: "You can retry extraction from the review screen.",
          });
          return;
        }
      } catch {
        // transient error — keep polling
      }
    }
    // Timed out — still navigate so the user can retry from review.
    toast({
      title: "Still processing",
      description: "Extraction is taking longer than expected. Opening review…",
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setPhase("uploading");
    setProgress(10);

    try {
      // 1. Request presigned upload URL
      const uploadData = await requestUploadUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        },
      });

      setProgress(30);

      // 2. PUT file directly to GCS presigned URL
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

      // 3. Create invoice record
      const invoice = await createInvoice.mutateAsync({
        data: {
          fileObjectPath: uploadData.objectPath,
          originalFileName: file.name,
        },
      });

      setProgress(85);

      toast({
        title: "Upload Successful",
        description: "Invoice uploaded. Extracting data…",
      });

      // 4. Wait for background extraction to finish, then open review.
      setPhase("extracting");
      await waitForExtraction(invoice.id);
      setProgress(100);

      setTimeout(() => {
        setLocation(`/invoices/${invoice.id}`);
      }, 400);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: "There was an error uploading your invoice. Please try again.",
      });
      setPhase("idle");
      setProgress(0);
    }
  };

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
              <div className="space-y-2" data-testid="extraction-status">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    {phase === "extracting" ? (
                      <>
                        <ScanLine className="h-3.5 w-3.5 animate-pulse text-primary" />
                        Extracting invoice data…
                      </>
                    ) : (
                      "Uploading…"
                    )}
                  </span>
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
                {phase === "extracting" ? "Extracting…" : "Upload & Process"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
