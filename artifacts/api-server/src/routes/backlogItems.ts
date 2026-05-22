import { Router } from "express";
import { and, eq, desc, asc } from "drizzle-orm";
import {
  db,
  backlogItemsTable,
  backlogItemSchema,
} from "@workspace/db";

const router = Router();
const DEFAULT_CLINICIAN_ID = "default";

// GET /api/backlog-items
// Returns all backlog items for the clinician, pending first (by
// priorityScore DESC then receivedAt DESC), resolved items appended.
// The client uses this to hydrate the backlogQueueStore on load.
router.get("/backlog-items", async (_req, res) => {
  const rows = await db
    .select()
    .from(backlogItemsTable)
    .where(eq(backlogItemsTable.clinicianId, DEFAULT_CLINICIAN_ID))
    .orderBy(
      asc(backlogItemsTable.status),          // pending sorts before done/deferred lexically
      desc(backlogItemsTable.priorityScore),
      desc(backlogItemsTable.receivedAt),
    );
  res.json(
    rows.map((r) => ({
      id: r.id,
      outlookMessageId: r.outlookMessageId,
      conversationId: r.conversationId,
      subject: r.subject,
      senderName: r.senderName,
      senderAddress: r.senderAddress,
      receivedAt: r.receivedAt.toISOString(),
      priorityScore: r.priorityScore,
      status: r.status,
      linkedTaskId: r.linkedTaskId ?? null,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    })),
  );
});

// POST /api/backlog-items/:id
// Idempotent upsert. The client sends the full row on every write —
// both for new items (from scan results) and for status updates
// (mark done, defer). Using a single upsert endpoint keeps the
// fire-and-forget pattern consistent with other stores.
router.post("/backlog-items/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const parsed = backlogItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const b = parsed.data;
  const now = new Date();
  await db
    .insert(backlogItemsTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      id,
      outlookMessageId: b.outlookMessageId,
      conversationId: b.conversationId,
      subject: b.subject,
      senderName: b.senderName,
      senderAddress: b.senderAddress,
      receivedAt: new Date(b.receivedAt),
      priorityScore: b.priorityScore,
      status: b.status,
      linkedTaskId: b.linkedTaskId ?? null,
      resolvedAt: b.resolvedAt ? new Date(b.resolvedAt) : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [backlogItemsTable.clinicianId, backlogItemsTable.id],
      set: {
        outlookMessageId: b.outlookMessageId,
        conversationId: b.conversationId,
        subject: b.subject,
        senderName: b.senderName,
        senderAddress: b.senderAddress,
        receivedAt: new Date(b.receivedAt),
        priorityScore: b.priorityScore,
        status: b.status,
        linkedTaskId: b.linkedTaskId ?? null,
        resolvedAt: b.resolvedAt ? new Date(b.resolvedAt) : null,
        updatedAt: now,
      },
    });
  res.status(204).send();
});

// DELETE /api/backlog-items/:id
// Used when the clinician dismisses an item — the client records the
// dismiss in dismissed_backlog_items first, then removes the active row.
// Idempotent: deleting a non-existent row is not an error.
router.delete("/backlog-items/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db
    .delete(backlogItemsTable)
    .where(
      and(
        eq(backlogItemsTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(backlogItemsTable.id, id),
      ),
    );
  res.status(204).send();
});

export default router;
