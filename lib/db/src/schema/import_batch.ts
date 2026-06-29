import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  json,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface ImportRowError {
  row: number;
  column?: string;
  message: string;
}

export const importBatchTable = pgTable("import_batch", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull().unique(),
  importType: text("import_type").notNull(),
  fileName: text("file_name").notNull(),
  uploadedBy: text("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  rowCount: integer("row_count").notNull().default(0),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  status: text("status").notNull().default("PENDING"),
  cleanupStatus: text("cleanup_status").notNull().default("ACTIVE"),
  errorSummary: text("error_summary"),
  rowErrors: json("row_errors").$type<ImportRowError[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertImportBatchSchema = createInsertSchema(importBatchTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ImportBatch = typeof importBatchTable.$inferSelect;
