import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Tracks the Graph API delta-sync cursor for each ingested mailbox.
 * One row per mailbox address. deltaToken = null means "never synced —
 * start a full initial sync". lastSyncedAt is updated after every
 * successful incremental run.
 */
export const inboxSyncStateTable = pgTable("inbox_sync_state", {
  id: serial("id").primaryKey(),
  mailboxAddress: text("mailbox_address").notNull().unique(),
  deltaToken: text("delta_token"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertInboxSyncStateSchema = createInsertSchema(
  inboxSyncStateTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInboxSyncState = z.infer<typeof insertInboxSyncStateSchema>;
export type InboxSyncState = typeof inboxSyncStateTable.$inferSelect;
