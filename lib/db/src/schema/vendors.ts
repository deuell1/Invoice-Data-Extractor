import { pgTable, serial, text, boolean, timestamp, json, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vendorIdTable = pgTable("vendor_id", {
  id: serial("id").primaryKey(),
  vendorCode: text("vendor_code").notNull().unique(),
  vendorName: text("vendor_name").notNull(),
  taxId: text("tax_id"),
  address: text("address"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  paymentTerms: text("payment_terms"),
  termsDays: integer("terms_days"),
  aliases: json("aliases").$type<string[]>().default([]),
  onHold: boolean("on_hold").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  importBatchId: text("import_batch_id"),
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
