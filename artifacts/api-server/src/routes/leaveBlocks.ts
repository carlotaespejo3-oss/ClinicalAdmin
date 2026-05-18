import { Router } from "express";
import { and, eq, asc } from "drizzle-orm";
import { db, leaveBlocksTable, leaveBlockSchema } from "@workspace/db";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/leave-blocks — full list, ordered by startAt ascending so
// the calendar reads naturally top-to-bottom in date order.
router.get("/leave-blocks", async (_req, res) => {
  const rows = await db
    .select()
    .from(leaveBlocksTable)
    .where(eq(leaveBlocksTable.clinicianId, DEFAULT_CLINICIAN_ID))
    .orderBy(asc(leaveBlocksTable.startAt));
  res.json(
    rows.map((r) => ({
      id: r.id,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      leaveType: r.leaveType,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// POST /api/leave-blocks/:id — full upsert. Body replaces the row in
// its entirety. createdAt is preserved across upserts because we
// don't touch it in the update set.
router.post("/leave-blocks/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const parsed = leaveBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const b = parsed.data;
  const startAt = new Date(b.startAt);
  const endAt = new Date(b.endAt);
  if (!(endAt.getTime() > startAt.getTime())) {
    res.status(400).json({ error: "endAt must be after startAt" });
    return;
  }
  const now = new Date();
  await db
    .insert(leaveBlocksTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      id,
      startAt,
      endAt,
      leaveType: b.leaveType,
      notes: b.notes ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [leaveBlocksTable.clinicianId, leaveBlocksTable.id],
      set: {
        startAt,
        endAt,
        leaveType: b.leaveType,
        notes: b.notes ?? null,
        updatedAt: now,
      },
    });
  res.status(204).send();
});

// DELETE /api/leave-blocks/:id — idempotent.
router.delete("/leave-blocks/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db
    .delete(leaveBlocksTable)
    .where(
      and(
        eq(leaveBlocksTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(leaveBlocksTable.id, id),
      ),
    );
  res.status(204).send();
});

export default router;
