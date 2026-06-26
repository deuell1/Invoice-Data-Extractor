import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoiceCaptureTable } from "./invoices";

/**
 * Exception-management activity thread for an invoice: internal notes, owner
 * assignments, reviewed marks, and return-to-approval actions. Field-level edits
 * stay in invoice_audit_log; this table is the exception history surface.
 */
export const exceptionEventTable = pgTable("exception_event", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoiceCaptureTable.id),
  eventType: text("event_type").notNull(),
  note: text("note"),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertExceptionEventSchema = createInsertSchema(
  exceptionEventTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertExceptionEvent = z.infer<typeof insertExceptionEventSchema>;
export type ExceptionEvent = typeof exceptionEventTable.$inferSelect;
