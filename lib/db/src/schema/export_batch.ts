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

export const exportBatchTable = pgTable("export_batch", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull().unique(),
  exportType: text("export_type").notNull(),
  format: text("format").notNull().default("CSV"),
  filterJson: json("filter_json").$type<Record<string, unknown>>().default({}),
  recordCount: integer("record_count").notNull().default(0),
  exportedBy: text("exported_by"),
  exportedAt: timestamp("exported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  fileName: text("file_name"),
  fileObjectPath: text("file_object_path"),
  status: text("status").notNull().default("SUCCESS"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertExportBatchSchema = createInsertSchema(exportBatchTable).omit({
  id: true,
  createdAt: true,
});

export type InsertExportBatch = z.infer<typeof insertExportBatchSchema>;
export type ExportBatch = typeof exportBatchTable.$inferSelect;
