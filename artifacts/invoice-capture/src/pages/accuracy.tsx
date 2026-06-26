import { useState } from "react";
import {
  useListAccuracyRuns,
  getListAccuracyRunsQueryKey,
  useCreateAccuracyRun,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Target, Plus, Info } from "lucide-react";
import { format } from "date-fns";

const initialForm = {
  testPackName: "",
  invoicesTested: "",
  fieldsTested: "",
  correctFields: "",
  incorrectFields: "",
  missingFields: "",
  overallAccuracy: "",
  threshold: "",
  passed: "UNSET",
  reportRef: "",
};

function RecordRunDialog({ onRecorded }: { onRecorded: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const createRun = useCreateAccuracyRun();

  const set = (key: keyof typeof form, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    if (!form.testPackName.trim()) {
      toast({ variant: "destructive", title: "Missing field", description: "Test pack name is required." });
      return;
    }
    try {
      await createRun.mutateAsync({
        data: {
          testPackName: form.testPackName.trim(),
          invoicesTested: parseInt(form.invoicesTested || "0", 10),
          fieldsTested: parseInt(form.fieldsTested || "0", 10),
          correctFields: parseInt(form.correctFields || "0", 10),
          incorrectFields: parseInt(form.incorrectFields || "0", 10),
          missingFields: parseInt(form.missingFields || "0", 10),
          overallAccuracy: form.overallAccuracy ? parseFloat(form.overallAccuracy) : null,
          threshold: form.threshold ? parseFloat(form.threshold) : null,
          passed: form.passed === "UNSET" ? null : form.passed === "PASS",
          reportRef: form.reportRef.trim() || null,
        },
      });
      toast({ title: "Run recorded", description: "Labeled accuracy run saved." });
      setForm(initialForm);
      setOpen(false);
      onRecorded();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e?.data?.error || "Failed to record accuracy run.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-record-run">
          <Plus className="mr-2 h-4 w-4" />
          Record Run
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Accuracy Run</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Records the measured result of a labeled test pack. The system stores exactly what you
            enter — it does not compute or invent accuracy numbers.
          </p>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label className="text-xs">Test Pack Name *</Label>
            <Input
              value={form.testPackName}
              onChange={(e) => set("testPackName", e.target.value)}
              placeholder="e.g. Q1 labeled pack v2"
              data-testid="input-testPackName"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Invoices Tested</Label>
              <Input type="number" value={form.invoicesTested} onChange={(e) => set("invoicesTested", e.target.value)} data-testid="input-invoicesTested" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fields Tested</Label>
              <Input type="number" value={form.fieldsTested} onChange={(e) => set("fieldsTested", e.target.value)} data-testid="input-fieldsTested" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Correct</Label>
              <Input type="number" value={form.correctFields} onChange={(e) => set("correctFields", e.target.value)} data-testid="input-correctFields" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Incorrect</Label>
              <Input type="number" value={form.incorrectFields} onChange={(e) => set("incorrectFields", e.target.value)} data-testid="input-incorrectFields" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Missing</Label>
              <Input type="number" value={form.missingFields} onChange={(e) => set("missingFields", e.target.value)} data-testid="input-missingFields" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Overall Accuracy (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.overallAccuracy}
                onChange={(e) => set("overallAccuracy", e.target.value)}
                placeholder="optional"
                data-testid="input-overallAccuracy"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Threshold (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.threshold}
                onChange={(e) => set("threshold", e.target.value)}
                placeholder="optional"
                data-testid="input-threshold"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Passed</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={form.passed}
                onChange={(e) => set("passed", e.target.value)}
                data-testid="select-passed"
              >
                <option value="UNSET">Not recorded</option>
                <option value="PASS">Pass</option>
                <option value="FAIL">Fail</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Report Ref</Label>
              <Input
                value={form.reportRef}
                onChange={(e) => set("reportRef", e.target.value)}
                placeholder="optional"
                data-testid="input-reportRef"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createRun.isPending} data-testid="button-save-run">
            {createRun.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PassedBadge({ passed }: { passed: boolean | null | undefined }) {
  if (passed === null || passed === undefined) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  return passed ? (
    <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600 text-white">Pass</Badge>
  ) : (
    <Badge variant="destructive">Fail</Badge>
  );
}

export function AccuracyReporting() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListAccuracyRuns({
    query: { queryKey: getListAccuracyRunsQueryKey() },
  });

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: getListAccuracyRunsQueryKey() });

  const runs = data?.data ?? [];
  const notMeasured = !data?.measured || runs.length === 0;

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6" />
            Extraction Accuracy
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Results of labeled test pack measurement runs</p>
        </div>
        <RecordRunDialog onRecorded={refetch} />
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="shrink-0">
          <CardTitle>Accuracy Runs</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          {isLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : notMeasured ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-6 space-y-4" data-testid="not-measured">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <Info className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold">Not measured</p>
                <p className="text-sm text-muted-foreground max-w-md">
                  No labeled test pack result has been recorded yet. Extraction accuracy is only
                  reported from measured runs against a labeled ground-truth pack — no numbers are
                  estimated or invented. Use “Record Run” to enter a measured result.
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                <TableRow>
                  <TableHead>Run Date</TableHead>
                  <TableHead>Test Pack</TableHead>
                  <TableHead className="text-center">Invoices</TableHead>
                  <TableHead className="text-center">Fields</TableHead>
                  <TableHead className="text-center">Correct</TableHead>
                  <TableHead className="text-center">Incorrect</TableHead>
                  <TableHead className="text-center">Missing</TableHead>
                  <TableHead className="text-right">Overall</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead className="text-center">Passed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(run.runDate), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="font-medium">{run.testPackName}</TableCell>
                    <TableCell className="text-center">{run.invoicesTested}</TableCell>
                    <TableCell className="text-center">{run.fieldsTested}</TableCell>
                    <TableCell className="text-center text-emerald-600">{run.correctFields}</TableCell>
                    <TableCell className="text-center text-destructive">{run.incorrectFields}</TableCell>
                    <TableCell className="text-center text-amber-600">{run.missingFields}</TableCell>
                    <TableCell className="text-right">
                      {run.overallAccuracy != null ? (
                        <span className="font-semibold">{run.overallAccuracy.toFixed(2)}%</span>
                      ) : (
                        <span className="text-muted-foreground text-xs italic">Not measured</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {run.threshold != null ? `${run.threshold.toFixed(2)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-center"><PassedBadge passed={run.passed} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
