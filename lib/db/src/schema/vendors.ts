import { pgTable, serial, text, boolean, timestamp, json, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vendorIdTable = pgTable("vendor_id", {
  id: serial("id").primaryKey(),
  vendorCode: text("vendor_code").notNull().unique(),
  vendorName: text("vendor_name").notNull(),
  legalName: text("legal_name"),
  dba: text("dba"),
  taxId: text("tax_id"),
  address: text("address"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country"),
  contactEmail: text("contact_email"),
  apEmail: text("ap_email"),
  remittanceEmail: text("remittance_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  paymentTerms: text("payment_terms"),
  termsDays: integer("terms_days"),
  currency: text("currency"),
  vendorCategory: text("vendor_category"),
  vendorType: text("vendor_type"),
  aliases: json("aliases").$type<string[]>().default([]),
  onHold: boolean("on_hold").notNull().default(false),
  holdReason: text("hold_reason"),
  isActive: boolean("is_active").notNull().default(true),
  requiresPO: boolean("requires_po").notNull().default(false),
  notes: text("notes"),
  importBatchId: text("import_batch_id"),
  lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
});

export const insertVendorSchema = createInsertSchema(vendorIdTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorIdTable.$inferSelect;
