import { useEffect, useState } from "react";
import {
  useGetSettings,
  getGetSettingsQueryKey,
  useUpdateSettings,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings as SettingsIcon, Save } from "lucide-react";

type FormState = {
  extractionConfidenceThreshold: string;
  vendorMatchThreshold: string;
  tieOutPassTolerance: string;
  tieOutWarningTolerance: string;
  defaultPageSize: string;
  defaultExportFormat: string;
  updatedBy: string;
};

const emptyForm: FormState = {
  extractionConfidenceThreshold: "",
  vendorMatchThreshold: "",
  tieOutPassTolerance: "",
  tieOutWarningTolerance: "",
  defaultPageSize: "",
  defaultExportFormat: "CSV",
  updatedBy: "",
};

export function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });
  const updateSettings = useUpdateSettings();

  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (settings) {
      setForm({
        extractionConfidenceThreshold: settings.extractionConfidenceThreshold?.toString() ?? "",
        vendorMatchThreshold: settings.vendorMatchThreshold?.toString() ?? "",
        tieOutPassTolerance: settings.tieOutPassTolerance?.toString() ?? "",
        tieOutWarningTolerance: settings.tieOutWarningTolerance?.toString() ?? "",
        defaultPageSize: settings.defaultPageSize?.toString() ?? "",
        defaultExportFormat: settings.defaultExportFormat ?? "CSV",
        updatedBy: "",
      });
    }
  }, [settings]);

  const set = (key: keyof FormState, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        data: {
          extractionConfidenceThreshold: form.extractionConfidenceThreshold
            ? parseFloat(form.extractionConfidenceThreshold)
            : null,
          vendorMatchThreshold: form.vendorMatchThreshold
            ? parseFloat(form.vendorMatchThreshold)
            : null,
          tieOutPassTolerance: form.tieOutPassTolerance
            ? parseFloat(form.tieOutPassTolerance)
            : null,
          tieOutWarningTolerance: form.tieOutWarningTolerance
            ? parseFloat(form.tieOutWarningTolerance)
            : null,
          defaultPageSize: form.defaultPageSize
            ? parseInt(form.defaultPageSize, 10)
            : null,
          defaultExportFormat: form.defaultExportFormat || null,
          updatedBy: form.updatedBy.trim() || "ap.clerk",
        },
      });
      toast({ title: "Settings saved", description: "Configuration updated successfully." });
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e?.data?.error || "Failed to update settings.",
      });
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-6 w-6" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Internal configuration thresholds and defaults</p>
      </div>

      <div className="max-w-2xl w-full">
        {isLoading ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Thresholds</CardTitle>
                <CardDescription>Confidence and tie-out tolerances used by validation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="confidence" className="text-sm">Extraction Confidence Threshold (%)</Label>
                  <Input
                    id="confidence"
                    type="number"
                    step="0.1"
                    value={form.extractionConfidenceThreshold}
                    onChange={(e) => set("extractionConfidenceThreshold", e.target.value)}
                    data-testid="input-extractionConfidenceThreshold"
                  />
                  <p className="text-xs text-muted-foreground">Safe default: 85</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="vendorMatch" className="text-sm">Vendor Match Threshold (%)</Label>
                  <Input
                    id="vendorMatch"
                    type="number"
                    step="0.1"
                    value={form.vendorMatchThreshold}
                    onChange={(e) => set("vendorMatchThreshold", e.target.value)}
                    data-testid="input-vendorMatchThreshold"
                  />
                  <p className="text-xs text-muted-foreground">Safe default: 85</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="tieOutPass" className="text-sm">Tie-Out Pass Tolerance ($)</Label>
                    <Input
                      id="tieOutPass"
                      type="number"
                      step="0.01"
                      value={form.tieOutPassTolerance}
                      onChange={(e) => set("tieOutPassTolerance", e.target.value)}
                      data-testid="input-tieOutPassTolerance"
                    />
                    <p className="text-xs text-muted-foreground">Safe default: 0.01</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tieOutWarning" className="text-sm">Tie-Out Warning Tolerance ($)</Label>
                    <Input
                      id="tieOutWarning"
                      type="number"
                      step="0.01"
                      value={form.tieOutWarningTolerance}
                      onChange={(e) => set("tieOutWarningTolerance", e.target.value)}
                      data-testid="input-tieOutWarningTolerance"
                    />
                    <p className="text-xs text-muted-foreground">Safe default: 0.05</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Defaults</CardTitle>
                <CardDescription>Default list and export behavior.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="pageSize" className="text-sm">Default Page Size</Label>
                    <Input
                      id="pageSize"
                      type="number"
                      value={form.defaultPageSize}
                      onChange={(e) => set("defaultPageSize", e.target.value)}
                      data-testid="input-defaultPageSize"
                    />
                    <p className="text-xs text-muted-foreground">Safe default: 20</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="exportFormat" className="text-sm">Default Export Format</Label>
                    <Select
                      value={form.defaultExportFormat}
                      onValueChange={(v) => set("defaultExportFormat", v)}
                    >
                      <SelectTrigger id="exportFormat" data-testid="select-defaultExportFormat">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CSV">CSV</SelectItem>
                        <SelectItem value="XLSX">XLSX</SelectItem>
                        <SelectItem value="JSON">JSON</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Safe default: CSV</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="updatedBy" className="text-sm">Updated By</Label>
                  <Input
                    id="updatedBy"
                    value={form.updatedBy}
                    onChange={(e) => set("updatedBy", e.target.value)}
                    placeholder="ap.clerk"
                    data-testid="input-updatedBy"
                  />
                  <p className="text-xs text-muted-foreground">Free-text actor name (defaults to "ap.clerk").</p>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateSettings.isPending} data-testid="button-save-settings">
                {updateSettings.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Settings
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
