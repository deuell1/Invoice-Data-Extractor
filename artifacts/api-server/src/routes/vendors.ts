import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq, ilike, sql, and, asc, desc, isNull, or, gte, ne } from "drizzle-orm";
import {
  db,
  vendorIdTable,
  vendorAuditLogTable,
  invoiceCaptureTable,
  importBatchTable,
} from "@workspace/db";
import { toCsv } from "../lib/csv";
import {
  CreateVendorBody,
  UpdateVendorBody,
  UpdateVendorParams,
  GetVendorParams,
  ListVendorsQueryParams,
  GetVendorResponse,
  ListVendorsResponse,
  UpdateVendorResponse,
  ImportVendorsBody,
  ImportVendorsResponse,
  ExportVendorProfilesQueryParams,
  GetVendorActivityParams,
  GetVendorActivityResponse,
  GetVendorAuditLogParams,
  GetVendorAuditLogResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeVendor(row: typeof vendorIdTable.$inferSelect) {
  return {
    ...row,
    aliases: (row.aliases as string[] | null) ?? [],
    requiresPO: row.requiresPO ?? false,
    onHold: row.onHold ?? false,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : (row.updatedAt ?? null),
    lastImportedAt:
      row.lastImportedAt instanceof Date
        ? row.lastImportedAt.toISOString()
        : (row.lastImportedAt ?? null),
  };
}

function serializeAuditEntry(entry: typeof vendorAuditLogTable.$inferSelect) {
  return {
    ...entry,
    createdAt:
      entry.createdAt instanceof Date
        ? entry.createdAt.toISOString()
        : String(entry.createdAt),
  };
}

// ─── GET /vendors ─────────────────────────────────────────────────────────────

router.get("/vendors", async (req, res): Promise<void> => {
  const parsed = ListVendorsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    search,
    page,
    limit,
    isActive,
    onHold,
    requiresPO,
    missingApEmail,
    missingPaymentTerms,
    vendorCategory,
    vendorType,
    updatedSince,
    sortBy,
    sortDir,
  } = parsed.data;

  const offset = ((page ?? 1) - 1) * (limit ?? 50);
  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(vendorIdTable.vendorName, `%${search}%`),
        ilike(vendorIdTable.vendorCode, `%${search}%`),
        ilike(vendorIdTable.legalName, `%${search}%`),
        ilike(vendorIdTable.dba, `%${search}%`),
        sql`${vendorIdTable.aliases}::text ilike ${"%" + search + "%"}`,
      ),
    );
  }
  if (isActive != null) conditions.push(eq(vendorIdTable.isActive, isActive));
  if (onHold != null) conditions.push(eq(vendorIdTable.onHold, onHold));
  if (requiresPO != null)
    conditions.push(eq(vendorIdTable.requiresPO, requiresPO));
  if (missingApEmail) conditions.push(isNull(vendorIdTable.apEmail));
  if (missingPaymentTerms) {
    conditions.push(
      and(isNull(vendorIdTable.paymentTerms), isNull(vendorIdTable.termsDays)),
    );
  }
  if (vendorCategory)
    conditions.push(eq(vendorIdTable.vendorCategory, vendorCategory));
  if (vendorType)
    conditions.push(eq(vendorIdTable.vendorType, vendorType));
  if (updatedSince) {
    const since = new Date(updatedSince as unknown as string);
    if (!Number.isNaN(since.getTime())) {
      conditions.push(
        or(
          gte(vendorIdTable.updatedAt, since),
          gte(vendorIdTable.createdAt, since),
        ),
      );
    }
  }

  const whereClause =
    conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol = (() => {
    switch (sortBy) {
      case "vendorCode":
        return vendorIdTable.vendorCode;
      case "updatedAt":
        return vendorIdTable.updatedAt;
      case "createdAt":
        return vendorIdTable.createdAt;
      default:
        return vendorIdTable.vendorName;
    }
  })();
  const order = sortDir === "desc" ? desc(sortCol) : asc(sortCol);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(vendorIdTable)
      .where(whereClause)
      .orderBy(order)
      .limit(limit ?? 50)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(vendorIdTable)
      .where(whereClause),
  ]);

  res.json(
    ListVendorsResponse.parse({
      data: rows.map(serializeVendor),
      total: countRows[0]?.count ?? 0,
      page: page ?? 1,
      limit: limit ?? 50,
    }),
  );
});

