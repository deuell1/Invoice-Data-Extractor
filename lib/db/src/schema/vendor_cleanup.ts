import { pgTable, serial, text, integer, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface VendorCleanupDetail {
  vendorId: number;
  vendorCode: string;
  vendorName: string;
  oldStatus: string;
  newStatus: string;
  action: "DELETED" | "DEACTIVATED" | "SKIPPED";
  reason: string;
}

export const vendorCleanupLogTable = pgTable("vendor_cleanup_log", {
  id: serial("id").primaryKey(),
  cleanupId: text("cleanup_id").notNull().unique(),
  mode: text("mode").notNull(),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
  vendorsReviewed: integer("vendors_reviewed").notNull().default(0),
  vendorsDeleted: integer("vendors_deleted").notNull().default(0),
  vendorsDeactivated: integer("vendors_deactivated").notNull().default(0),
  vendorsSkipped: integer("vendors_skipped").notNull().default(0),
  details: json("details").$type<VendorCleanupDetail[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorCleanupLogSchema = createInsertSchema(vendorCleanupLogTable).omit({
  id: true,
  createdAt: true,
});

export type InsertVendorCleanupLog = z.infer<typeof insertVendorCleanupLogSchema>;
export type VendorCleanupLog = typeof vendorCleanupLogTable.$inferSelect;
