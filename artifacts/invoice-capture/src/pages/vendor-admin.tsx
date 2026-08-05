import { useState, useEffect } from "react";
import { useActorName } from "@/hooks/use-actor";
import { Link } from "wouter";
import {
  useListVendors,
  useCreateVendor,
  useImportVendors,
  getListVendorsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Plus, Upload, Users, Search, AlertCircle,
  AlertTriangle, ExternalLink, Download,
} from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type StatusFilter = "all" | "active" | "inactive" | "onhold";

export function VendorAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Filters ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [requiresPOFilter, setRequiresPOFilter] = useState(false);
  const [missingApEmailFilter, setMissingApEmailFilter] = useState(false);
  const [missingTermsFilter, setMissingTermsFilter] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const queryParams = {
    search: search || undefined,
    limit: LIMIT,
    page,
    isActive: statusFilter === "active" ? true : statusFilter === "inactive" ? false : undefined,
    onHold: statusFilter === "onhold" ? true : undefined,
    requiresPO: requiresPOFilter ? true : undefined,
    missingApEmail: missingApEmailFilter ? true : undefined,
    missingPaymentTerms: missingTermsFilter ? true : undefined,
  };

  const { data: vendorsRes, isLoading } = useListVendors(queryParams);
  const vendors = vendorsRes?.data ?? [];
  const total = vendorsRes?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const createVendor = useCreateVendor();
  const importVendors = useImportVendors();
  const actorName = useActorName();

  // ── Add Vendor dialog ──────────────────────────────────────────────────────
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newVendor, setNewVendor] = useState({
    vendorCode: "", vendorName: "", legalName: "", dba: "",
    taxId: "", apEmail: "", contactEmail: "",
    paymentTerms: "", termsDays: "", currency: "",
    vendorCategory: "", vendorType: "", notes: "", actor: "",
  });

  // Pre-fill actor from authenticated identity when Clerk user loads
  useEffect(() => {
    if (actorName) {
      setNewVendor((v) => (v.actor ? v : { ...v, actor: actorName }));
    }
  }, [actorName]);
  const [addError, setAddError] = useState<string | null>(null);

  const handleAdd = async () => {
    setAddError(null);
    if (!newVendor.vendorCode.trim() || !newVendor.vendorName.trim()) {
      setAddError("Vendor code and name are required");
      return;
    }
    if (!newVendor.actor.trim()) {
      setAddError("Your name (actor) is required to create a vendor");
      return;
    }
    const termsDaysNum = newVendor.termsDays.trim() ? parseInt(newVendor.termsDays.trim(), 10) : undefined;
    if (newVendor.termsDays.trim() && (isNaN(termsDaysNum!) || termsDaysNum! < 0)) {
      setAddError("Terms days must be a non-negative number");
      return;
    }
    try {
      await createVendor.mutateAsync({
        data: {
          vendorCode: newVendor.vendorCode.trim(),
          vendorName: newVendor.vendorName.trim(),
          legalName: newVendor.legalName.trim() || undefined,
          dba: newVendor.dba.trim() || undefined,
          taxId: newVendor.taxId.trim() || undefined,
          apEmail: newVendor.apEmail.trim() || undefined,
          contactEmail: newVendor.contactEmail.trim() || undefined,
          paymentTerms: newVendor.paymentTerms.trim() || undefined,
          termsDays: termsDaysNum,
          currency: newVendor.currency.trim() || undefined,
          vendorCategory: newVendor.vendorCategory.trim() || undefined,
          vendorType: newVendor.vendorType.trim() || undefined,
          notes: newVendor.notes.trim() || undefined,
          actor: newVendor.actor.trim(),
        },
      });
      toast({ title: "Vendor created", description: newVendor.vendorCode });
      setIsAddOpen(false);
      setNewVendor({
        vendorCode: "", vendorName: "", legalName: "", dba: "",
        taxId: "", apEmail: "", contactEmail: "",
        paymentTerms: "", termsDays: "", currency: "",
        vendorCategory: "", vendorType: "", notes: "", actor: actorName,
      });
      queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create vendor";
      setAddError(msg);
    }
  };

  // ── CSV import ─────────────────────────────────────────────────────────────
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadedBy, setUploadedBy] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const handleImport = async () => {
    setImportError(null);
    if (!csvFile) { setImportError("Select a CSV file first"); return; }
    if (!uploadedBy.trim()) { setImportError("Your name is required for the import audit trail"); return; }

    const text = await csvFile.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) { setImportError("CSV must have a header row and at least one data row"); return; }

    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const parseRow = (line: string) =>
      line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    const codeIdx = headers.indexOf("vendorCode");
    const nameIdx = headers.indexOf("vendorName");
    if (codeIdx < 0 || nameIdx < 0) {
      setImportError("CSV must have vendorCode and vendorName columns");
      return;
    }

    const getCell = (cells: string[], name: string): string | undefined => {
      const i = headers.indexOf(name);
      return i >= 0 ? (cells[i]?.trim() || undefined) : undefined;
    };

    const vendorRows: Array<{
      vendorCode: string;
      vendorName: string;
      legalName?: string;
      dba?: string;
      taxId?: string;
      apEmail?: string;
      contactEmail?: string;
      remittanceEmail?: string;
      contactPhone?: string;
      website?: string;
      paymentTerms?: string;
      termsDays?: number;
      currency?: string;
      vendorCategory?: string;
      vendorType?: string;
      notes?: string;
      requiresPO?: boolean;
      aliases?: string[];
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      const cells = parseRow(lines[i]);
      const code = cells[codeIdx]?.trim();
      const name = cells[nameIdx]?.trim();
      if (!code || !name) continue;
      const termsDaysRaw = getCell(cells, "termsDays");
      const termsDaysParsed = termsDaysRaw ? parseInt(termsDaysRaw, 10) : undefined;
      const aliasesRaw = getCell(cells, "aliases");
      vendorRows.push({
        vendorCode: code,
        vendorName: name,
        legalName: getCell(cells, "legalName"),
        dba: getCell(cells, "dba"),
        taxId: getCell(cells, "taxId"),
        apEmail: getCell(cells, "apEmail"),
        contactEmail: getCell(cells, "contactEmail"),
        remittanceEmail: getCell(cells, "remittanceEmail"),
        contactPhone: getCell(cells, "contactPhone"),
        website: getCell(cells, "website"),
        paymentTerms: getCell(cells, "paymentTerms"),
        termsDays: termsDaysParsed != null && !isNaN(termsDaysParsed) ? termsDaysParsed : undefined,
        currency: getCell(cells, "currency"),
        vendorCategory: getCell(cells, "vendorCategory"),
        vendorType: getCell(cells, "vendorType"),
        notes: getCell(cells, "notes"),
        requiresPO: getCell(cells, "requiresPO") === "true" ? true : undefined,
        aliases: aliasesRaw ? aliasesRaw.split(";").map((a) => a.trim()).filter(Boolean) : undefined,
      });
    }

    if (vendorRows.length === 0) {
      setImportError("No valid rows found in CSV");
      return;
    }

    try {
      const result = await importVendors.mutateAsync({ data: { vendors: vendorRows, uploadedBy: uploadedBy.trim() } });
      toast({
        title: "Import complete",
        description: `${result.inserted} inserted, ${result.skipped} skipped${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`,
      });
      setIsImportOpen(false);
      setCsvFile(null);
      setUploadedBy("");
      queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    }
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    const params = new URLSearchParams();
    if (statusFilter === "active") params.set("isActive", "true");
    if (statusFilter === "inactive") params.set("isActive", "false");
    if (statusFilter === "onhold") params.set("onHold", "true");
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    window.open(`${base}/api/vendors/profile-export?${params.toString()}`, "_blank");
  };

  // ── Risk badge helper ──────────────────────────────────────────────────────
  const riskBadges = (vendor: (typeof vendors)[0]) => {
    const badges = [];
    if (vendor.onHold) badges.push(<Badge key="hold" variant="destructive" className="text-xs">On Hold</Badge>);
    if (!vendor.isActive) badges.push(<Badge key="inactive" variant="secondary" className="text-xs">Inactive</Badge>);
    if (!vendor.apEmail && !vendor.contactEmail) badges.push(
      <Badge key="noemail" variant="outline" className="text-xs text-amber-600 border-amber-400 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />No AP Email
      </Badge>
    );
    if (!vendor.paymentTerms && vendor.termsDays == null) badges.push(
      <Badge key="noterms" variant="outline" className="text-xs text-amber-600 border-amber-400 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />No Terms
      </Badge>
    );
    return badges;
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Vendors</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">({total})</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1" />Import
          </Button>
          <Button size="sm" onClick={() => setIsAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />New Vendor
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search by name, code, alias…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Status filter buttons */}
            {(["all", "active", "inactive", "onhold"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={statusFilter === f ? "default" : "outline"}
                onClick={() => { setStatusFilter(f); setPage(1); }}
              >
                {f === "all" ? "All" : f === "active" ? "Active" : f === "inactive" ? "Inactive" : "On Hold"}
              </Button>
            ))}
            <div className="h-5 w-px bg-border mx-1" />
            {/* Risk filter toggles */}
            {[
              { key: "requiresPO", label: "Requires PO", val: requiresPOFilter, set: setRequiresPOFilter },
              { key: "missingApEmail", label: "Missing AP Email", val: missingApEmailFilter, set: setMissingApEmailFilter },
              { key: "missingTerms", label: "Missing Terms", val: missingTermsFilter, set: setMissingTermsFilter },
            ].map(({ key, label, val, set }) => (
              <Button
                key={key}
                size="sm"
                variant={val ? "secondary" : "ghost"}
                className={val ? "border border-amber-400 text-amber-700" : "text-muted-foreground"}
                onClick={() => { set(!val); setPage(1); }}
              >
                {val && <AlertCircle className="h-3 w-3 mr-1" />}
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : vendors.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="font-medium">No vendors found</p>
              <p className="text-sm">Try adjusting your filters or add a new vendor</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Code</TableHead>
                  <TableHead>Name / Legal Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">AP Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Terms</TableHead>
                  <TableHead className="hidden lg:table-cell">Aliases</TableHead>
                  <TableHead className="hidden xl:table-cell">Updated</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id} className="hover:bg-muted/40">
                    <TableCell>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">{v.vendorCode}</code>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{v.vendorName}</div>
                      {v.legalName && v.legalName !== v.vendorName && (
                        <div className="text-xs text-muted-foreground">{v.legalName}</div>
                      )}
                      {v.dba && (
                        <div className="text-xs text-muted-foreground italic">dba {v.dba}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {riskBadges(v).length === 0 ? (
                          <Badge variant="outline" className="text-xs text-green-700 border-green-400">Active</Badge>
                        ) : riskBadges(v)}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {v.apEmail || v.contactEmail || (
                        <span className="text-amber-600 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />missing
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {v.paymentTerms
                        ? `${v.paymentTerms}${v.termsDays != null ? ` (${v.termsDays}d)` : ""}`
                        : <span className="text-amber-600">—</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {(v.aliases ?? []).length > 0
                        ? <span>{(v.aliases ?? []).length} alias{(v.aliases ?? []).length !== 1 ? "es" : ""}</span>
                        : <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                      {v.updatedAt
                        ? format(new Date(v.updatedAt), "MMM d, yyyy")
                        : format(new Date(String(v.createdAt)), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Link href={`/vendors/${v.id}`}>
                        <Button variant="ghost" size="sm" className="h-7 px-2">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Add Vendor Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-1">
            {addError && (
              <div className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />{addError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Vendor Code *</Label>
                <Input placeholder="V-1001" value={newVendor.vendorCode} onChange={(e) => setNewVendor(v => ({ ...v, vendorCode: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Vendor Name *</Label>
                <Input placeholder="Acme Supplies Inc." value={newVendor.vendorName} onChange={(e) => setNewVendor(v => ({ ...v, vendorName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Legal Name</Label>
                <Input placeholder="Full registered name" value={newVendor.legalName} onChange={(e) => setNewVendor(v => ({ ...v, legalName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>DBA / Trade Name</Label>
                <Input placeholder="Doing business as" value={newVendor.dba} onChange={(e) => setNewVendor(v => ({ ...v, dba: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>AP Email</Label>
                <Input type="email" placeholder="ap@vendor.com" value={newVendor.apEmail} onChange={(e) => setNewVendor(v => ({ ...v, apEmail: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Contact Email</Label>
                <Input type="email" placeholder="contact@vendor.com" value={newVendor.contactEmail} onChange={(e) => setNewVendor(v => ({ ...v, contactEmail: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Payment Terms</Label>
                <Input placeholder="NET30" value={newVendor.paymentTerms} onChange={(e) => setNewVendor(v => ({ ...v, paymentTerms: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Terms Days</Label>
                <Input type="number" placeholder="30" value={newVendor.termsDays} onChange={(e) => setNewVendor(v => ({ ...v, termsDays: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Input placeholder="USD" value={newVendor.currency} onChange={(e) => setNewVendor(v => ({ ...v, currency: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Tax ID</Label>
              <Input placeholder="12-3456789" value={newVendor.taxId} onChange={(e) => setNewVendor(v => ({ ...v, taxId: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Your Name (actor) *</Label>
              <Input placeholder="e.g. Jane Smith" value={newVendor.actor} onChange={(e) => setNewVendor(v => ({ ...v, actor: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Required for audit trail — no authentication in pilot.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={createVendor.isPending}>
              {createVendor.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create Vendor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import Vendors from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {importError && (
              <div className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />{importError}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              CSV must have <code className="bg-muted px-1 rounded">vendorCode</code> and <code className="bg-muted px-1 rounded">vendorName</code> columns.
              Optional: legalName, dba, taxId, apEmail, contactEmail, remittanceEmail, contactPhone, website, paymentTerms, termsDays, currency, vendorCategory, vendorType, notes, requiresPO (true/false), aliases (semicolon-separated). Existing vendor codes are skipped.
            </p>
            <div className="space-y-1">
              <Label>CSV File *</Label>
              <Input
                type="file"
                accept=".csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1">
              <Label>Your Name *</Label>
              <Input
                placeholder="e.g. Jane Smith"
                value={uploadedBy}
                onChange={(e) => setUploadedBy(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">For audit trail.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsImportOpen(false); setCsvFile(null); setUploadedBy(""); setImportError(null); }}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importVendors.isPending}>
              {importVendors.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
