import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, userTasksTable } from "@workspace/db";
import { CreateUserTaskBody } from "@workspace/api-zod";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/user-tasks — clinician's own task list (CPD adds today,
// manual entries in future). Organisational data only; no email body
// content is stored or returned.
router.get("/user-tasks", async (_req, res) => {
  const rows = await db
    .select()
    .from(userTasksTable)
    .where(eq(userTasksTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      id: r.id,
      outlookEmailId: r.outlookEmailId,
      title: r.title,
      source: r.source,
      eventDate: r.eventDate,
      registrationDeadline: r.registrationDeadline,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// POST /api/user-tasks — idempotent on `id`. Re-posting the same
// client-generated id is a no-op so fire-and-forget retries are safe.
router.post("/user-tasks", async (req, res) => {
  const parsed = CreateUserTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const t = parsed.data;
  await db
    .insert(userTasksTable)
    .values({
      id: t.id,
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: t.outlookEmailId ?? null,
      title: t.title,
      source: t.source,
      eventDate: t.eventDate ?? null,
      registrationDeadline: t.registrationDeadline ?? null,
    })
    .onConflictDoNothing();
  res.status(204).send();
});

// DELETE /api/user-tasks/:id — idempotent.
router.delete("/user-tasks/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db
    .delete(userTasksTable)
    .where(
      and(
        eq(userTasksTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(userTasksTable.id, id),
      ),
    );
  res.status(204).send();
});

export default router;
