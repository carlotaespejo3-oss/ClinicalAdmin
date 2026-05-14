import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, archivedEmailsTable } from "@workspace/db";
import { ArchiveEmailBody } from "@workspace/api-zod";

const router = Router();

// Single-tenant for now — same DEFAULT_CLINICIAN_ID convention as
// /api/deferrals. When auth lands, derive from req.user.id.
const DEFAULT_CLINICIAN_ID = "default";

// GET /api/archived — every archive entry for this clinician.
// Reference + behavioural metadata only; no email content.
router.get("/archived", async (_req, res) => {
  const rows = await db
    .select()
    .from(archivedEmailsTable)
    .where(eq(archivedEmailsTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      outlookEmailId: r.outlookEmailId,
      kind: r.kind,
      archivedAt: r.archivedAt.toISOString(),
    })),
  );
});

// POST /api/archived — idempotent. Re-archiving updates kind and
// archived_at to "now" so the Archive tab orders the most recent
// action first.
router.post("/archived", async (req, res) => {
  const parsed = ArchiveEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { outlookEmailId, kind } = parsed.data;
  const now = new Date();
  await db
    .insert(archivedEmailsTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId,
      kind,
      archivedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        archivedEmailsTable.clinicianId,
        archivedEmailsTable.outlookEmailId,
      ],
      set: { kind, archivedAt: now },
    });
  res.status(204).send();
});

// DELETE /api/archived/:outlookEmailId — idempotent.
router.delete("/archived/:outlookEmailId", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  await db
    .delete(archivedEmailsTable)
    .where(
      and(
        eq(archivedEmailsTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(archivedEmailsTable.outlookEmailId, id),
      ),
    );
  res.status(204).send();
});

export default router;
