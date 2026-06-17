import { useState } from "react";
import { useLocation } from "wouter";
import { UploadCloud, File, Loader2 } from "lucide-react";
import { useCreateInvoice, useRequestUploadUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

export function InvoiceIntake() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const requestUploadUrl = useRequestUploadUrl();
  const createInvoice = useCreateInvoice();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
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

      setProgress(100);

      toast({
        title: "Upload Successful",
        description: "Invoice has been uploaded and queued for extraction.",
      });

      setTimeout(() => {
        setLocation(`/invoices/${invoice.id}`);
      }, 500);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: "There was an error uploading your invoice. Please try again.",
      });
      setIsUploading(false);
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
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span>Uploading...</span>
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
