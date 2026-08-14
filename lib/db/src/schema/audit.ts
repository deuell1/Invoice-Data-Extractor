import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoiceCaptureTable } from "./invoices";

export const invoiceAuditLogTable = pgTable("invoice_audit_log", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoiceCaptureTable.id),
  action: text("action").notNull(),
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  editorRole: text("editor_role"),
  note: text("note"),
  /** Clerk userId of the authenticated user who performed the action. */
  actorClerkId: text("actor_clerk_id").notNull(),
  /** Human-readable display name resolved from Clerk at write time. */
  actorName: text("actor_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(invoiceAuditLogTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof invoiceAuditLogTable.$inferSelect;
