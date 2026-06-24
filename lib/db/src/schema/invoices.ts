import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorIdTable } from "./vendors";
import { sourceDocumentsTable } from "./source_documents";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "PENDING_EXTRACTION",
  "EXCEPTION",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
]);

export const invoiceRoleEnum = pgEnum("invoice_role", [
  "AP_PROCESSOR",
  "AP_APPROVER",
]);

export const invoiceCaptureTable = pgTable("invoice_capture", {
  id: serial("id").primaryKey(),
  status: invoiceStatusEnum("status").notNull().default("PENDING_EXTRACTION"),
  vendorId: integer("vendor_id").references(() => vendorIdTable.id),
  vendorName: text("vendor_name"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }),
  poNumber: text("po_number"),
  currency: text("currency").notNull().default("USD"),
  fileObjectPath: text("file_object_path").notNull(),
  originalFileName: text("original_file_name").notNull(),
  sourceDocumentId: integer("source_document_id").references(
    () => sourceDocumentsTable.id,
  ),
  invoiceSequence: integer("invoice_sequence"),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  documentId: text("document_id"),
  businessDocumentId: text("business_document_id"),
  vendorRawName: text("vendor_raw_name"),
  dueDate: text("due_date"),
  voucherId: text("voucher_id"),
  exceptionReason: text("exception_reason"),
  lowConfidenceFields: text("low_confidence_fields"),
  fieldConfidence: text("field_confidence"),
  rawExtraction: text("raw_extraction"),
  extractionNotes: text("extraction_notes"),
  lastExtractedAt: timestamp("last_extracted_at", { withTimezone: true }),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }),
  freightAmount: numeric("freight_amount", { precision: 18, scale: 2 }),
  paymentTerms: text("payment_terms"),
  vendorMatchScore: numeric("vendor_match_score", { precision: 5, scale: 4 }),
  validationStatus: text("validation_status"),
  reviewStatus: text("review_status"),
  overallReviewStatus: text("overall_review_status"),
  duplicateCheck: text("duplicate_check"),
  vendorCheck: text("vendor_check"),
  poCheck: text("po_check"),
  amountCheck: text("amount_check"),
  totalTieOut: text("total_tie_out"),
  validationDetails: text("validation_details"),
  extractionStatus: text("extraction_status").notNull().default("PENDING"),
  extractionError: text("extraction_error"),
  extractionAttempts: integer("extraction_attempts").notNull().default(0),
  extractionErrorDetail: text("extraction_error_detail"),
  role: invoiceRoleEnum("role").notNull().default("AP_PROCESSOR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertInvoiceSchema = createInsertSchema(invoiceCaptureTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InvoiceCapture = typeof invoiceCaptureTable.$inferSelect;
