import { useState } from "react";
import {
  useListVendors,
  useCreateVendor,
  useImportVendors,
  useUpdateVendor,
} from "@workspace/api-client-react";
import type { Vendor } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Upload, Users, Search, AlertCircle, CheckCircle2, Pencil, Ban, X } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";

type ParsedVendorRow = {
  vendorCode: string;
  vendorName: string;
  taxId: string | null;
  contactEmail: string | null;
  error?: string;
};

export function VendorAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: vendorsRes, isLoading } = useListVendors({ search, limit: 100 });
  const createVendor = useCreateVendor();
  const importVendors = useImportVendors();
  const updateVendor = useUpdateVendor();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newVendor, setNewVendor] = useState({ vendorCode: "", vendorName: "", taxId: "", contactEmail: "" });

  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [editForm, setEditForm] = useState({
    vendorName: "",
    aliases: [] as string[],
    onHold: false,
    isActive: true,
    paymentTerms: "",
    termsDays: "",
    address: "",
  });
  const [aliasDraft, setAliasDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const openEdit = (vendor: Vendor) => {
    setEditVendor(vendor);
    setEditError(null);
    setAliasDraft("");
    setEditForm({
      vendorName: vendor.vendorName,
      aliases: vendor.aliases ?? [],
      onHold: Boolean(vendor.onHold),
      isActive: vendor.isActive,
      paymentTerms: vendor.paymentTerms ?? "",
      termsDays: vendor.termsDays != null ? String(vendor.termsDays) : "",
      address: vendor.address ?? "",
    });
  };

  const addAlias = () => {
    const value = aliasDraft.trim();
    if (!value) return;
    setEditForm((prev) =>
      prev.aliases.some((a) => a.toLowerCase() === value.toLowerCase())
        ? prev
        : { ...prev, aliases: [...prev.aliases, value] }
    );
    setAliasDraft("");
  };

  const removeAlias = (alias: string) => {
    setEditForm((prev) => ({ ...prev, aliases: prev.aliases.filter((a) => a !== alias) }));
  };

  const handleAliasKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAlias();
    } else if (e.key === "Backspace" && aliasDraft === "" && editForm.aliases.length > 0) {
      removeAlias(editForm.aliases[editForm.aliases.length - 1]);
    }
  };

  const handleSaveEdit = async () => {
    if (!editVendor) return;
    setEditError(null);

    if (editForm.vendorName.trim().length === 0) {
      setEditError("Vendor name cannot be blank.");
      return;
    }

    const termsDaysTrimmed = editForm.termsDays.trim();
    let termsDays: number | null = null;
    if (termsDaysTrimmed.length > 0) {
      const parsed = Number(termsDaysTrimmed);
      if (!Number.isInteger(parsed) || parsed < 0) {
        setEditError("Default terms days must be a whole number of 0 or more.");
        return;
      }
      termsDays = parsed;
    }

    // Fold any text still in the alias input into the saved list.
    const pendingAlias = aliasDraft.trim();
    const aliases = Array.from(
      new Set(
        [...editForm.aliases, ...(pendingAlias ? [pendingAlias] : [])]
          .map((a) => a.trim())
          .filter((a) => a.length > 0)
      )
    );

    try {
      await updateVendor.mutateAsync({
        id: editVendor.id,
        data: {
          vendorName: editForm.vendorName.trim(),
          aliases,
          onHold: editForm.onHold,
          isActive: editForm.isActive,
          paymentTerms: editForm.paymentTerms.trim() || null,
          termsDays,
          address: editForm.address.trim() || null,
        },
      });
      toast({ title: "Vendor Updated", description: `${editForm.vendorName.trim()} saved successfully.` });
      setEditVendor(null);
      setAliasDraft("");
      queryClient.invalidateQueries();
    } catch (e: any) {
      const message =
        e?.status === 400
          ? "Please check the vendor details — the name cannot be blank."
          : "Failed to update vendor. Please try again.";
      setEditError(message);
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  const [importPreview, setImportPreview] = useState<ParsedVendorRow[] | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null);

  const handleAddVendor = async () => {
    if (!newVendor.vendorCode || !newVendor.vendorName) return;
    try {
      await createVendor.mutateAsync({ data: newVendor });
      toast({ title: "Vendor Created", description: `${newVendor.vendorName} added successfully.` });
      setIsAddOpen(false);
      setNewVendor({ vendorCode: "", vendorName: "", taxId: "", contactEmail: "" });
      queryClient.invalidateQueries();
    } catch (e: any) {
      const status = e?.status;
      if (status === 409) {
        toast({ variant: "destructive", title: "Duplicate Vendor Code", description: `Vendor code "${newVendor.vendorCode}" already exists. Please use a unique code.` });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to create vendor" });
      }
    }
  };

  const parseCsv = (text: string): ParsedVendorRow[] => {
    const lines = text.split('\n');
    return lines.slice(1)
      .filter(line => line.trim().length > 0)
      .map(line => {
        const [vendorCode, vendorName, taxId, contactEmail] = line.split(',');
        const row: ParsedVendorRow = {
          vendorCode: vendorCode?.trim() || "",
          vendorName: vendorName?.trim() || "",
          taxId: taxId?.trim() || null,
          contactEmail: contactEmail?.trim() || null,
        };
        if (!row.vendorCode) row.error = "Missing vendor code";
        else if (!row.vendorName) row.error = "Missing vendor name";
        return row;
      });
  };

  const handleCsvFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast({ variant: "destructive", title: "Empty File", description: "No valid rows found in CSV." });
        return;
      }
      setImportPreview(rows);
      setImportResult(null);
      setIsImportOpen(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    const validVendors = importPreview
      .filter(row => !row.error)
      .map(({ vendorCode, vendorName, taxId, contactEmail }) => ({
        vendorCode, vendorName, taxId, contactEmail,
      }));

    if (validVendors.length === 0) {
      toast({ variant: "destructive", title: "No Valid Rows", description: "All rows have errors. Fix the CSV and try again." });
      return;
    }

    try {
      const res = await importVendors.mutateAsync({ data: { vendors: validVendors } });
      setImportResult(res);
      queryClient.invalidateQueries();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Import Error", description: e.message || "Failed to import vendors" });
    }
  };

  const validRows = importPreview?.filter(r => !r.error) ?? [];
  const invalidRows = importPreview?.filter(r => r.error) ?? [];

  return (
    <div className="space-y-6 flex flex-col h-full overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" />
            Vendor Administration
          </h1>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <input
              type="file"
              accept=".csv"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleCsvFileSelect}
              data-testid="input-csv-import"
            />
            <Button variant="outline" data-testid="button-import">
              <Upload className="mr-2 h-4 w-4" />
              Import CSV
            </Button>
          </div>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-vendor">
                <Plus className="mr-2 h-4 w-4" />
                Add Vendor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Vendor</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Vendor Code *</Label>
                  <Input
                    value={newVendor.vendorCode}
                    onChange={e => setNewVendor(prev => ({ ...prev, vendorCode: e.target.value }))}
                    data-testid="input-vendor-code"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vendor Name *</Label>
                  <Input
                    value={newVendor.vendorName}
                    onChange={e => setNewVendor(prev => ({ ...prev, vendorName: e.target.value }))}
                    data-testid="input-vendor-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tax ID</Label>
                  <Input
                    value={newVendor.taxId}
                    onChange={e => setNewVendor(prev => ({ ...prev, taxId: e.target.value }))}
                    data-testid="input-vendor-tax"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contact Email</Label>
                  <Input
                    type="email"
                    value={newVendor.contactEmail}
                    onChange={e => setNewVendor(prev => ({ ...prev, contactEmail: e.target.value }))}
                    data-testid="input-vendor-email"
                  />
                </div>
                <Button
                  className="w-full mt-4"
                  onClick={handleAddVendor}
                  disabled={!newVendor.vendorCode || !newVendor.vendorName || createVendor.isPending}
                  data-testid="button-save-vendor"
                >
                  {createVendor.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Vendor"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="py-3 px-4 shrink-0 bg-muted/30 border-b">
          <div className="relative w-72">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vendors..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead>Tax ID</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : vendorsRes?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No vendors found.
                  </TableCell>
                </TableRow>
              ) : (
                vendorsRes?.data?.map((vendor) => (
                  <TableRow
                    key={vendor.id}
                    data-testid={`row-vendor-${vendor.id}`}
                    className={
                      vendor.onHold
                        ? "bg-destructive/5 hover:bg-destructive/10"
                        : !vendor.isActive
                        ? "opacity-60"
                        : undefined
                    }
                  >
                    <TableCell className="font-medium">{vendor.vendorCode}</TableCell>
                    <TableCell>{vendor.vendorName}</TableCell>
                    <TableCell className="max-w-[180px]">
                      {vendor.aliases && vendor.aliases.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {vendor.aliases.map((a: string) => (
                            <Badge key={a} variant="secondary" className="text-xs font-normal">{a}</Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{vendor.taxId || "—"}</TableCell>
                    <TableCell>{vendor.contactEmail || "—"}</TableCell>
                    <TableCell>
                      {vendor.onHold ? (
                        <Badge variant="destructive" className="text-xs gap-1" data-testid={`status-vendor-${vendor.id}`}>
                          <Ban className="h-3 w-3" />
                          On Hold
                        </Badge>
                      ) : (
                        <div className="flex items-center" data-testid={`status-vendor-${vendor.id}`}>
                          <div className={`h-2 w-2 rounded-full mr-2 ${vendor.isActive ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                          {vendor.isActive ? 'Active' : 'Inactive'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {format(new Date(vendor.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(vendor)}
                        data-testid={`button-edit-vendor-${vendor.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editVendor} onOpenChange={(open) => { if (!open) { setEditVendor(null); setEditError(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Vendor{editVendor ? ` — ${editVendor.vendorCode}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Vendor Name *</Label>
              <Input
                value={editForm.vendorName}
                onChange={(e) => setEditForm((prev) => ({ ...prev, vendorName: e.target.value }))}
                placeholder="Acme Corporation"
                data-testid="input-edit-name"
              />
            </div>

            <div className="space-y-2">
              <Label>Aliases</Label>
              <div className="flex flex-wrap gap-1.5 rounded-md border px-2 py-2 min-h-[42px]">
                {editForm.aliases.map((alias) => (
                  <Badge key={alias} variant="secondary" className="gap-1 font-normal" data-testid={`badge-alias-${alias}`}>
                    {alias}
                    <button
                      type="button"
                      onClick={() => removeAlias(alias)}
                      className="ml-0.5 rounded-sm hover:text-destructive focus:outline-none"
                      aria-label={`Remove alias ${alias}`}
                      data-testid={`button-remove-alias-${alias}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <input
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value)}
                  onKeyDown={handleAliasKeyDown}
                  onBlur={addAlias}
                  placeholder={editForm.aliases.length === 0 ? "Type an alias and press Enter" : "Add another…"}
                  className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  data-testid="input-edit-alias"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Alternate names used to match this vendor during extraction. Press Enter or comma to add; click the × to remove.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Default Payment Terms</Label>
                <Input
                  value={editForm.paymentTerms}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, paymentTerms: e.target.value }))}
                  placeholder="e.g. Net 30"
                  data-testid="input-edit-payment-terms"
                />
              </div>
              <div className="space-y-2">
                <Label>Default Terms Days</Label>
                <Input
                  type="number"
                  min={0}
                  value={editForm.termsDays}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, termsDays: e.target.value }))}
                  placeholder="e.g. 30"
                  data-testid="input-edit-terms-days"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Remit-To Address</Label>
              <Input
                value={editForm.address}
                onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="Street, City, State ZIP"
                data-testid="input-edit-address"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label className="cursor-pointer">On Hold</Label>
                <p className="text-xs text-muted-foreground">Invoices for held vendors route to exceptions.</p>
              </div>
              <Switch
                checked={editForm.onHold}
                onCheckedChange={(v) => setEditForm((prev) => ({ ...prev, onHold: v }))}
                data-testid="switch-edit-onhold"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label className="cursor-pointer">Active</Label>
                <p className="text-xs text-muted-foreground">Inactive vendors cannot be matched and route to exceptions.</p>
              </div>
              <Switch
                checked={editForm.isActive}
                onCheckedChange={(v) => setEditForm((prev) => ({ ...prev, isActive: v }))}
                data-testid="switch-edit-active"
              />
            </div>

            {editError && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="text-edit-error">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {editError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditVendor(null); setEditError(null); }}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={updateVendor.isPending} data-testid="button-save-edit-vendor">
              {updateVendor.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportOpen} onOpenChange={(open) => { if (!open) { setIsImportOpen(false); setImportPreview(null); setImportResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Vendors — Preview</DialogTitle>
            <p className="text-sm text-muted-foreground">{importFileName}</p>
          </DialogHeader>

          {!importResult ? (
            <>
              <div className="space-y-3">
                <div className="flex gap-3 text-sm">
                  <span className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {validRows.length} valid
                  </span>
                  {invalidRows.length > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      {invalidRows.length} with errors (will be skipped)
                    </span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Tax ID</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview?.map((row, i) => (
                        <TableRow key={i} className={row.error ? "bg-destructive/5" : ""}>
                          <TableCell className="font-medium">{row.vendorCode || <span className="text-muted-foreground italic">empty</span>}</TableCell>
                          <TableCell>{row.vendorName || <span className="text-muted-foreground italic">empty</span>}</TableCell>
                          <TableCell>{row.taxId || "—"}</TableCell>
                          <TableCell>{row.contactEmail || "—"}</TableCell>
                          <TableCell>
                            {row.error
                              ? <Badge variant="destructive" className="text-xs">{row.error}</Badge>
                              : <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">OK</Badge>
                            }
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsImportOpen(false); setImportPreview(null); }}>
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmImport}
                  disabled={validRows.length === 0 || importVendors.isPending}
                  data-testid="button-confirm-import"
                >
                  {importVendors.isPending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing…</>
                    : `Import ${validRows.length} Vendor${validRows.length !== 1 ? "s" : ""}`
                  }
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-4 py-2">
                <div className="flex gap-6 justify-center">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-emerald-600">{importResult.inserted}</div>
                    <div className="text-sm text-muted-foreground">Imported</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-amber-500">{importResult.skipped}</div>
                    <div className="text-sm text-muted-foreground">Skipped (duplicate code)</div>
                  </div>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-destructive">Errors:</p>
                    {importResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-destructive bg-destructive/5 rounded px-2 py-1">{err}</p>
                    ))}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => { setIsImportOpen(false); setImportPreview(null); setImportResult(null); }}>
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
