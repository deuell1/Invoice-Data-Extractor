import { useState } from "react";
import { useLocation } from "wouter";
import {
  UploadCloud,
  File,
  Loader2,
} from "lucide-react";
import {
  useCreateSourceDocument,
  useRequestUploadUrl,
} from "@workspace/api-client-react";
import { Button } from "@workspace/mission-control-ds/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/mission-control-ds/components/ui/card";
import { Progress } from "@workspace/mission-control-ds/components/ui/progress";
import { useToast } from "@workspace/mission-control-ds/hooks/use-toast";
import { SourceDocumentSummary } from "@/components/source-document-summary";
import { hashFileSha256Hex } from "@/lib/utils";

type Phase = "idle" | "uploading" | "tracking";

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

export function InvoiceIntake() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [sourceDocumentId, setSourceDocumentId] = useState<number | null>(null);

  const requestUploadUrl = useRequestUploadUrl();
  const createSourceDocument = useCreateSourceDocument();

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
    setSourceDocumentId(null);
  };

  const handleUpload = async () => {
    if (!file) return;

    setPhase("uploading");
    setProgress(10);

    try {
      // Hash and presigned-URL request are independent — run in parallel.
      // The PUT and createSourceDocument steps are unchanged; fileHash just
      // needs to be ready before the createSourceDocument call below.
      const [uploadData, fileHash] = await Promise.all([
        requestUploadUrl.mutateAsync({
          data: {
            name: file.name,
            size: file.size,
            contentType: file.type || "application/octet-stream",
          },
        }),
        hashFileSha256Hex(file),
      ]);

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

      // Create the source document — this triggers detection + per-invoice
      // extraction server-side (one file may contain several invoices).
      const created = await createSourceDocument.mutateAsync({
        data: {
          fileObjectPath: uploadData.objectPath,
          originalFileName: file.name,
          contentType: file.type || null,
          fileHash,
        },
      });

      setProgress(100);
      setSourceDocumentId(created.source.id);
      setPhase("tracking");

      toast({
        title: "Upload successful",
        description: "File uploaded. Detecting invoices…",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "There was an error uploading your file. Please try again.",
      });
      setPhase("idle");
      setProgress(0);
    }
  };

  // ---- Tracking view -------------------------------------------------------
  if (phase === "tracking" && sourceDocumentId !== null) {
    return (
      <div className="max-w-2xl mx-auto w-full mt-8 space-y-4">
        <SourceDocumentSummary sourceDocumentId={sourceDocumentId} />
        <div className="flex justify-end">
          <Button variant="ghost" onClick={resetForm} data-testid="button-upload-another">
            Upload Another File
          </Button>
        </div>
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
