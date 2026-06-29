import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vendorAuditLogTable = pgTable("vendor_audit_log", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull(),
  action: text("action").notNull(),
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  actor: text("actor").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorAuditSchema = createInsertSchema(vendorAuditLogTable).omit({
  id: true,
  createdAt: true,
});

export type InsertVendorAudit = z.infer<typeof insertVendorAuditSchema>;
export type VendorAuditLog = typeof vendorAuditLogTable.$inferSelect;
