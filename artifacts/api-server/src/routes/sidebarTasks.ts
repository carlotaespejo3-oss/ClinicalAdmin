import { Router } from "express";
import { and, eq, asc } from "drizzle-orm";
import { db, sidebarTasksTable, sidebarTaskSchema } from "@workspace/db";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/sidebar-tasks — full list, ordered by createdAt ascending
// so the UI shows tasks in the order the clinician added them. The
// client can re-sort by done/priority for display, but the canonical
// order is insertion order.
router.get("/sidebar-tasks", async (_req, res) => {
  const rows = await db
    .select()
    .from(sidebarTasksTable)
    .where(eq(sidebarTasksTable.clinicianId, DEFAULT_CLINICIAN_ID))
    .orderBy(asc(sidebarTasksTable.createdAt));
  res.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      estMin: r.estMin,
      priority: r.priority,
      done: r.done,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// POST /api/sidebar-tasks/:id — full upsert. Body replaces the row
// in its entirety; toggling done is just a re-post with the flag
// flipped. createdAt is preserved across upserts because we don't
// touch it in the update set.
router.post("/sidebar-tasks/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const parsed = sidebarTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const t = parsed.data;
  await db
    .insert(sidebarTasksTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      id,
      title: t.title,
      estMin: t.estMin,
      priority: t.priority,
      done: t.done,
    })
    .onConflictDoUpdate({
      target: [sidebarTasksTable.clinicianId, sidebarTasksTable.id],
      set: {
        title: t.title,
        estMin: t.estMin,
        priority: t.priority,
        done: t.done,
      },
    });
  res.status(204).send();
});

// DELETE /api/sidebar-tasks/:id — idempotent.
router.delete("/sidebar-tasks/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db
    .delete(sidebarTasksTable)
    .where(
      and(
        eq(sidebarTasksTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(sidebarTasksTable.id, id),
      ),
    );
  res.status(204).send();
});

export default router;
