import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db, invoiceCaptureTable, vendorIdTable, exceptionEventTable } from "@workspace/db";
import {
  ListExceptionsQueryParams,
  ListExceptionsResponse,
  GetExceptionEventsParams,
  GetExceptionEventsResponse,
  AddExceptionNoteParams,
  AddExceptionNoteBody,
  AssignExceptionParams,
  AssignExceptionBody,
  AssignExceptionResponse,
  ReviewExceptionParams,
  ReviewExceptionBody,
  ReviewExceptionResponse,
  ReturnExceptionToApprovalParams,
  ReturnExceptionToApprovalBody,
  ReturnExceptionToApprovalResponse,
} from "@workspace/api-zod";
import {
  getFullInvoiceById,
  serializeInvoice,
  appendAudit,
  appendExceptionEvent,
  serializeExceptionEvent,
} from "../services/invoiceShared";

const router: IRouter = Router();

// ─── GET /exceptions ─────────────────────────────────────────────────────────
// List active invoices in EXCEPTION status with management filters.
router.get("/exceptions", async (req, res): Promise<void> => {
  const parsed = ListExceptionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { reason, owner, reviewed, assignedTo, sortBy, sortDir, page, limit } = parsed.data;
  const offset = ((page ?? 1) - 1) * (limit ?? 20);

  // ── Server-side scope enforcement ────────────────────────────────────────────
  // AP_CLERKs are always scoped to their own work regardless of query params —
  // they cannot widen the scope by omitting or overriding assignedTo.
  // AP_MANAGERs honor the caller-supplied assignedTo (for "My work" toggle) or
  // see all exceptions when no filter is provided.
  const userRole = (req as any).clerkUserRole as string | undefined;
  const clerkUserId = (req as any).clerkUserId as string | undefined;

  // Derive the effective scope identifier:
  //  - AP_CLERK: always use their own Clerk user ID (override any caller param)
  //  - AP_MANAGER: use caller-supplied assignedTo if present, otherwise no filter
  const effectiveAssignedTo: string | undefined =
    userRole === "AP_CLERK" ? clerkUserId : assignedTo;

  const conditions = [eq(invoiceCaptureTable.status, "EXCEPTION")];
  if (reason) {
    conditions.push(ilike(invoiceCaptureTable.exceptionReason, `%${reason}%`));
  }
  if (owner) {
    conditions.push(eq(invoiceCaptureTable.exceptionOwner, owner));
  }
  // Scope filter: show invoices assigned to the effective assignee (by Clerk ID) OR
  // truly unassigned (BOTH exceptionOwner AND exceptionOwnerClerkId are null).
  //
  // Items where exceptionOwner is set but exceptionOwnerClerkId is null are considered
  // "assigned by display name" (e.g. manager typed a name but didn't supply Clerk ID).
  // These are treated as assigned-to-someone — not unassigned — so they are NOT visible
  // to other clerks, preventing cross-clerk data leakage from display-name-only assignments.
  if (effectiveAssignedTo) {
    conditions.push(
      or(
        eq(invoiceCaptureTable.exceptionOwnerClerkId, effectiveAssignedTo),
        and(
          isNull(invoiceCaptureTable.exceptionOwner),
          isNull(invoiceCaptureTable.exceptionOwnerClerkId),
        ),
      )!,
    );
  }
  if (reviewed != null) {
    conditions.push(
      reviewed
        ? isNotNull(invoiceCaptureTable.exceptionReviewedAt)
        : isNull(invoiceCaptureTable.exceptionReviewedAt),
    );
  }

  const whereClause = and(...conditions);

  const sortColumn = (() => {
    const dir = sortDir === "asc" ? asc : desc;
    switch (sortBy) {
      case "vendorName": return dir(vendorIdTable.vendorName);
      case "totalAmount": return dir(invoiceCaptureTable.totalAmount);
      case "confidenceScore": return dir(invoiceCaptureTable.confidenceScore);
      case "status": return dir(invoiceCaptureTable.status);
      // "age" maps to creation time.
      default: return dir(invoiceCaptureTable.createdAt);
    }
  })();

  const [idRows, countRows] = await Promise.all([
    db
      .select({ id: invoiceCaptureTable.id })
      .from(invoiceCaptureTable)
      .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
      .where(whereClause)
      .orderBy(sortColumn)
      .limit(limit ?? 20)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoiceCaptureTable)
      .leftJoin(vendorIdTable, eq(invoiceCaptureTable.vendorId, vendorIdTable.id))
      .where(whereClause),
  ]);

  const rows = await Promise.all(idRows.map((r) => getFullInvoiceById(r.id)));
  const data = rows.map(serializeInvoice).filter((r) => r != null);

  res.json(
    ListExceptionsResponse.parse({
      data,
      total: Number(countRows[0]?.count ?? 0),
      page: page ?? 1,
      limit: limit ?? 20,
    }),
  );
});

