import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetVendor,
  useUpdateVendor,
  useGetVendorActivity,
  useGetVendorAuditLog,
  getListVendorsQueryKey,
  getGetVendorQueryKey,
  getGetVendorActivityQueryKey,
  getGetVendorAuditLogQueryKey,
} from "@workspace/api-client-react";
import type { Vendor, VendorUpdate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle, AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp,
  Clock, Edit2, Loader2, Plus, Receipt, Shield,
  TrendingUp, X,
} from "lucide-react";

type EditForm = {
  vendorCode: string;
  vendorName: string;
  paymentTerms: string;
  termsDays: string;
  isActive: boolean;
  onHold: boolean;
  holdReason: string;
  notes: string;
  aliases: string[];
  reason: string;
};

function buildEditForm(vendor: Vendor): EditForm {
  return {
    vendorCode: vendor.vendorCode,
    vendorName: vendor.vendorName ?? "",
    paymentTerms: vendor.paymentTerms ?? "",
    termsDays: vendor.termsDays != null ? String(vendor.termsDays) : "",
    isActive: vendor.isActive ?? true,
    onHold: vendor.onHold ?? false,
    holdReason: vendor.holdReason ?? "",
    notes: vendor.notes ?? "",
    aliases: (vendor.aliases ?? []) as string[],
    reason: "",
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-1.5 border-b last:border-0">
      <span className="text-sm text-muted-foreground self-center">{label}</span>
      <span className="text-sm self-center">{children}</span>
    </div>
  );
}

