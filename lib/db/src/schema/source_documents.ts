import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sourceDocumentStatusEnum = pgEnum("source_document_status", [
  "PENDING",
  "DETECTING",
  "COMPLETED",
  "EXCEPTION",
]);

export const sourceDocumentsTable = pgTable("source_documents", {
  id: serial("id").primaryKey(),
  originalFileName: text("original_file_name").notNull(),
  fileObjectPath: text("file_object_path").notNull(),
  fileHash: text("file_hash"),
  duplicateOfSourceDocumentId: integer("duplicate_of_source_document_id"),
  sourceChannel: text("source_channel").notNull().default("UPLOAD"),
  uploadedBy: text("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  pageCount: integer("page_count"),
  detectedInvoiceCount: integer("detected_invoice_count"),
  processingStatus: sourceDocumentStatusEnum("processing_status")
    .notNull()
    .default("PENDING"),
  processingError: text("processing_error"),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: text("removed_by"),
  removalReason: text("removal_reason"),
  removalNote: text("removal_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertSourceDocumentSchema = createInsertSchema(
  sourceDocumentsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSourceDocument = z.infer<typeof insertSourceDocumentSchema>;
export type SourceDocument = typeof sourceDocumentsTable.$inferSelect;