// ─── GET /invoices/:id/exception/events ──────────────────────────────────────
router.get("/invoices/:id/exception/events", async (req, res): Promise<void> => {
  const params = GetExceptionEventsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const invoice = await getFullInvoiceById(params.data.id);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const events = await db
    .select()
    .from(exceptionEventTable)
    .where(eq(exceptionEventTable.invoiceId, params.data.id))
    .orderBy(asc(exceptionEventTable.createdAt));

  res.json(GetExceptionEventsResponse.parse(events.map(serializeExceptionEvent)));
});

// ─── POST /invoices/:id/exception/note ───────────────────────────────────────
router.post("/invoices/:id/exception/note", async (req, res): Promise<void> => {
  const params = AddExceptionNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddExceptionNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const invoice = await getFullInvoiceById(params.data.id);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const event = await appendExceptionEvent({
    invoiceId: params.data.id,
    eventType: "NOTE",
    note: parsed.data.note,
    actor: parsed.data.actor ?? null,
  });

  res.status(201).json(event);
});

// ─── POST /invoices/:id/exception/assign ─────────────────────────────────────
router.post("/invoices/:id/exception/assign", async (req, res): Promise<void> => {
  const params = AssignExceptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AssignExceptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const invoice = await getFullInvoiceById(params.data.id);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  await db
    .update(invoiceCaptureTable)
    .set({
      exceptionOwner: parsed.data.owner,
      // Store the assignee's Clerk user ID for server-side scope enforcement.
      exceptionOwnerClerkId: parsed.data.ownerClerkId ?? null,
    })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendExceptionEvent({
    invoiceId: params.data.id,
    eventType: "ASSIGNED",
    note: `Assigned to ${parsed.data.owner}`,
    actor: parsed.data.actor ?? null,
  });

  await appendAudit({
    invoiceId: params.data.id,
    action: "EXCEPTION_ASSIGNED",
    fieldName: "exceptionOwner",
    oldValue: invoice.exceptionOwner ?? null,
    newValue: parsed.data.owner,
    note: parsed.data.actor ? `Assigned by ${parsed.data.actor}` : null,
  });

  const updated = await getFullInvoiceById(params.data.id);
  res.json(AssignExceptionResponse.parse(serializeInvoice(updated)));
});

// ─── POST /invoices/:id/exception/review ─────────────────────────────────────
router.post("/invoices/:id/exception/review", async (req, res): Promise<void> => {
  const params = ReviewExceptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ReviewExceptionBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const invoice = await getFullInvoiceById(params.data.id);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const reviewedAt = new Date();
  const reviewer = parsed.data.actor ?? null;

  await db
    .update(invoiceCaptureTable)
    .set({ exceptionReviewedAt: reviewedAt, exceptionReviewedBy: reviewer })
    .where(eq(invoiceCaptureTable.id, params.data.id));

  await appendExceptionEvent({
    invoiceId: params.data.id,
    eventType: "REVIEWED",
    note: parsed.data.note ?? null,
    actor: reviewer,
  });

  await appendAudit({
    invoiceId: params.data.id,
    action: "EXCEPTION_REVIEWED",
    note: reviewer ? `Reviewed by ${reviewer}` : "Exception reviewed",
  });

  const updated = await getFullInvoiceById(params.data.id);
  res.json(ReviewExceptionResponse.parse(serializeInvoice(updated)));
});

// ─── POST /invoices/:id/exception/return-to-approval ─────────────────────────
router.post(
  "/invoices/:id/exception/return-to-approval",
  async (req, res): Promise<void> => {
    const params = ReturnExceptionToApprovalParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = ReturnExceptionToApprovalBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const invoice = await getFullInvoiceById(params.data.id);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    if (invoice.status !== "EXCEPTION") {
      res.status(422).json({
        error: "Only invoices in EXCEPTION status can be returned to approval.",
      });
      return;
    }

    await db
      .update(invoiceCaptureTable)
      .set({ status: "PENDING_APPROVAL" })
      .where(eq(invoiceCaptureTable.id, params.data.id));

    await appendExceptionEvent({
      invoiceId: params.data.id,
      eventType: "RETURNED_TO_APPROVAL",
      note: parsed.data.note ?? null,
      actor: parsed.data.actor ?? null,
    });

    await appendAudit({
      invoiceId: params.data.id,
      action: "STATUS_CHANGE",
      fieldName: "status",
      oldValue: "EXCEPTION",
      newValue: "PENDING_APPROVAL",
      note: parsed.data.actor
        ? `Returned to approval by ${parsed.data.actor}`
        : "Returned to approval",
    });

    const updated = await getFullInvoiceById(params.data.id);
    res.json(ReturnExceptionToApprovalResponse.parse(serializeInvoice(updated)));
  },
);

export default router;
