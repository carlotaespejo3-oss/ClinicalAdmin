import { Router } from "express";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  dismissedBacklogItemsTable,
  dismissedBacklogItemSchema,
} from "@workspace/db";

const router = Router();
const DEFAULT_CLINICIAN_ID = "default";

// GET /api/dismissed-backlog-items
// Returns the full dismissed-items audit log for the clinician, most
// recently dismissed first. Used by the "View dismissed" audit screen
// in Settings so the clinician can check what was auto-filtered and
// restore anything that looks like a false positive.
router.get("/dismissed-backlog-items", async (_req, res) => {
  const rows = await db
    .select()
    .from(dismissedBacklogItemsTable)
    .where(eq(dismissedBacklogItemsTable.clinicianId, DEFAULT_CLINICIAN_ID))
    .orderBy(desc(dismissedBacklogItemsTable.dismissedAt));
  res.json(
    rows.map((r) => ({
      id: r.id,
      outlookMessageId: r.outlookMessageId,
      conversationId: r.conversationId,
      subject: r.subject,
      senderName: r.senderName,
      senderAddress: r.senderAddress,
      receivedAt: r.receivedAt.toISOString(),
      dismissedAt: r.dismissedAt.toISOString(),
      dismissReason: r.dismissReason,
      restoredAt: r.restoredAt?.toISOString() ?? null,
    })),
  );
});

// POST /api/dismissed-backlog-items/:id
// Record a newly dismissed item. Idempotent on conflict — if the
// item was already dismissed (e.g. double-fire during scan), the
// existing row is preserved unchanged (do nothing on conflict).
router.post("/dismissed-backlog-items/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const parsed = dismissedBacklogItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const d = parsed.data;
  await db
    .insert(dismissedBacklogItemsTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      id,
      outlookMessageId: d.outlookMessageId,
      conversationId: d.conversationId,
      subject: d.subject,
      senderName: d.senderName,
      senderAddress: d.senderAddress,
      receivedAt: new Date(d.receivedAt),
      dismissedAt: new Date(d.dismissedAt),
      dismissReason: d.dismissReason,
    })
    .onConflictDoNothing();
  res.status(204).send();
});

// POST /api/dismissed-backlog-items/:id/restore
// Marks a dismissed item as restored (sets restoredAt). The caller is
// responsible for also creating a new backlog_items row (via POST
// /api/backlog-items/:newId) so the item re-appears in the active queue.
// We keep this row for the audit trail — "restored" is an event, not
// a deletion.
router.post("/dismissed-backlog-items/:id/restore", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db
    .update(dismissedBacklogItemsTable)
    .set({ restoredAt: new Date() })
    .where(
      and(
        eq(dismissedBacklogItemsTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(dismissedBacklogItemsTable.id, id),
      ),
    );
  res.status(204).send();
});

// DELETE /api/dismissed-backlog-items
// Batch delete — used by the "Clear dismissed history" action in
// Settings. Removes ALL dismissed items for the clinician. This is
// the GDPR right-to-erase path for this table. The endpoint deletes
// the whole table for the clinician rather than individual rows because
// the audit list has no meaningful concept of "delete one entry".
router.delete("/dismissed-backlog-items", async (_req, res) => {
  await db
    .delete(dismissedBacklogItemsTable)
    .where(
      eq(dismissedBacklogItemsTable.clinicianId, DEFAULT_CLINICIAN_ID),
    );
  res.status(204).send();
});

export default router;