// ─── POST /vendors (create) ───────────────────────────────────────────────────

router.post("/vendors", async (req, res): Promise<void> => {
  const parsed = CreateVendorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const actor = (parsed.data.actor ?? "").trim();
  if (!actor) {
    res
      .status(400)
      .json({ error: "actor is required to create a vendor (internal pilot — actor identifies who performed the action)" });
    return;
  }

  if (parsed.data.vendorName.trim().length === 0) {
    res.status(400).json({ error: "Vendor name cannot be blank" });
    return;
  }

  if (parsed.data.onHold && !parsed.data.holdReason?.trim()) {
    res.status(400).json({ error: "holdReason is required when onHold is true" });
    return;
  }

  const existing = await db
    .select({ id: vendorIdTable.id })
    .from(vendorIdTable)
    .where(eq(vendorIdTable.vendorCode, parsed.data.vendorCode))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Vendor code already exists" });
    return;
  }

  const cleanedAliases = Array.from(
    new Set(
      (parsed.data.aliases ?? [])
        .map((a) => a.trim())
        .filter((a) => a.length > 0),
    ),
  );

  const [vendor] = await db
    .insert(vendorIdTable)
    .values({
      vendorCode: parsed.data.vendorCode,
      vendorName: parsed.data.vendorName.trim(),
      legalName: parsed.data.legalName ?? null,
      dba: parsed.data.dba ?? null,
      taxId: parsed.data.taxId ?? null,
      address: parsed.data.address ?? null,
      addressLine1: parsed.data.addressLine1 ?? null,
      addressLine2: parsed.data.addressLine2 ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      postalCode: parsed.data.postalCode ?? null,
      country: parsed.data.country ?? null,
      contactEmail: parsed.data.contactEmail ?? null,
      apEmail: parsed.data.apEmail ?? null,
      remittanceEmail: parsed.data.remittanceEmail ?? null,
      contactPhone: parsed.data.contactPhone ?? null,
      website: parsed.data.website ?? null,
      paymentTerms: parsed.data.paymentTerms ?? null,
      termsDays: parsed.data.termsDays ?? null,
      currency: parsed.data.currency ?? null,
      vendorCategory: parsed.data.vendorCategory ?? null,
      vendorType: parsed.data.vendorType ?? null,
      aliases: cleanedAliases,
      onHold: parsed.data.onHold ?? false,
      holdReason: parsed.data.holdReason ?? null,
      requiresPO: parsed.data.requiresPO ?? false,
      notes: parsed.data.notes ?? null,
      createdBy: actor,
      updatedBy: actor,
    })
    .returning();

  await db.insert(vendorAuditLogTable).values({
    vendorId: vendor.id,
    action: "VENDOR_CREATED",
    actor,
    newValue: `${vendor.vendorCode} — ${vendor.vendorName}`,
  });

  res.status(201).json(GetVendorResponse.parse(serializeVendor(vendor)));
});

// ─── POST /vendors/import (bulk JSON import) ──────────────────────────────────

