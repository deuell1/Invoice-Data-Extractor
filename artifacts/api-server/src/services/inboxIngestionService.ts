/**
 * Email-inbox ingestion orchestrator.
 *
 * Ties together the three pieces for one sync run:
 *   1. Read the current delta token from inbox_sync_state
 *   2. Fetch new message attachments via the Graph API client
 *   3. Store each file in object storage and create a source-document record
 *   4. Advance the delta-token checkpoint (even on partial success)
 *
 * Intentionally has no route and no scheduler wiring — it is a pure service
 * function, callable but not yet triggered from anywhere.
 */

import { db, inboxSyncStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  isGraphIngestionConfigured,
  fetchNewMailAttachments,
} from "./graphMailClient";
import { ObjectStorageService } from "../lib/objectStorage";
import { createSourceDocument } from "./sourceDocumentService";

export interface SyncInboxResult {
  processed: number;
  skipped: number;
  errors: number;
}

/**
 * Run one inbox sync pass: fetch new attachments since the last delta token,
 * ingest each qualifying file as a source document, then advance the
 * checkpoint.
 *
 * Safe to call from a cron job that fires before real Graph credentials
 * exist — if the four required env vars are not all set, it logs a WARN and
 * returns immediately without throwing.
 *
 * Individual attachment failures are isolated: one bad file does not abort
 * the rest of the batch, and the delta token is still advanced after the
 * loop so the same batch is not retried endlessly on the next run.
 */
export async function syncInboxOnce(): Promise<SyncInboxResult> {
  // Step a: guard — safe to call at any time, even before credentials exist.
  if (!isGraphIngestionConfigured()) {
    logger.warn(
      "Graph ingestion is not configured — skipping inbox sync. " +
        "Set GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID, and " +
        "GRAPH_MAILBOX_ADDRESS to enable.",
    );
    return { processed: 0, skipped: 0, errors: 0 };
  }

  const mailboxAddress = process.env.GRAPH_MAILBOX_ADDRESS!;

  // Step b: read the current delta token. Do not create the row yet — only
  // write it after a successful run (step e) so a mid-run crash doesn't
  // persist a bad token.
  const [existingState] = await db
    .select({
      deltaToken: inboxSyncStateTable.deltaToken,
    })
    .from(inboxSyncStateTable)
    .where(eq(inboxSyncStateTable.mailboxAddress, mailboxAddress))
    .limit(1);

  const deltaToken = existingState?.deltaToken ?? null;

  // Step c: fetch new attachments from Graph.
  const result = await fetchNewMailAttachments(deltaToken);

  const storage = new ObjectStorageService();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Step d: ingest each attachment, isolated so one failure doesn't abort the batch.
  for (const attachment of result.attachments) {
    try {
      const fileObjectPath = await storage.uploadObjectBuffer(
        attachment.buffer,
        attachment.contentType,
      );

      await createSourceDocument({
        fileObjectPath,
        originalFileName: attachment.filename,
        contentType: attachment.contentType,
        sourceChannel: "AP Email",
      });

      processed++;
    } catch (err) {
      logger.error(
        {
          filename: attachment.filename,
          contentType: attachment.contentType,
          err: err instanceof Error ? err.message : String(err),
        },
        "Graph ingestion: failed to ingest attachment — skipping",
      );
      errors++;
    }
  }

  // Step e: upsert the checkpoint even on partial success — a partial-success
  // run should advance past the messages it saw, not endlessly retry them.
  await db
    .insert(inboxSyncStateTable)
    .values({
      mailboxAddress,
      deltaToken: result.newDeltaToken,
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: inboxSyncStateTable.mailboxAddress,
      set: {
        deltaToken: result.newDeltaToken,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  logger.info(
    { processed, skipped, errors, mailboxAddress },
    "Graph ingestion: inbox sync complete",
  );

  return { processed, skipped, errors };
}
