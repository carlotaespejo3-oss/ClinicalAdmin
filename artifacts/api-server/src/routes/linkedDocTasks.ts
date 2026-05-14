import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, linkedDocTasksTable } from "@workspace/db";
import { UpsertLinkedDocTaskBody } from "@workspace/api-zod";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/linked-doc-tasks — auto-created document tasks. Title is
// a short organisational label; no email body text is stored.
router.get("/linked-doc-tasks", async (_req, res) => {
  const rows = await db
    .select()
    .from(linkedDocTasksTable)
    .where(eq(linkedDocTasksTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      outlookEmailId: r.outlookEmailId,
      title: r.title,
      cat: r.cat,
      type: r.type,
      deadline: r.deadline,
      risk: r.risk,
      estMin: r.estMin,
      autoCompleteOnReply: r.autoCompleteOnReply,
      done: r.done,
      noteAfterEmailDone: r.noteAfterEmailDone,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// POST /api/linked-doc-tasks — idempotent upsert on (clinicianId,
// outlookEmailId). Used both for initial creation (ensureLinkedDocTask)
// and for mutations (toggle done, edit note). Server replaces the row.
router.post("/linked-doc-tasks", async (req, res) => {
  const parsed = UpsertLinkedDocTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const t = parsed.data;
  await db
    .insert(linkedDocTasksTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: t.outlookEmailId,
      title: t.title,
      cat: t.cat,
      type: t.type,
      deadline: t.deadline,
      risk: t.risk,
      estMin: t.estMin,
      autoCompleteOnReply: t.autoCompleteOnReply,
      done: t.done,
      noteAfterEmailDone: t.noteAfterEmailDone ?? null,
    })
    .onConflictDoUpdate({
      target: [
        linkedDocTasksTable.clinicianId,
        linkedDocTasksTable.outlookEmailId,
      ],
      set: {
        title: t.title,
        cat: t.cat,
        type: t.type,
        deadline: t.deadline,
        risk: t.risk,
        estMin: t.estMin,
        autoCompleteOnReply: t.autoCompleteOnReply,
        done: t.done,
        noteAfterEmailDone: t.noteAfterEmailDone ?? null,
      },
    });
  res.status(204).send();
});

// DELETE /api/linked-doc-tasks/:outlookEmailId — idempotent.
router.delete("/linked-doc-tasks/:outlookEmailId", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  await db
    .delete(linkedDocTasksTable)
    .where(
      and(
        eq(linkedDocTasksTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(linkedDocTasksTable.outlookEmailId, id),
      ),
    );
  res.status(204).send();
});

export default router;