router.post("/vendors/import", async (req, res): Promise<void> => {
  const parsed = ImportVendorsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const uploadedBy = (parsed.data.uploadedBy ?? "").trim() || null;

  // Generate a stable batch ID for this import run so cleanup can scope to it.
  const batchId = `VND-${randomUUID()}`;
  const importedAt = new Date();

  // Create the import_batch tracking record upfront.
  await db.insert(importBatchTable).values({
    batchId,
    importType: "VENDOR_MASTER",
    fileName: `vendor-import-${batchId}.csv`,
    uploadedBy: uploadedBy ?? null,
    rowCount: parsed.data.vendors.length,
    status: "PROCESSING",
  });

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const vendor of parsed.data.vendors) {
    try {
      if (vendor.vendorName.trim().length === 0) {
        skipped++;
        errors.push(
          `${vendor.vendorCode || "(missing code)"}: vendor name cannot be blank`,
        );
        continue;
      }

      if (vendor.onHold && !vendor.holdReason?.trim()) {
        skipped++;
        errors.push(
          `${vendor.vendorCode}: holdReason is required when onHold is true`,
        );
        continue;
      }

      const existing = await db
        .select({ id: vendorIdTable.id })
        .from(vendorIdTable)
        .where(eq(vendorIdTable.vendorCode, vendor.vendorCode))
        .limit(1);

      const cleanedAliases = Array.from(
        new Set(
          (vendor.aliases ?? [])
            .map((a) => a.trim())
            .filter((a) => a.length > 0),
        ),
      );

      if (existing.length > 0) {
        skipped++;
      } else {
        const [inserted_vendor] = await db
          .insert(vendorIdTable)
          .values({
            vendorCode: vendor.vendorCode,
            vendorName: vendor.vendorName.trim(),
            legalName: vendor.legalName ?? null,
            dba: vendor.dba ?? null,
            taxId: vendor.taxId ?? null,
            address: vendor.address ?? null,
            addressLine1: vendor.addressLine1 ?? null,
            addressLine2: vendor.addressLine2 ?? null,
            city: vendor.city ?? null,
            state: vendor.state ?? null,
            postalCode: vendor.postalCode ?? null,
            country: vendor.country ?? null,
            contactEmail: vendor.contactEmail ?? null,
            apEmail: vendor.apEmail ?? null,
            remittanceEmail: vendor.remittanceEmail ?? null,
            contactPhone: vendor.contactPhone ?? null,
            website: vendor.website ?? null,
            paymentTerms: vendor.paymentTerms ?? null,
            termsDays: vendor.termsDays ?? null,
            currency: vendor.currency ?? null,
            vendorCategory: vendor.vendorCategory ?? null,
            vendorType: vendor.vendorType ?? null,
            aliases: cleanedAliases,
            onHold: vendor.onHold ?? false,
            holdReason: vendor.holdReason ?? null,
            requiresPO: vendor.requiresPO ?? false,
            notes: vendor.notes ?? null,
            createdBy: uploadedBy ?? null,
            // Stamp as imported so vendor cleanup can detect and manage this vendor.
            importBatchId: batchId,
            lastImportedAt: importedAt,
          })
          .returning();
        if (inserted_vendor) {
          await db.insert(vendorAuditLogTable).values({
            vendorId: inserted_vendor.id,
            action: "VENDOR_CREATED",
            actor: uploadedBy ?? "system",
            newValue: `${inserted_vendor.vendorCode} — ${inserted_vendor.vendorName} (bulk import, batch ${batchId})`,
          });
        }
        inserted++;
      }
    } catch (err) {
      errors.push(
        `${vendor.vendorCode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Update the batch record with final counts.
  await db
    .update(importBatchTable)
    .set({
      rowsAccepted: inserted,
      rowsRejected: skipped + errors.length,
      status: errors.length > 0 && inserted === 0 ? "FAILED" : "COMPLETED",
    })
    .where(eq(importBatchTable.batchId, batchId));

  res.json(ImportVendorsResponse.parse({ inserted, skipped, errors }));
});

// ─── GET /vendors/profile-export (MUST precede /:id) ─────────────────────────

router.get("/vendors/profile-export", async (req, res): Promise<void> => {
  const parsed = ExportVendorProfilesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { isActive, onHold } = parsed.data;
  const conditions = [];
  if (isActive != null) conditions.push(eq(vendorIdTable.isActive, isActive));
  if (onHold != null) conditions.push(eq(vendorIdTable.onHold, onHold));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const vendors = await db
    .select()
    .from(vendorIdTable)
    .where(where)
    .orderBy(asc(vendorIdTable.vendorName));

  // Invoice activity counts per vendor
  const activityRows = await db
    .select({
      vendorId: invoiceCaptureTable.vendorId,
      invoiceCount: sql<number>`count(*)::int`,
      exceptionCount: sql<number>`count(*) filter (where ${invoiceCaptureTable.status} = 'EXCEPTION')::int`,
    })
    .from(invoiceCaptureTable)
    .where(ne(invoiceCaptureTable.status, "VOIDED"))
    .groupBy(invoiceCaptureTable.vendorId);

  const activityMap = new Map(
    activityRows.map((r) => [r.vendorId, r]),
  );

  const headers = [
    "vendorCode",
    "vendorName",
    "legalName",
    "dba",
    "isActive",
    "onHold",
    "holdReason",
    "requiresPO",
    "vendorCategory",
    "vendorType",
    "paymentTerms",
    "termsDays",
    "currency",
    "apEmail",
    "contactEmail",
    "contactPhone",
    "website",
    "addressLine1",
    "city",
    "state",
    "country",
    "taxId",
    "aliasCount",
    "invoiceCount",
    "exceptionCount",
    "updatedAt",
    "createdAt",
    "importBatchId",
  ];

  const dataRows = vendors.map((v) => {
    const activity = activityMap.get(v.id);
    return [
      v.vendorCode,
      v.vendorName,
      v.legalName ?? "",
      v.dba ?? "",
      String(v.isActive),
      String(v.onHold),
      v.holdReason ?? "",
      String(v.requiresPO),
      v.vendorCategory ?? "",
      v.vendorType ?? "",
      v.paymentTerms ?? "",
      v.termsDays != null ? String(v.termsDays) : "",
      v.currency ?? "",
      v.apEmail ?? "",
      v.contactEmail ?? "",
      v.contactPhone ?? "",
      v.website ?? "",
      v.addressLine1 ?? "",
      v.city ?? "",
      v.state ?? "",
      v.country ?? "",
      v.taxId != null ? "••••" + v.taxId.slice(-4) : "",
      String(((v.aliases as string[] | null) ?? []).length),
      String(activity?.invoiceCount ?? 0),
      String(activity?.exceptionCount ?? 0),
      v.updatedAt instanceof Date
        ? v.updatedAt.toISOString()
        : (v.updatedAt ?? ""),
      v.createdAt instanceof Date ? v.createdAt.toISOString() : String(v.createdAt),
      v.importBatchId ?? "",
    ];
  });

  const csv = toCsv(headers, dataRows);
  const filename = `vendor_profiles_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

// ─── GET /vendors/:id ─────────────────────────────────────────────────────────

router.get("/vendors/:id", async (req, res): Promise<void> => {
  const params = GetVendorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vendor] = await db
    .select()
    .from(vendorIdTable)
    .where(eq(vendorIdTable.id, params.data.id))
    .limit(1);

  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  res.json(GetVendorResponse.parse(serializeVendor(vendor)));
});

// ─── PATCH /vendors/:id (update) ──────────────────────────────────────────────

router.patch("/vendors/:id", async (req, res): Promise<void> => {
  const params = UpdateVendorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateVendorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const actor = parsed.data.actor.trim();
  if (!actor) {
    res.status(400).json({ error: "actor is required to update a vendor" });
    return;
  }

  // Load current vendor for comparison
  const [current] = await db
    .select()
    .from(vendorIdTable)
    .where(eq(vendorIdTable.id, params.data.id))
    .limit(1);

  if (!current) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  // Reject blank vendor name
  if (
    parsed.data.vendorName != null &&
    parsed.data.vendorName.trim().length === 0
  ) {
    res.status(400).json({ error: "Vendor name cannot be blank" });
    return;
  }

  // holdReason required when setting onHold=true
  const newOnHold = parsed.data.onHold ?? null;
  if (newOnHold === true) {
    const newHoldReason =
      parsed.data.holdReason != null
        ? parsed.data.holdReason
        : current.holdReason;
    if (!newHoldReason?.trim()) {
      res
        .status(400)
        .json({ error: "holdReason is required when onHold is true" });
      return;
    }
  }

  // ── Field format validation ───────────────────────────────────────────────
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const [field, val] of [
    ["apEmail", parsed.data.apEmail],
    ["contactEmail", parsed.data.contactEmail],
    ["remittanceEmail", parsed.data.remittanceEmail],
  ] as const) {
    if (val != null && val.trim() !== "" && !emailRegex.test(val.trim())) {
      res.status(400).json({ error: `${field} must be a valid email address` });
      return;
    }
  }

  if (parsed.data.website != null && parsed.data.website.trim() !== "") {
    try {
      const url = new URL(parsed.data.website.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad protocol");
    } catch {
      res.status(400).json({ error: "website must be a valid https:// URL" });
      return;
    }
  }

  if (parsed.data.termsDays != null && parsed.data.termsDays < 0) {
    res.status(400).json({ error: "termsDays must be 0 or greater" });
    return;
  }

  // ── vendorCode change: uniqueness + reference guard + PO cascade ─────────
  if (parsed.data.vendorCode != null) {
    const newCode = parsed.data.vendorCode.trim();
    if (newCode !== current.vendorCode) {
      const [existing] = await db
        .select({ id: vendorIdTable.id })
        .from(vendorIdTable)
        .where(and(eq(vendorIdTable.vendorCode, newCode), ne(vendorIdTable.id, params.data.id)))
        .limit(1);
      if (existing) {
        res.status(409).json({ error: `Vendor code "${newCode}" is already in use by another vendor` });
        return;
      }

      const [invRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoiceCaptureTable)
        .where(eq(invoiceCaptureTable.vendorId, params.data.id));

      const invCount = invRow?.count ?? 0;

      if (invCount > 0 && !parsed.data.adminOverride) {
        res.status(409).json({
          error: `Vendor code cannot be changed: referenced by ${invCount} invoice(s). Set adminOverride=true with a reason to proceed.`,
        });
        return;
      }

      if (invCount > 0 && parsed.data.adminOverride) {
        if (!parsed.data.reason?.trim()) {
          res.status(400).json({ error: "reason is required when using adminOverride to change a referenced vendor code" });
          return;
        }
      }
    }
  }

  // Build the updates object — only include explicitly provided fields
  const updates: Record<string, unknown> = { updatedBy: actor };

  const textField = (
    key: keyof typeof current,
    val: string | null | undefined,
  ) => {
    if (val !== undefined) updates[key] = val;
  };
  const boolField = (
    key: keyof typeof current,
    val: boolean | null | undefined,
  ) => {
    if (val != null) updates[key] = val;
  };
  const intField = (
    key: keyof typeof current,
    val: number | null | undefined,
  ) => {
    if (val !== undefined) updates[key] = val;
  };

  if (parsed.data.vendorCode != null) updates.vendorCode = parsed.data.vendorCode.trim();
  if (parsed.data.vendorName != null)
    updates.vendorName = parsed.data.vendorName.trim();
  textField("legalName", parsed.data.legalName);
  textField("dba", parsed.data.dba);
  textField("taxId", parsed.data.taxId);
  textField("address", parsed.data.address);
  textField("addressLine1", parsed.data.addressLine1);
  textField("addressLine2", parsed.data.addressLine2);
  textField("city", parsed.data.city);
  textField("state", parsed.data.state);
  textField("postalCode", parsed.data.postalCode);
  textField("country", parsed.data.country);
  textField("contactEmail", parsed.data.contactEmail);
  textField("apEmail", parsed.data.apEmail);
  textField("remittanceEmail", parsed.data.remittanceEmail);
  textField("contactPhone", parsed.data.contactPhone);
  textField("website", parsed.data.website);
  textField("paymentTerms", parsed.data.paymentTerms);
  intField("termsDays", parsed.data.termsDays);
  textField("currency", parsed.data.currency);
  textField("vendorCategory", parsed.data.vendorCategory);
  textField("vendorType", parsed.data.vendorType);
  textField("holdReason", parsed.data.holdReason);
  textField("notes", parsed.data.notes);
  boolField("onHold", parsed.data.onHold);
  boolField("isActive", parsed.data.isActive);
  boolField("requiresPO", parsed.data.requiresPO);

  if (parsed.data.aliases !== undefined) {
    const seen = new Set<string>();
    const cleaned = parsed.data.aliases
      .map((a) => a.trim())
      .filter((a) => {
        if (a.length === 0) return false;
        const key = a.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    updates.aliases = cleaned;
  }

  const [vendor] = await db
    .update(vendorIdTable)
    .set(updates)
    .where(eq(vendorIdTable.id, params.data.id))
    .returning();

  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  // ── Audit changed fields ──
  const auditEntries: Array<{
    vendorId: number;
    action: string;
    fieldName?: string;
    oldValue?: string;
    newValue?: string;
    actor: string;
    reason?: string;
  }> = [];

  const reason = parsed.data.reason ?? undefined;

  const trackField = (
    field: string,
    oldVal: unknown,
    newVal: unknown,
  ) => {
    const oldStr = oldVal != null ? String(oldVal) : null;
    const newStr = newVal != null ? String(newVal) : null;
    if (oldStr !== newStr) {
      auditEntries.push({
        vendorId: vendor.id,
        action: "VENDOR_FIELD_UPDATED",
        fieldName: field,
        oldValue: oldStr ?? undefined,
        newValue: newStr ?? undefined,
        actor,
        reason,
      });
    }
  };

  if (updates.vendorName !== undefined) trackField("vendorName", current.vendorName, updates.vendorName);
  if (updates.legalName !== undefined) trackField("legalName", current.legalName, updates.legalName);
  if (updates.dba !== undefined) trackField("dba", current.dba, updates.dba);
  if (updates.taxId !== undefined) trackField("taxId", current.taxId, updates.taxId);
  if (updates.paymentTerms !== undefined) trackField("paymentTerms", current.paymentTerms, updates.paymentTerms);
  if (updates.termsDays !== undefined) trackField("termsDays", current.termsDays, updates.termsDays);
  if (updates.currency !== undefined) trackField("currency", current.currency, updates.currency);
  if (updates.vendorCategory !== undefined) trackField("vendorCategory", current.vendorCategory, updates.vendorCategory);
  if (updates.vendorType !== undefined) trackField("vendorType", current.vendorType, updates.vendorType);
  if (updates.apEmail !== undefined) trackField("apEmail", current.apEmail, updates.apEmail);
  if (updates.contactEmail !== undefined) trackField("contactEmail", current.contactEmail, updates.contactEmail);
  if (updates.remittanceEmail !== undefined) trackField("remittanceEmail", current.remittanceEmail, updates.remittanceEmail);
  if (updates.contactPhone !== undefined) trackField("contactPhone", current.contactPhone, updates.contactPhone);
  if (updates.website !== undefined) trackField("website", current.website, updates.website);
  if (updates.notes !== undefined) trackField("notes", current.notes, updates.notes);
  if (updates.addressLine1 !== undefined) trackField("addressLine1", current.addressLine1, updates.addressLine1);
  if (updates.city !== undefined) trackField("city", current.city, updates.city);
  if (updates.state !== undefined) trackField("state", current.state, updates.state);
  if (updates.country !== undefined) trackField("country", current.country, updates.country);
  if (updates.requiresPO !== undefined) trackField("requiresPO", current.requiresPO, updates.requiresPO);

  // Status-level changes get their own action for clear audit visibility
  if (updates.isActive !== undefined && current.isActive !== updates.isActive) {
    auditEntries.push({
      vendorId: vendor.id,
      action: "VENDOR_STATUS_CHANGED",
      fieldName: "isActive",
      oldValue: String(current.isActive),
      newValue: String(updates.isActive),
      actor,
      reason,
    });
  }
  if (updates.onHold !== undefined && current.onHold !== updates.onHold) {
    auditEntries.push({
      vendorId: vendor.id,
      action: "VENDOR_HOLD_CHANGED",
      fieldName: "onHold",
      oldValue: String(current.onHold),
      newValue: String(updates.onHold),
      actor,
      reason,
    });
  }
  if (updates.holdReason !== undefined && current.holdReason !== updates.holdReason) {
    trackField("holdReason", current.holdReason, updates.holdReason);
  }

  if (updates.vendorCode !== undefined && String(updates.vendorCode) !== current.vendorCode) {
    auditEntries.push({
      vendorId: vendor.id,
      action: "VENDOR_CODE_CHANGED",
      fieldName: "vendorCode",
      oldValue: current.vendorCode,
      newValue: String(updates.vendorCode),
      actor,
      reason,
    });
  }

  if (updates.aliases !== undefined) {
    const oldAliases = JSON.stringify((current.aliases as string[]) ?? []);
    const newAliases = JSON.stringify(updates.aliases);
    if (oldAliases !== newAliases) {
      auditEntries.push({
        vendorId: vendor.id,
        action: "VENDOR_ALIASES_CHANGED",
        fieldName: "aliases",
        oldValue: oldAliases,
        newValue: newAliases,
        actor,
        reason,
      });
    }
  }

  if (auditEntries.length > 0) {
    await db.insert(vendorAuditLogTable).values(auditEntries);
  }

  res.json(UpdateVendorResponse.parse(serializeVendor(vendor)));
});

// ─── GET /vendors/:id/activity ────────────────────────────────────────────────

router.get("/vendors/:id/activity", async (req, res): Promise<void> => {
  const params = GetVendorActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vendor] = await db
    .select({ id: vendorIdTable.id })
    .from(vendorIdTable)
    .where(eq(vendorIdTable.id, params.data.id))
    .limit(1);

  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const [agg] = await db
    .select({
      invoiceCount: sql<number>`count(*)`,
      totalInvoiceAmount: sql<number>`coalesce(sum(${invoiceCaptureTable.totalAmount}), 0)`,
      latestInvoiceDate: sql<string | null>`max(${invoiceCaptureTable.invoiceDate})`,
      exceptionCount: sql<number>`sum(case when ${invoiceCaptureTable.status}::text = 'EXCEPTION' then 1 else 0 end)`,
      pendingApprovalCount: sql<number>`sum(case when ${invoiceCaptureTable.status}::text = 'PENDING_APPROVAL' then 1 else 0 end)`,
      approvedCount: sql<number>`sum(case when ${invoiceCaptureTable.status}::text = 'APPROVED' then 1 else 0 end)`,
      postedOrExportedCount: sql<number>`sum(case when ${invoiceCaptureTable.status}::text in ('POSTED', 'EXPORTED', 'EXPORT_READY') then 1 else 0 end)`,
      avgVendorMatchConfidence: sql<number | null>`avg(${invoiceCaptureTable.vendorMatchScore})`,
    })
    .from(invoiceCaptureTable)
    .where(
      and(
        eq(invoiceCaptureTable.vendorId, params.data.id),
        sql`${invoiceCaptureTable.status}::text != 'VOIDED'`,
      ),
    );

  res.json(
    GetVendorActivityResponse.parse({
      vendorId: params.data.id,
      invoiceCount: Number(agg?.invoiceCount ?? 0),
      totalInvoiceAmount: Number(agg?.totalInvoiceAmount ?? 0),
      latestInvoiceDate: agg?.latestInvoiceDate ?? null,
      exceptionCount: Number(agg?.exceptionCount ?? 0),
      pendingApprovalCount: Number(agg?.pendingApprovalCount ?? 0),
      approvedCount: Number(agg?.approvedCount ?? 0),
      postedOrExportedCount: Number(agg?.postedOrExportedCount ?? 0),
      avgVendorMatchConfidence:
        agg?.avgVendorMatchConfidence != null
          ? Number(agg.avgVendorMatchConfidence)
          : null,
    }),
  );
});

// ─── DELETE /vendors/:id ─────────────────────────────────────────────────────
// Permanent hard delete for test-data cleanup.  Refuses if any non-VOIDED
// invoice still references this vendor (clean up invoices first).  Requires
// { confirm: true } in the request body as an explicit safety gate.

router.delete("/vendors/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid vendor id" });
    return;
  }
  if (req.body?.confirm !== true) {
    res.status(422).json({ error: "Deletion must be explicitly confirmed (confirm: true)." });
    return;
  }

  const [vendor] = await db
    .select({ id: vendorIdTable.id, vendorCode: vendorIdTable.vendorCode })
    .from(vendorIdTable)
    .where(eq(vendorIdTable.id, id))
    .limit(1);

  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  // Block deletion if any active (non-VOIDED) invoice still references this vendor.
  const [activeRef] = await db
    .select({ id: invoiceCaptureTable.id })
    .from(invoiceCaptureTable)
    .where(
      and(
        eq(invoiceCaptureTable.vendorId, id),
        ne(invoiceCaptureTable.status, "VOIDED"),
      ),
    )
    .limit(1);

  if (activeRef) {
    res.status(409).json({
      error:
        "Vendor has active (non-VOIDED) invoices. Void or delete all referencing invoices first.",
    });
    return;
  }

  // Delete audit log rows then the vendor row.
  await db.transaction(async (tx) => {
    await tx.delete(vendorAuditLogTable).where(eq(vendorAuditLogTable.vendorId, id));
    await tx.delete(vendorIdTable).where(eq(vendorIdTable.id, id));
  });

  res.json({ deleted: true, deletedVendorId: id });
});

// ─── GET /vendors/:id/audit ───────────────────────────────────────────────────

router.get("/vendors/:id/audit", async (req, res): Promise<void> => {
  const params = GetVendorAuditLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vendor] = await db
    .select({ id: vendorIdTable.id })
    .from(vendorIdTable)
    .where(eq(vendorIdTable.id, params.data.id))
    .limit(1);

  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const entries = await db
    .select()
    .from(vendorAuditLogTable)
    .where(eq(vendorAuditLogTable.vendorId, params.data.id))
    .orderBy(desc(vendorAuditLogTable.createdAt))
    .limit(200);

  res.json(GetVendorAuditLogResponse.parse(entries.map(serializeAuditEntry)));
});

export default router;