function EditableText({
  label, value, onChange, type = "text", placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function AdditionalDetails({ vendor }: { vendor: Vendor }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        className="w-full"
        onClick={() => setOpen((v) => !v)}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            <span>Additional Details</span>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardTitle>
        </CardHeader>
      </button>
      {open && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground mb-3">Read-only — update via Vendor Master CSV import.</p>
          {/* Identity */}
          {(vendor.legalName || vendor.dba) && (
            <>
              {vendor.legalName && <FieldRow label="Legal Name">{vendor.legalName}</FieldRow>}
              {vendor.dba && <FieldRow label="DBA">{vendor.dba}</FieldRow>}
            </>
          )}
          {(vendor.vendorCategory || vendor.vendorType) && (
            <>
              {vendor.vendorCategory && <FieldRow label="Category">{vendor.vendorCategory}</FieldRow>}
              {vendor.vendorType && <FieldRow label="Type">{vendor.vendorType}</FieldRow>}
            </>
          )}
          {vendor.taxId && (
            <FieldRow label="Tax ID (EIN)"><span className="font-mono text-xs">••••{vendor.taxId.slice(-4)}</span></FieldRow>
          )}
          {/* Contact */}
          {(vendor.apEmail || vendor.remittanceEmail || vendor.contactEmail || vendor.contactPhone || vendor.website) && (
            <>
              {vendor.apEmail && (
                <FieldRow label="AP Email">
                  <a href={`mailto:${vendor.apEmail}`} className="underline text-blue-600">{vendor.apEmail}</a>
                </FieldRow>
              )}
              {vendor.remittanceEmail && (
                <FieldRow label="Remittance Email">
                  <a href={`mailto:${vendor.remittanceEmail}`} className="underline text-blue-600">{vendor.remittanceEmail}</a>
                </FieldRow>
              )}
              {vendor.contactEmail && (
                <FieldRow label="Contact Email">
                  <a href={`mailto:${vendor.contactEmail}`} className="underline text-blue-600">{vendor.contactEmail}</a>
                </FieldRow>
              )}
              {vendor.contactPhone && <FieldRow label="Phone">{vendor.contactPhone}</FieldRow>}
              {vendor.website && (
                <FieldRow label="Website">
                  <a href={vendor.website} target="_blank" rel="noreferrer" className="underline text-blue-600">{vendor.website}</a>
                </FieldRow>
              )}
            </>
          )}
          {/* Address */}
          {(vendor.addressLine1 || vendor.address) && (
            <FieldRow label="Address">
              <div>
                {vendor.addressLine1 && <div>{vendor.addressLine1}</div>}
                {vendor.addressLine2 && <div>{vendor.addressLine2}</div>}
                {(vendor.city || vendor.state || vendor.postalCode) && (
                  <div>{[vendor.city, vendor.state, vendor.postalCode].filter(Boolean).join(", ")}</div>
                )}
                {vendor.country && <div>{vendor.country}</div>}
                {!vendor.addressLine1 && vendor.address && <div>{vendor.address}</div>}
              </div>
            </FieldRow>
          )}
          {!vendor.legalName && !vendor.dba && !vendor.vendorCategory && !vendor.vendorType &&
           !vendor.taxId && !vendor.apEmail && !vendor.remittanceEmail && !vendor.contactEmail &&
           !vendor.contactPhone && !vendor.website && !vendor.addressLine1 && !vendor.address && (
            <p className="text-sm text-muted-foreground py-2">No additional details on file.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function VendorDetail() {
  const params = useParams<{ id: string }>();
  const vendorId = parseInt(params.id ?? "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const enabled = Number.isFinite(vendorId) && vendorId > 0;
  const { data: vendor, isLoading, error } = useGetVendor(vendorId, {
    query: { enabled, queryKey: getGetVendorQueryKey(vendorId) },
  });
  const { data: activity } = useGetVendorActivity(vendorId, {
    query: { enabled, queryKey: getGetVendorActivityQueryKey(vendorId) },
  });
  const { data: auditLog } = useGetVendorAuditLog(vendorId, {
    query: { enabled, queryKey: getGetVendorAuditLogQueryKey(vendorId) },
  });

  const updateVendor = useUpdateVendor();

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const openEdit = () => {
    if (!vendor) return;
    const base = buildEditForm(vendor);
    setForm({ ...base });
    setAliasDraft("");
    setSaveError(null);
    setFieldErrors({});
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setForm(null);
    setSaveError(null);
    setFieldErrors({});
  };

  const handleSave = async () => {
    if (!form || !vendor) return;
    setSaveError(null);
    setFieldErrors({});

    if (!form.vendorName.trim()) {
      setSaveError("Vendor name cannot be blank");
      return;
    }
    if (form.onHold && !form.holdReason.trim()) {
      setSaveError("Hold reason is required when On Hold is enabled");
      return;
    }

    const termsDaysNum = form.termsDays.trim() ? parseInt(form.termsDays.trim(), 10) : null;
    if (form.termsDays.trim() && (termsDaysNum === null || isNaN(termsDaysNum) || termsDaysNum < 0)) {
      setFieldErrors({ termsDays: "Must be a whole number ≥ 0" });
      setSaveError("Please fix the highlighted fields before saving");
      return;
    }

    const codeChanged = form.vendorCode.trim() !== vendor.vendorCode;
    const payload: VendorUpdate = {
      reason: form.reason.trim() || null,
      ...(codeChanged ? { vendorCode: form.vendorCode.trim() } : {}),
      vendorName: form.vendorName.trim(),
      paymentTerms: form.paymentTerms.trim() || null,
      termsDays: termsDaysNum,
      notes: form.notes.trim() || null,
      isActive: form.isActive,
      onHold: form.onHold,
      holdReason: form.holdReason.trim() || null,
      aliases: form.aliases,
    };

    try {
      await updateVendor.mutateAsync({ id: vendorId, data: payload });
      toast({ title: "Vendor updated" });
      queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(vendorId) });
      queryClient.invalidateQueries({ queryKey: getGetVendorAuditLogQueryKey(vendorId) });
      queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
      setIsEditing(false);
      setForm(null);
      setFieldErrors({});
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const addAlias = () => {
    const val = aliasDraft.trim();
    if (!val || !form) return;
    if (!form.aliases.some((a) => a.toLowerCase() === val.toLowerCase())) {
      setForm((f) => f ? { ...f, aliases: [...f.aliases, val] } : f);
    }
    setAliasDraft("");
  };

  const removeAlias = (alias: string) => {
    setForm((f) => f ? { ...f, aliases: f.aliases.filter((a) => a !== alias) } : f);
  };

  const set = <K extends keyof EditForm>(key: K, val: EditForm[K]) =>
    setForm((f) => f ? { ...f, [key]: val } : f);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (!Number.isFinite(vendorId) || vendorId <= 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <AlertCircle className="h-8 w-8 mx-auto mb-2" />
        <p>Invalid vendor ID</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !vendor) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <AlertCircle className="h-8 w-8 mx-auto mb-2" />
        <p className="font-medium">Vendor not found</p>
        <Link href="/vendors">
          <Button variant="outline" className="mt-4">Back to Vendors</Button>
        </Link>
      </div>
    );
  }

  const aliases = (vendor.aliases ?? []) as string[];

  const statusBadge = () => {
    if (vendor.onHold) return <Badge variant="destructive">On Hold</Badge>;
    if (!vendor.isActive) return <Badge variant="secondary">Inactive</Badge>;
    return <Badge className="bg-green-100 text-green-800 border-green-300">Active</Badge>;
  };

  const riskFlags = [];
  if (!vendor.apEmail && !vendor.contactEmail) riskFlags.push("No AP Email");
  if (!vendor.paymentTerms && vendor.termsDays == null) riskFlags.push("No Payment Terms");
  if (vendor.requiresPO) riskFlags.push("Requires PO");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4 max-w-4xl mx-auto">
      {/* Breadcrumb + Header */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/vendors" className="hover:underline">Vendors</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">{vendor.vendorCode}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{vendor.vendorName}</h1>
            {statusBadge()}
          </div>
          {vendor.legalName && vendor.legalName !== vendor.vendorName && (
            <p className="text-sm text-muted-foreground mt-0.5">Legal: {vendor.legalName}</p>
          )}
          {vendor.dba && (
            <p className="text-sm text-muted-foreground italic">dba {vendor.dba}</p>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            <code className="bg-muted px-1 py-0.5 rounded text-xs">{vendor.vendorCode}</code>
            {vendor.vendorCategory && <span className="ml-2">· {vendor.vendorCategory}</span>}
            {vendor.vendorType && <span className="ml-2">· {vendor.vendorType}</span>}
          </p>
          {riskFlags.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {riskFlags.map((f) => (
                <Badge key={f} variant="outline" className="text-xs text-amber-600 border-amber-400">
                  <AlertTriangle className="h-3 w-3 mr-1" />{f}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {!isEditing ? (
            <Button onClick={openEdit} size="sm">
              <Edit2 className="h-4 w-4 mr-1" />Edit Profile
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={cancelEdit}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={updateVendor.isPending}>
                {updateVendor.isPending
                  ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  : <Check className="h-4 w-4 mr-1" />}
                Save Changes
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />{saveError}
        </div>
      )}

      {/* Reason (shown while editing) */}
      {isEditing && form && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-4">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-blue-800">Reason for Change</Label>
              <Input
                placeholder="Optional — note why this change was made"
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
                className="bg-white"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">

          {/* Profile (Name + Code) */}
          <Section title="Profile">
            {isEditing && form ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Vendor Code</Label>
                  {(activity?.invoiceCount ?? 0) === 0 ? (
                    <Input
                      value={form.vendorCode}
                      placeholder="V-1001"
                      onChange={(e) => set("vendorCode", e.target.value)}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-1 rounded text-xs">{vendor.vendorCode}</code>
                      <span className="text-xs text-muted-foreground">Locked — {activity?.invoiceCount} invoice(s) reference this vendor.</span>
                    </div>
                  )}
                </div>
                <EditableText label="Vendor Name *" value={form.vendorName} onChange={(v) => set("vendorName", v)} />
              </div>
            ) : (
              <>
                <FieldRow label="Vendor Code"><code className="bg-muted px-1 rounded text-xs">{vendor.vendorCode}</code></FieldRow>
                <FieldRow label="Vendor Name">{vendor.vendorName ?? <span className="text-muted-foreground">—</span>}</FieldRow>
              </>
            )}
          </Section>

          {/* Status & Controls */}
          <Section title="Status & Controls">
            {isEditing && form ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium">Active</p>
                    <p className="text-xs text-muted-foreground">Vendor appears in extraction and matching</p>
                  </div>
                  <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
                </div>
                <div className="flex items-center justify-between py-1 border-t">
                  <div>
                    <p className="text-sm font-medium">On Hold</p>
                    <p className="text-xs text-muted-foreground">Invoices from this vendor are flagged for review</p>
                  </div>
                  <Switch checked={form.onHold} onCheckedChange={(v) => set("onHold", v)} />
                </div>
                {form.onHold && (
                  <div className="space-y-1 border-t pt-2">
                    <Label className="text-xs text-muted-foreground">Hold Reason *</Label>
                    <Input
                      placeholder="Reason for hold (required)"
                      value={form.holdReason}
                      onChange={(e) => set("holdReason", e.target.value)}
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                <FieldRow label="Active">
                  {vendor.isActive
                    ? <span className="text-green-700 font-medium">Yes</span>
                    : <span className="text-muted-foreground">No</span>}
                </FieldRow>
                <FieldRow label="On Hold">
                  {vendor.onHold
                    ? <span className="text-destructive font-medium">Yes</span>
                    : <span className="text-muted-foreground">No</span>}
                </FieldRow>
                {vendor.onHold && (
                  <FieldRow label="Hold Reason">
                    <span className="text-amber-700">{vendor.holdReason ?? "—"}</span>
                  </FieldRow>
                )}
                <FieldRow label="Requires PO">
                  {vendor.requiresPO ? "Yes" : <span className="text-muted-foreground">No</span>}
                </FieldRow>
              </>
            )}
          </Section>

          {/* Payment Terms */}
          <Section title="Payment Terms">
            {isEditing && form ? (
              <div className="grid grid-cols-2 gap-3">
                <EditableText label="Terms Code" value={form.paymentTerms} onChange={(v) => set("paymentTerms", v)} placeholder="NET30" />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Days</Label>
                  <Input
                    type="number"
                    value={form.termsDays}
                    placeholder="30"
                    onChange={(e) => { set("termsDays", e.target.value); if (fieldErrors.termsDays) setFieldErrors((fe) => ({ ...fe, termsDays: "" })); }}
                    className={fieldErrors.termsDays ? "border-destructive" : ""}
                  />
                  {fieldErrors.termsDays && <p className="text-xs text-destructive mt-0.5">{fieldErrors.termsDays}</p>}
                </div>
              </div>
            ) : (
              <>
                <FieldRow label="Terms">
                  {vendor.paymentTerms
                    ? `${vendor.paymentTerms}${vendor.termsDays != null ? ` (${vendor.termsDays} days)` : ""}`
                    : <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Not set</span>}
                </FieldRow>
                <FieldRow label="Currency">{vendor.currency ?? <span className="text-muted-foreground">USD (default)</span>}</FieldRow>
              </>
            )}
          </Section>

          {/* Aliases */}
          <Section title="Aliases">
            <p className="text-xs text-muted-foreground mb-3">
              Alternative names used during invoice extraction matching. legalName and dba are also matched automatically.
            </p>
            {isEditing && form ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Add alias…"
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addAlias}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.aliases.map((a) => (
                    <Badge key={a} variant="secondary" className="flex items-center gap-1 pr-1">
                      {a}
                      <button type="button" onClick={() => removeAlias(a)} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {form.aliases.length === 0 && <span className="text-sm text-muted-foreground">No aliases</span>}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {aliases.length > 0
                  ? aliases.map((a) => <Badge key={a} variant="secondary">{a}</Badge>)
                  : <span className="text-sm text-muted-foreground">No aliases — click Edit Profile to add</span>}
              </div>
            )}
          </Section>

          {/* Notes */}
          <Section title="Notes">
            {isEditing && form ? (
              <Textarea
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Internal notes…"
                rows={3}
              />
            ) : (
              <div className="text-sm">
                {vendor.notes ? <span>{vendor.notes}</span> : <span className="text-muted-foreground">—</span>}
              </div>
            )}
          </Section>

          {/* Additional Details (collapsed, read-only) */}
          <AdditionalDetails vendor={vendor} />
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Invoice Activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Receipt className="h-4 w-4" />Invoice Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activity ? (
                <>
                  <div className="text-2xl font-bold">{activity.invoiceCount}</div>
                  <p className="text-xs text-muted-foreground -mt-1">total invoices</p>
                  <div className="space-y-1.5 text-sm border-t pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total value</span>
                      <span className="font-medium">
                        {activity.totalInvoiceAmount != null
                          ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(activity.totalInvoiceAmount))
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Exceptions</span>
                      <span className={activity.exceptionCount > 0 ? "text-destructive font-medium" : ""}>
                        {activity.exceptionCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pending approval</span>
                      <span>{activity.pendingApprovalCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Approved</span>
                      <span>{activity.approvedCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Exported / Posted</span>
                      <span>{activity.postedOrExportedCount}</span>
                    </div>
                    {activity.avgVendorMatchConfidence != null && (
                      <div className="flex justify-between border-t pt-1.5">
                        <span className="text-muted-foreground">Avg match score</span>
                        <span className="flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          {(Number(activity.avgVendorMatchConfidence) * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                    {activity.latestInvoiceDate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Latest invoice</span>
                        <span>{activity.latestInvoiceDate}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground py-2">Loading activity…</div>
              )}
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              {vendor.createdBy && <div>Created by <span className="font-medium text-foreground">{vendor.createdBy}</span></div>}
              <div>Created {format(new Date(String(vendor.createdAt)), "MMM d, yyyy")}</div>
              {vendor.updatedBy && <div>Updated by <span className="font-medium text-foreground">{vendor.updatedBy}</span></div>}
              {vendor.updatedAt && <div>Updated {format(new Date(vendor.updatedAt), "MMM d, yyyy 'at' h:mm a")}</div>}
              {vendor.importBatchId && <div>Batch: <code className="bg-muted px-0.5 rounded">{vendor.importBatchId}</code></div>}
              {vendor.lastImportedAt && <div>Last imported {format(new Date(vendor.lastImportedAt), "MMM d, yyyy")}</div>}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Audit History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Shield className="h-4 w-4" />Audit History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!auditLog || auditLog.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No audit entries yet</p>
          ) : (
            <div className="space-y-0">
              {auditLog.map((entry) => (
                <div key={entry.id} className="flex gap-3 py-2 border-b last:border-0">
                  <div className="mt-1 shrink-0">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-mono font-medium text-muted-foreground">
                        {entry.action.replace("VENDOR_", "").replace(/_/g, " ")}
                      </span>
                      {entry.fieldName && (
                        <code className="text-xs bg-muted px-1 rounded">{entry.fieldName}</code>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">
                        {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                      </span>
                    </div>
                    {(entry.oldValue || entry.newValue) && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-1 items-center flex-wrap">
                        {entry.oldValue && <span className="line-through opacity-60 truncate max-w-[150px]">{entry.oldValue}</span>}
                        {entry.oldValue && entry.newValue && <span>→</span>}
                        {entry.newValue && <span className="text-foreground truncate max-w-[200px]">{entry.newValue}</span>}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      by <span className="font-medium">{entry.actor}</span>
                      {entry.reason && <span className="ml-1 italic">· {entry.reason}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
