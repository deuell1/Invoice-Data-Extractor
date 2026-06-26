import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  json,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Records the outcome of a labeled extraction-accuracy run against a ground-truth
 * test pack. Rows are only created from real measured runs — the UI shows
 * "Not measured" when no rows exist. Never fabricate results.
 */
export const accuracyRunTable = pgTable("accuracy_run", {
  id: serial("id").primaryKey(),
  runDate: timestamp("run_date", { withTimezone: true }).notNull().defaultNow(),
  testPackName: text("test_pack_name").notNull(),
  invoicesTested: integer("invoices_tested").notNull().default(0),
  fieldsTested: integer("fields_tested").notNull().default(0),
  correctFields: integer("correct_fields").notNull().default(0),
  incorrectFields: integer("incorrect_fields").notNull().default(0),
  missingFields: integer("missing_fields").notNull().default(0),
  overallAccuracy: numeric("overall_accuracy", { precision: 5, scale: 2 }),
  accuracyByCategory: json("accuracy_by_category")
    .$type<Record<string, number>>()
    .default({}),
  threshold: numeric("threshold", { precision: 5, scale: 2 }),
  passed: boolean("passed"),
  reportRef: text("report_ref"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAccuracyRunSchema = createInsertSchema(accuracyRunTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAccuracyRun = z.infer<typeof insertAccuracyRunSchema>;
export type AccuracyRun = typeof accuracyRunTable.$inferSelect;
