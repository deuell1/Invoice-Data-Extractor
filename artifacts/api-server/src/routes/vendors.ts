import { Router, type IRouter } from "express";
import { eq, ilike, sql, and } from "drizzle-orm";
import { db, vendorIdTable } from "@workspace/db";
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
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeVendor(row: typeof vendorIdTable.$inferSelect) {
  return {
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : (row.updatedAt ?? null),
  };
}

router.get("/vendors", async (req, res): Promise<void> => {
  const parsed = ListVendorsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, page, limit } = parsed.data;
  const offset = ((page ?? 1) - 1) * (limit ?? 50);

  const conditions = search
    ? [ilike(vendorIdTable.vendorName, `%${search}%`)]
    : [];

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(vendorIdTable)
      .where(whereClause)
      .orderBy(vendorIdTable.vendorName)
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
    })
  );
});

router.post("/vendors", async (req, res): Promise<void> => {
  const parsed = CreateVendorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(vendorIdTable)
    .where(eq(vendorIdTable.vendorCode, parsed.data.vendorCode))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Vendor code already exists" });
    return;
  }

  const [vendor] = await db.insert(vendorIdTable).values(parsed.data).returning();
  res.status(201).json(GetVendorResponse.parse(serializeVendor(vendor)));
});

router.post("/vendors/import", async (req, res): Promise<void> => {
  const parsed = ImportVendorsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const vendor of parsed.data.vendors) {
    try {
      const existing = await db
        .select({ id: vendorIdTable.id })
        .from(vendorIdTable)
        .where(eq(vendorIdTable.vendorCode, vendor.vendorCode))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
      } else {
        await db.insert(vendorIdTable).values(vendor);
        inserted++;
      }
    } catch (err) {
      errors.push(`${vendor.vendorCode}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json(ImportVendorsResponse.parse({ inserted, skipped, errors }));
});

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

  const updates: Record<string, unknown> = {};
  if (parsed.data.vendorName != null) updates.vendorName = parsed.data.vendorName;
  if (parsed.data.taxId !== undefined) updates.taxId = parsed.data.taxId;
  if (parsed.data.address !== undefined) updates.address = parsed.data.address;
  if (parsed.data.contactEmail !== undefined) updates.contactEmail = parsed.data.contactEmail;
  if (parsed.data.contactPhone !== undefined) updates.contactPhone = parsed.data.contactPhone;
  if (parsed.data.paymentTerms !== undefined) updates.paymentTerms = parsed.data.paymentTerms;
  if (parsed.data.isActive != null) updates.isActive = parsed.data.isActive;

  const [vendor] = await db
    .update(vendorIdTable)
    .set(updates)
    .where(eq(vendorIdTable.id, params.data.id))
    .returning();

  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  res.json(UpdateVendorResponse.parse(serializeVendor(vendor)));
});

export default router;
