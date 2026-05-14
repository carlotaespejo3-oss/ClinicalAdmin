import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, deferralHistoryTable } from "@workspace/db";
import { RecordDeferralsBody } from "@workspace/api-zod";

const router = Router();

// Single-tenant for now. When auth lands, derive this from the session
// (e.g. req.user.id) instead of the constant. Persisted as text so the
// switch is a one-line change with no migration.
const DEFAULT_CLINICIAN_ID = "default";

// GET /api/deferrals — every email's deferral history for this clinician.
// Returned shape matches OpenAPI DeferralRecord exactly. Returns metadata
// only — no email content. The client fetches subject/body/sender live
// from Microsoft Graph using outlookEmailId.
router.get("/deferrals", async (_req, res) => {
  const rows = await db
    .select()
    .from(deferralHistoryTable)
    .where(eq(deferralHistoryTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      outlookEmailId: r.outlookEmailId,
      isoWeeks: r.isoWeeks,
      deferralCount: r.deferralCount,
    })),
  );
});

// POST /api/deferrals/record — idempotent for (outlookEmailId, weekMonday).
// Adds the week to iso_weeks only if not already present, so UI re-renders
// within the same ISO week never inflate counts. deferral_count is
// recomputed as iso_weeks.length on every write so the denormalised value
// can never drift.
router.post("/deferrals/record", async (req, res) => {
  const parsed = RecordDeferralsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { outlookEmailIds, weekMonday } = parsed.data;

  // Sequential read-modify-write per row is fine for single-clinician
  // load. If this becomes a hot path we can switch to a single
  // INSERT … ON CONFLICT … with array_append + a uniqueness guard.
  for (const id of outlookEmailIds) {
    const [existing] = await db
      .select()
      .from(deferralHistoryTable)
      .where(
        and(
          eq(deferralHistoryTable.clinicianId, DEFAULT_CLINICIAN_ID),
          eq(deferralHistoryTable.outlookEmailId, id),
        ),
      );
    if (!existing) {
      await db.insert(deferralHistoryTable).values({
        clinicianId: DEFAULT_CLINICIAN_ID,
        outlookEmailId: id,
        isoWeeks: [weekMonday],
        deferralCount: 1,
      });
    } else if (!existing.isoWeeks.includes(weekMonday)) {
      const next = [...existing.isoWeeks, weekMonday];
      await db
        .update(deferralHistoryTable)
        .set({ isoWeeks: next, deferralCount: next.length })
        .where(
          and(
            eq(deferralHistoryTable.clinicianId, DEFAULT_CLINICIAN_ID),
            eq(deferralHistoryTable.outlookEmailId, id),
          ),
        );
    }
  }
  res.status(204).send();
});

// DELETE /api/deferrals/:outlookEmailId — called from archive / acknowledge
// / done resolution paths. Idempotent: missing rows return 204, not 404,
// because the caller doesn't care whether a record existed — it just wants
// the warning gone.
router.delete("/deferrals/:outlookEmailId", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  await db
    .delete(deferralHistoryTable)
    .where(
      and(
        eq(deferralHistoryTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(deferralHistoryTable.outlookEmailId, id),
      ),
    );
  res.status(204).send();
});

export default router;
