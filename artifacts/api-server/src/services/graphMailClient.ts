/**
 * Microsoft Graph API mail client — inbox delta-sync for email-based invoice ingestion.
 *
 * Intentionally isolated: no object-storage writes, no database writes, no
 * dependency on sourceDocumentService. The only side-effects are the HTTP calls
 * to Microsoft Graph and the MSAL token endpoint.
 *
 * Required env vars (all four must be non-empty for ingestion to be active):
 *   GRAPH_CLIENT_ID         Azure app registration client ID
 *   GRAPH_CLIENT_SECRET     Azure app registration client secret  (never logged)
 *   GRAPH_TENANT_ID         Azure AD tenant ID
 *   GRAPH_MAILBOX_ADDRESS   UPN or shared-mailbox address to poll (e.g. ap@contoso.com)
 */

import { ConfidentialClientApplication } from "@azure/msal-node";
import { logger } from "../lib/logger";

const GRAPH_SCOPES = ["https://graph.microsoft.com/.default"];

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
 * Returns true only if all four required Graph env vars are set and non-empty.
 * Mirror of isExtractionConfigured() — a simple, self-contained boolean check
 * with no side effects.
 */
export function isGraphIngestionConfigured(): boolean {
  return !!(
    process.env.GRAPH_CLIENT_ID?.trim() &&
    process.env.GRAPH_CLIENT_SECRET?.trim() &&
    process.env.GRAPH_TENANT_ID?.trim() &&
    process.env.GRAPH_MAILBOX_ADDRESS?.trim()
  );
}

/**
 * Log the resolved Graph ingestion configuration at startup.
 * Logs whether it is configured and which mailbox is targeted.
 * NEVER logs GRAPH_CLIENT_SECRET — only a boolean `configured: true/false`.
 *
 * If only some of the four vars are set, logs a WARN — a half-configured
 * state is a likely real mistake (unlike a deliberate opt-out, which would
 * leave all four unset).
 *
 * Must be called from index.ts after env vars are loaded.
 */
