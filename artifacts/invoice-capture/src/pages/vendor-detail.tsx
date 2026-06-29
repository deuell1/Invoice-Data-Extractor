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
  AlertCircle, AlertTriangle, ArrowLeft, Check, ChevronRight,
  Clock, Edit2, Eye, EyeOff, Loader2, Plus, Receipt, Shield,
  TrendingUp, X,
} from "lucide-react";

type EditForm = {
  vendorCode: string;
  vendorName: string;
  legalName: string;
  dba: string;
  vendorCategory: string;
  vendorType: string;
  taxId: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  contactEmail: string;
  apEmail: string;
  remittanceEmail: string;
  contactPhone: string;
  website: string;
  paymentTerms: string;
  termsDays: string;
  currency: string;
  notes: string;
  isActive: boolean;
  onHold: boolean;
  holdReason: string;
  requiresPO: boolean;
  aliases: string[];
  actor: string;
  reason: string;
};

function buildEditForm(vendor: Vendor): EditForm {
  return {
    vendorCode: vendor.vendorCode,
    vendorName: vendor.vendorName ?? "",
    legalName: vendor.legalName ?? "",
    dba: vendor.dba ?? "",
    vendorCategory: vendor.vendorCategory ?? "",
    vendorType: vendor.vendorType ?? "",
    taxId: vendor.taxId ?? "",
    addressLine1: vendor.addressLine1 ?? "",
    addressLine2: vendor.addressLine2 ?? "",
    city: vendor.city ?? "",
    state: vendor.state ?? "",
    postalCode: vendor.postalCode ?? "",
    country: vendor.country ?? "",
    contactEmail: vendor.contactEmail ?? "",
    apEmail: vendor.apEmail ?? "",
    remittanceEmail: vendor.remittanceEmail ?? "",
    contactPhone: vendor.contactPhone ?? "",
    website: vendor.website ?? "",
    paymentTerms: vendor.paymentTerms ?? "",
    termsDays: vendor.termsDays != null ? String(vendor.termsDays) : "",
    currency: vendor.currency ?? "",
    notes: vendor.notes ?? "",
    isActive: vendor.isActive ?? true,
    onHold: vendor.onHold ?? false,
    holdReason: vendor.holdReason ?? "",
    requiresPO: vendor.requiresPO ?? false,
    aliases: (vendor.aliases ?? []) as string[],
    actor: "",
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
  const [showTaxId, setShowTaxId] = useState(false);

  const openEdit = () => {
    if (!vendor) return;
    setForm(buildEditForm(vendor));
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

    if (!form.actor.trim()) {
      setSaveError("Your name (actor) is required to save changes");
      return;
    }
    if (!form.vendorName.trim()) {
      setSaveError("Vendor name cannot be blank");
      return;
    }
    if (form.onHold && !form.holdReason.trim()) {
      setSaveError("Hold reason is required when On Hold is enabled");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const nextErrors: Record<string, string> = {};

    for (const [field, val] of [
      ["apEmail", form.apEmail],
      ["contactEmail", form.contactEmail],
      ["remittanceEmail", form.remittanceEmail],
    ] as const) {
      if (val.trim() && !emailRegex.test(val.trim())) {
        nextErrors[field] = "Must be a valid email address";
      }
    }
    if (form.website.trim()) {
      try {
        const url = new URL(form.website.trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        nextErrors.website = "Must be a valid https:// URL";
      }
    }
    const termsDaysNum = form.termsDays.trim() ? parseInt(form.termsDays.trim(), 10) : null;
    if (form.termsDays.trim() && (termsDaysNum === null || isNaN(termsDaysNum) || termsDaysNum < 0)) {
      nextErrors.termsDays = "Must be a whole number ≥ 0";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setSaveError("Please fix the highlighted fields before saving");
      return;
    }

    const codeChanged = form.vendorCode.trim() !== vendor.vendorCode;
    const payload: VendorUpdate = {
      actor: form.actor.trim(),
      reason: form.reason.trim() || null,
      ...(codeChanged ? { vendorCode: form.vendorCode.trim() } : {}),
      vendorName: form.vendorName.trim(),
      legalName: form.legalName.trim() || null,
      dba: form.dba.trim() || null,
      vendorCategory: form.vendorCategory.trim() || null,
      vendorType: form.vendorType.trim() || null,
      taxId: form.taxId.trim() || null,
      addressLine1: form.addressLine1.trim() || null,
      addressLine2: form.addressLine2.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      postalCode: form.postalCode.trim() || null,
      country: form.country.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      apEmail: form.apEmail.trim() || null,
      remittanceEmail: form.remittanceEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      website: form.website.trim() || null,
      paymentTerms: form.paymentTerms.trim() || null,
      termsDays: termsDaysNum,
      currency: form.currency.trim() || null,
      notes: form.notes.trim() || null,
      isActive: form.isActive,
      onHold: form.onHold,
      holdReason: form.holdReason.trim() || null,
      requiresPO: form.requiresPO,
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

  // ── Status badges ──────────────────────────────────────────────────────────
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

      {/* Actor + Reason (shown while editing) */}
      {isEditing && form && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-blue-800">Your Name (actor) *</Label>
                <Input
                  placeholder="e.g. Jane Smith"
                  value={form.actor}
                  onChange={(e) => set("actor", e.target.value)}
                  className="bg-white"
                />
                <p className="text-xs text-blue-600">Required for audit trail — pilot has no auth.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-blue-800">Reason for Change</Label>
                <Input
                  placeholder="Optional — note why this change was made"
                  value={form.reason}
                  onChange={(e) => set("reason", e.target.value)}
                  className="bg-white"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">

          {/* Profile */}
          <Section title="Profile">
            {isEditing && form ? (
              <div className="space-y-3">
                {/* Vendor Code — editable only when no invoices reference this vendor */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Vendor Code</Label>
                  {(activity?.invoiceCount ?? 0) === 0 ? (
                    <div>
                      <Input
                        value={form.vendorCode}
                        placeholder="V-1001"
                        onChange={(e) => { set("vendorCode", e.target.value); if (fieldErrors.vendorCode) setFieldErrors((fe) => ({ ...fe, vendorCode: "" })); }}
                        className={fieldErrors.vendorCode ? "border-destructive" : ""}
                      />
                      {fieldErrors.vendorCode && <p className="text-xs text-destructive mt-0.5">{fieldErrors.vendorCode}</p>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-1 rounded text-xs">{vendor.vendorCode}</code>
                      <span className="text-xs text-muted-foreground">Locked — {activity?.invoiceCount} invoice(s) reference this vendor.</span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <EditableText label="Vendor Name *" value={form.vendorName} onChange={(v) => set("vendorName", v)} />
                  <EditableText label="Legal Name" value={form.legalName} onChange={(v) => set("legalName", v)} placeholder="Full registered name" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <EditableText label="DBA / Trade Name" value={form.dba} onChange={(v) => set("dba", v)} placeholder="Doing business as" />
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Website</Label>
                    <Input
                      value={form.website}
                      placeholder="https://…"
                      onChange={(e) => { set("website", e.target.value); if (fieldErrors.website) setFieldErrors((fe) => ({ ...fe, website: "" })); }}
                      className={fieldErrors.website ? "border-destructive" : ""}
                    />
                    {fieldErrors.website && <p className="text-xs text-destructive mt-0.5">{fieldErrors.website}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <EditableText label="Category" value={form.vendorCategory} onChange={(v) => set("vendorCategory", v)} placeholder="e.g. Supplies" />
                  <EditableText label="Type" value={form.vendorType} onChange={(v) => set("vendorType", v)} placeholder="GOODS / SERVICES" />
                </div>
              </div>
            ) : (
              <>
                <FieldRow label="Vendor Code"><code className="bg-muted px-1 rounded text-xs">{vendor.vendorCode}</code></FieldRow>
                <FieldRow label="Legal Name">{vendor.legalName ?? <span className="text-muted-foreground">—</span>}</FieldRow>
                <FieldRow label="DBA">{vendor.dba ?? <span className="text-muted-foreground">—</span>}</FieldRow>
                <FieldRow label="Website">
                  {vendor.website
                    ? <a href={vendor.website} target="_blank" rel="noreferrer" className="underline text-blue-600">{vendor.website}</a>
                    : <span className="text-muted-foreground">—</span>}
                </FieldRow>
                <FieldRow label="Category">{vendor.vendorCategory ?? <span className="text-muted-foreground">—</span>}</FieldRow>
                <FieldRow label="Type">{vendor.vendorType ?? <span className="text-muted-foreground">—</span>}</FieldRow>
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
                <div className="flex items-center justify-between py-1 border-t">
                  <div>
                    <p className="text-sm font-medium">Requires PO</p>
                    <p className="text-xs text-muted-foreground">Invoices must be matched to a PO</p>
                  </div>
                  <Switch checked={form.requiresPO} onCheckedChange={(v) => set("requiresPO", v)} />
                </div>
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

          {/* Contact & Remittance */}
          <Section title="Contact & Remittance">
            {isEditing && form ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">AP / Accounts Payable Email</Label>
                    <Input type="email" value={form.apEmail} placeholder="ap@vendor.com" onChange={(e) => { set("apEmail", e.target.value); if (fieldErrors.apEmail) setFieldErrors((fe) => ({ ...fe, apEmail: "" })); }} className={fieldErrors.apEmail ? "border-destructive" : ""} />
                    {fieldErrors.apEmail && <p className="text-xs text-destructive mt-0.5">{fieldErrors.apEmail}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Remittance Email</Label>
                    <Input type="email" value={form.remittanceEmail} placeholder="remit@vendor.com" onChange={(e) => { set("remittanceEmail", e.target.value); if (fieldErrors.remittanceEmail) setFieldErrors((fe) => ({ ...fe, remittanceEmail: "" })); }} className={fieldErrors.remittanceEmail ? "border-destructive" : ""} />
                    {fieldErrors.remittanceEmail && <p className="text-xs text-destructive mt-0.5">{fieldErrors.remittanceEmail}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">General Contact Email</Label>
                    <Input type="email" value={form.contactEmail} onChange={(e) => { set("contactEmail", e.target.value); if (fieldErrors.contactEmail) setFieldErrors((fe) => ({ ...fe, contactEmail: "" })); }} className={fieldErrors.contactEmail ? "border-destructive" : ""} />
                    {fieldErrors.contactEmail && <p className="text-xs text-destructive mt-0.5">{fieldErrors.contactEmail}</p>}
                  </div>
                  <EditableText label="Phone" value={form.contactPhone} onChange={(v) => set("contactPhone", v)} placeholder="+1-555-0100" />
                </div>
              </div>
            ) : (
              <>
                <FieldRow label="AP Email">
                  {vendor.apEmail
                    ? <a href={`mailto:${vendor.apEmail}`} className="underline text-blue-600">{vendor.apEmail}</a>
                    : <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Not set</span>}
                </FieldRow>
                <FieldRow label="Remittance Email">
                  {vendor.remittanceEmail
                    ? <a href={`mailto:${vendor.remittanceEmail}`} className="underline text-blue-600">{vendor.remittanceEmail}</a>
                    : <span className="text-muted-foreground">—</span>}
                </FieldRow>
                <FieldRow label="Contact Email">
                  {vendor.contactEmail
                    ? <a href={`mailto:${vendor.contactEmail}`} className="underline text-blue-600">{vendor.contactEmail}</a>
                    : <span className="text-muted-foreground">—</span>}
                </FieldRow>
                <FieldRow label="Phone">{vendor.contactPhone ?? <span className="text-muted-foreground">—</span>}</FieldRow>
              </>
            )}
          </Section>

          {/* Address */}
          <Section title="Address">
            {isEditing && form ? (
              <div className="space-y-3">
                <EditableText label="Address Line 1" value={form.addressLine1} onChange={(v) => set("addressLine1", v)} />
                <EditableText label="Address Line 2" value={form.addressLine2} onChange={(v) => set("addressLine2", v)} />
                <div className="grid grid-cols-3 gap-3">
                  <EditableText label="City" value={form.city} onChange={(v) => set("city", v)} />
                  <EditableText label="State" value={form.state} onChange={(v) => set("state", v)} />
                  <EditableText label="Postal Code" value={form.postalCode} onChange={(v) => set("postalCode", v)} />
                </div>
                <EditableText label="Country" value={form.country} onChange={(v) => set("country", v)} placeholder="US" />
              </div>
            ) : (
              <>
                <FieldRow label="Address">
                  {vendor.addressLine1 ? (
                    <div>
                      <div>{vendor.addressLine1}</div>
                      {vendor.addressLine2 && <div>{vendor.addressLine2}</div>}
                      {(vendor.city || vendor.state || vendor.postalCode) && (
                        <div>{[vendor.city, vendor.state, vendor.postalCode].filter(Boolean).join(", ")}</div>
                      )}
                      {vendor.country && <div>{vendor.country}</div>}
                    </div>
                  ) : vendor.address ? (
                    <span>{vendor.address}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </FieldRow>
              </>
            )}
          </Section>

          {/* Payment Terms */}
          <Section title="Payment Terms">
            {isEditing && form ? (
              <div className="grid grid-cols-3 gap-3">
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
                <EditableText label="Currency" value={form.currency} onChange={(v) => set("currency", v)} placeholder="USD" />
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

          {/* Tax & Notes */}
          <Section title="Tax & Notes">
            <FieldRow label="Tax ID (EIN)">
              {vendor.taxId ? (
                <div className="flex items-center gap-2">
                  <span>{showTaxId ? vendor.taxId : `••••${vendor.taxId.slice(-4)}`}</span>
                  <button type="button" onClick={() => setShowTaxId((v) => !v)} className="text-muted-foreground hover:text-foreground">
                    {showTaxId ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </FieldRow>
            {isEditing && form ? (
              <div className="mt-3 space-y-1">
                <Label className="text-xs text-muted-foreground">Tax ID</Label>
                <Input
                  value={form.taxId}
                  onChange={(e) => set("taxId", e.target.value)}
                  placeholder="12-3456789"
                  type="password"
                  autoComplete="off"
                />
                <Label className="text-xs text-muted-foreground mt-2 block">Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Internal notes…"
                  rows={3}
                />
              </div>
            ) : (
              <FieldRow label="Notes">
                {vendor.notes ? <span className="text-sm">{vendor.notes}</span> : <span className="text-muted-foreground">—</span>}
              </FieldRow>
            )}
          </Section>
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
