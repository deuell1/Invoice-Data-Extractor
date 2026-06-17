import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const poHeaderTable = pgTable("po_header", {
  id: serial("id").primaryKey(),
  poNumber: text("po_number").notNull().unique(),
  vendorCode: text("vendor_code"),
  description: text("description"),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPoHeaderSchema = createInsertSchema(poHeaderTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPoHeader = z.infer<typeof insertPoHeaderSchema>;
export type PoHeader = typeof poHeaderTable.$inferSelect;
