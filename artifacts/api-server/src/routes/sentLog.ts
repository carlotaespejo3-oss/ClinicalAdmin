import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, sentLogTable } from "@workspace/db";
import { RecordSentLogBody } from "@workspace/api-zod";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/sent-log — every mailto handoff for the current clinician.
// Three-bucket rule: outgoing email content lives in Outlook Sent
// Items, never here. Rows carry only organisational metadata
// (id / outlookEmailId / variant / sentAt).
router.get("/sent-log", async (_req, res) => {
  const rows = await db
    .select()
    .from(sentLogTable)
    .where(eq(sentLogTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      id: r.id,
      outlookEmailId: r.outlookEmailId,
      variant: r.variant,
      sentAt: r.sentAt.toISOString(),
    })),
  );
});

// POST /api/sent-log — record a handoff. Idempotent on `id` so
// double-clicks of "Send" don't create duplicate audit rows.
router.post("/sent-log", async (req, res) => {
  const parsed = RecordSentLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const e = parsed.data;
  await db
    .insert(sentLogTable)
    .values({
      id: e.id,
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: e.outlookEmailId,
      variant: e.variant,
      sentAt: new Date(e.sentAt),
    })
    .onConflictDoNothing();
  res.status(204).send();
});

export default router;
