import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, acknowledgedEmailsTable } from "@workspace/db";
import { AcknowledgeEmailBody } from "@workspace/api-zod";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/acknowledged — IDs only. Behavioural flag, no email content.
router.get("/acknowledged", async (_req, res) => {
  const rows = await db
    .select({ outlookEmailId: acknowledgedEmailsTable.outlookEmailId })
    .from(acknowledgedEmailsTable)
    .where(eq(acknowledgedEmailsTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(rows.map((r) => r.outlookEmailId));
});

// POST /api/acknowledged — idempotent (no-op on conflict).
router.post("/acknowledged", async (req, res) => {
  const parsed = AcknowledgeEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  await db
    .insert(acknowledgedEmailsTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: parsed.data.outlookEmailId,
    })
    .onConflictDoNothing();
  res.status(204).send();
});

// DELETE /api/acknowledged/:outlookEmailId — idempotent.
router.delete("/acknowledged/:outlookEmailId", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  await db
    .delete(acknowledgedEmailsTable)
    .where(
      and(
        eq(acknowledgedEmailsTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(acknowledgedEmailsTable.outlookEmailId, id),
      ),
    );
  res.status(204).send();
});

export default router;