export function logGraphIngestionBootInfo(): void {
  const clientId = process.env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();
  const tenantId = process.env.GRAPH_TENANT_ID?.trim();
  const mailboxAddress = process.env.GRAPH_MAILBOX_ADDRESS?.trim();

  const setCount = [clientId, clientSecret, tenantId, mailboxAddress].filter(
    Boolean,
  ).length;

  if (setCount > 0 && setCount < 4) {
    // Some but not all vars are present — almost certainly a misconfiguration.
    const missing: string[] = [];
    if (!clientId) missing.push("GRAPH_CLIENT_ID");
    if (!clientSecret) missing.push("GRAPH_CLIENT_SECRET");
    if (!tenantId) missing.push("GRAPH_TENANT_ID");
    if (!mailboxAddress) missing.push("GRAPH_MAILBOX_ADDRESS");
    logger.warn(
      { missingVars: missing, presentCount: setCount },
      "Graph ingestion: partially configured — some env vars are set but others are missing. This is likely a configuration error.",
    );
    return;
  }

  logger.info(
    {
      configured: setCount === 4,
      mailboxAddress: mailboxAddress ?? null,
    },
    "Graph ingestion service configuration",
  );
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface FetchedAttachment {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface MailboxDeltaResult {
  attachments: FetchedAttachment[];
  /** Full @odata.deltaLink URL — store as-is in inbox_sync_state.delta_token
   *  and pass back on the next call to resume from this point. */
  newDeltaToken: string;
}

// ---------------------------------------------------------------------------
// Delta sync
// ---------------------------------------------------------------------------

/**
 * Fetches new message attachments from the configured mailbox inbox since
 * the last sync.
 *
 * @param deltaToken  The @odata.deltaLink URL returned by the previous call,
 *                    or null to start a full initial sync from scratch.
 * @returns           All PDF / image attachments found on new messages, plus
 *                    the new delta token to use on the next call.
 *
 * @throws  If Graph ingestion is not configured (all four env vars must be
 *          set). Checked at call time — never at module load time.
 * @throws  If the MSAL token request fails or any Graph API call returns an
 *          error status.
 */
export async function fetchNewMailAttachments(
  deltaToken: string | null,
): Promise<MailboxDeltaResult> {
  // Guard: check configuration at call time only — never at module load.
  if (!isGraphIngestionConfigured()) {
    throw new Error(
      "Graph ingestion is not configured — GRAPH_CLIENT_ID/SECRET/TENANT_ID/MAILBOX_ADDRESS missing",
    );
  }

  // Read env vars at call time so a secret added after boot works without
  // requiring a restart-order dependency.
  const clientId = process.env.GRAPH_CLIENT_ID!;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET!;
  const tenantId = process.env.GRAPH_TENANT_ID!;
  const mailboxAddress = process.env.GRAPH_MAILBOX_ADDRESS!;

  // ---------------------------------------------------------------------------
  // Token acquisition — client-credentials flow via MSAL
  // ---------------------------------------------------------------------------
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  });

  const tokenResponse = await cca.acquireTokenByClientCredential({
    scopes: GRAPH_SCOPES,
  });

  if (!tokenResponse?.accessToken) {
    throw new Error(
      "Graph ingestion: MSAL did not return an access token — check GRAPH_CLIENT_ID/SECRET/TENANT_ID",
    );
  }

  const accessToken = tokenResponse.accessToken;

  // ---------------------------------------------------------------------------
  // Delta query — paginate fully before returning
  // ---------------------------------------------------------------------------
  // deltaToken is stored as the full @odata.deltaLink URL from the previous
  // run, so it can be used directly as the next request URL. A null deltaToken
  // means "first ever sync — start from scratch".
  const initialUrl =
    deltaToken ??
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxAddress)}/mailFolders/inbox/messages/delta`;

  const messagesWithAttachments: string[] = [];
  let nextUrl: string = initialUrl;
  let newDeltaToken = "";

  while (true) {
    const resp = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Graph API error on delta query: ${resp.status} ${resp.statusText} — ${body}`,
      );
    }

    const data = (await resp.json()) as {
      value?: Array<{ id: string; hasAttachments?: boolean }>;
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };

    for (const msg of data.value ?? []) {
      if (msg.hasAttachments) {
        messagesWithAttachments.push(msg.id);
      }
    }

    if (data["@odata.deltaLink"]) {
      // Final page — capture the delta link and stop paginating.
      newDeltaToken = data["@odata.deltaLink"];
      break;
    }

    if (data["@odata.nextLink"]) {
      nextUrl = data["@odata.nextLink"];
    } else {
      // Graph should always return one of these two links, but guard against
      // an unexpected response shape to avoid an infinite loop.
      break;
    }
  }

  // ---------------------------------------------------------------------------
  // Attachment fetch — PDF and images only
  // ---------------------------------------------------------------------------
  const attachments: FetchedAttachment[] = [];

  for (const messageId of messagesWithAttachments) {
    const attResp = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxAddress)}/messages/${messageId}/attachments`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!attResp.ok) {
      // Log and skip — don't let one bad message abort the whole sync run.
      logger.warn(
        { messageId, status: attResp.status },
        "Graph ingestion: failed to fetch attachments for message — skipping",
      );
      continue;
    }

    const attData = (await attResp.json()) as {
      value?: Array<{
        "@odata.type"?: string;
        name?: string;
        contentType?: string;
        contentBytes?: string; // base64, present on #microsoft.graph.fileAttachment
      }>;
    };

    for (const att of attData.value ?? []) {
      const contentType = att.contentType ?? "";

      // Filter: accept PDF and image/* only.
      // A logo embedded in an email signature is a common false positive —
      // silently skip anything else rather than treating it as an error.
      if (
        !contentType.startsWith("application/pdf") &&
        !contentType.startsWith("image/")
      ) {
        continue;
      }

      if (!att.contentBytes) {
        // itemAttachment or referenceAttachment — no inline content, skip.
        continue;
      }

      attachments.push({
        filename: att.name ?? "attachment",
        contentType,
        buffer: Buffer.from(att.contentBytes, "base64"),
      });
    }
  }

  return { attachments, newDeltaToken };
}
