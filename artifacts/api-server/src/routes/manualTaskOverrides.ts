import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  manualTaskOverridesTable,
  manualTaskOverrideSchema,
} from "@workspace/db";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/manual-task-overrides — list every override the clinician
// has placed on the seed ManualTask records. Untouched seed tasks
// have no row and use seed defaults at render time.
router.get("/manual-task-overrides", async (_req, res) => {
  const rows = await db
    .select()
    .from(manualTaskOverridesTable)
    .where(eq(manualTaskOverridesTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      taskId: r.taskId,
      done: r.done,
      note: r.note,
      titleOverride: r.titleOverride,
      deadlineOverride: r.deadlineOverride,
      estMinOverride: r.estMinOverride,
      hidden: r.hidden,
    })),
  );
});

// POST /api/manual-task-overrides/:taskId — partial upsert keyed on
// (clinicianId, taskId). Omitted fields stay untouched on existing
// rows; on first insert, missing `done` defaults to false at the
// column level.
router.post("/manual-task-overrides/:taskId", async (req, res) => {
  const taskId = req.params.taskId;
  if (!taskId) {
    res.status(400).json({ error: "Missing taskId" });
    return;
  }
  const parsed = manualTaskOverrideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const patch = parsed.data;
  // Build the conflict-update set dynamically so an "only flip note"
  // call doesn't accidentally reset done, and vice versa.
  const updateSet: Record<string, unknown> = {
    updatedAt: sql`now()`,
  };
  if (patch.done !== undefined) updateSet.done = patch.done;
  if (patch.note !== undefined) updateSet.note = patch.note;
  if (patch.titleOverride !== undefined)
    updateSet.titleOverride = patch.titleOverride;
  if (patch.deadlineOverride !== undefined)
    updateSet.deadlineOverride = patch.deadlineOverride;
  if (patch.estMinOverride !== undefined)
    updateSet.estMinOverride = patch.estMinOverride;
  if (patch.hidden !== undefined) updateSet.hidden = patch.hidden;
  await db
    .insert(manualTaskOverridesTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      taskId,
      done: patch.done ?? false,
      note: patch.note ?? null,
      titleOverride: patch.titleOverride ?? null,
      deadlineOverride: patch.deadlineOverride ?? null,
      estMinOverride: patch.estMinOverride ?? null,
      hidden: patch.hidden ?? false,
    })
    .onConflictDoUpdate({
      target: [
        manualTaskOverridesTable.clinicianId,
        manualTaskOverridesTable.taskId,
      ],
      set: updateSet,
    });
  res.status(204).send();
});

// DELETE /api/manual-task-overrides/:taskId — clear the override so
// the task reverts to seed defaults. Idempotent.
router.delete("/manual-task-overrides/:taskId", async (req, res) => {
  const taskId = req.params.taskId;
  if (!taskId) {
    res.status(400).json({ error: "Missing taskId" });
    return;
  }
  await db
    .delete(manualTaskOverridesTable)
    .where(
      and(
        eq(manualTaskOverridesTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(manualTaskOverridesTable.taskId, taskId),
      ),
    );
  res.status(204).send();
});

export default router;
