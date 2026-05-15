import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, weeklyPlansTable, weekSetupSchema } from "@workspace/db";

const router = Router();

// Single-tenant for now. When auth lands, derive this from the
// session (e.g. req.user.id). Persisted as text so the swap is a
// one-line change with no migration.
const DEFAULT_CLINICIAN_ID = "default";

// GET /api/weekly-plans/:weekKey — snapshot for one ISO week, or
// null setup when the planner has not run for that week yet.
// Mirrors the clinician-settings pattern: always 200, body carries
// the "missing" signal as null so the client never branches on
// 200 vs 404.
router.get("/weekly-plans/:weekKey", async (req, res) => {
  const weekKey = req.params.weekKey;
  if (!weekKey) {
    res.status(400).json({ error: "Missing weekKey" });
    return;
  }
  const rows = await db
    .select()
    .from(weeklyPlansTable)
    .where(
      and(
        eq(weeklyPlansTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(weeklyPlansTable.weekKey, weekKey),
      ),
    )
    .limit(1);
  const row = rows[0];
  res.json({ weekKey, setup: row?.setup ?? null });
});

// POST /api/weekly-plans/:weekKey — full upsert. Body is the entire
// WeekSetup; we replace any existing row for the same week. There
// is no partial-patch story here because the consumer always edits
// the whole snapshot together (re-run the planner, change the week's
// availability) and treats it as one unit.
router.post("/weekly-plans/:weekKey", async (req, res) => {
  const weekKey = req.params.weekKey;
  if (!weekKey) {
    res.status(400).json({ error: "Missing weekKey" });
    return;
  }
  const parsed = weekSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  await db
    .insert(weeklyPlansTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      weekKey,
      setup: parsed.data,
    })
    .onConflictDoUpdate({
      target: [weeklyPlansTable.clinicianId, weeklyPlansTable.weekKey],
      set: { setup: parsed.data },
    });
  res.status(204).send();
});

// DELETE /api/weekly-plans/:weekKey — idempotent. Returns 204 even
// if no row existed; the caller just wants the snapshot gone.
router.delete("/weekly-plans/:weekKey", async (req, res) => {
  const weekKey = req.params.weekKey;
  if (!weekKey) {
    res.status(400).json({ error: "Missing weekKey" });
    return;
  }
  await db
    .delete(weeklyPlansTable)
    .where(
      and(
        eq(weeklyPlansTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(weeklyPlansTable.weekKey, weekKey),
      ),
    );
  res.status(204).send();
});

export default router;
