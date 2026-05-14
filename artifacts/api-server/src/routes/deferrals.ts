import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, deferralHistoryTable } from "@workspace/db";
import { RecordDeferralsInput } from "@workspace/api-zod";

const router = Router();

// GET /api/deferrals — every email's deferral history.
// Returned shape matches OpenAPI DeferralRecord exactly.
router.get("/deferrals", async (_req, res) => {
  const rows = await db.select().from(deferralHistoryTable);
  res.json(
    rows.map((r) => ({
      emailId: r.emailId,
      weeksDeferred: r.weeksDeferred,
    })),
  );
});

// POST /api/deferrals/record — idempotent for (emailId, weekMonday).
// Adds the week to weeks_deferred only if not already present, so
// UI re-renders within the same ISO week never inflate counts.
router.post("/deferrals/record", async (req, res) => {
  const parsed = RecordDeferralsInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { emailIds, weekMonday } = parsed.data;

  // Sequential to keep the read-modify-write per row safe under
  // realistic single-user load. If this ever becomes a hot path
  // we can switch to a single SQL upsert with array_append + a
  // unique-element guard, but it's overkill for one clinician.
  for (const id of emailIds) {
    const [existing] = await db
      .select()
      .from(deferralHistoryTable)
      .where(eq(deferralHistoryTable.emailId, id));
    if (!existing) {
      await db
        .insert(deferralHistoryTable)
        .values({ emailId: id, weeksDeferred: [weekMonday] });
    } else if (!existing.weeksDeferred.includes(weekMonday)) {
      await db
        .update(deferralHistoryTable)
        .set({ weeksDeferred: [...existing.weeksDeferred, weekMonday] })
        .where(eq(deferralHistoryTable.emailId, id));
    }
  }
  res.status(204).send();
});

// DELETE /api/deferrals/:emailId — called from archive / acknowledge
// / done resolution paths. Idempotent: missing rows return 204, not
// 404, because the caller doesn't care whether a record existed —
// it just wants the warning gone.
router.delete("/deferrals/:emailId", async (req, res) => {
  const id = Number.parseInt(req.params.emailId, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid emailId" });
    return;
  }
  await db
    .delete(deferralHistoryTable)
    .where(eq(deferralHistoryTable.emailId, id));
  res.status(204).send();
});

export default router;
