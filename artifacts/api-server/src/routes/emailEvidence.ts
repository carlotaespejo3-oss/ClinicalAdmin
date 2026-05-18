import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, emailEvidenceTable, evidenceSourcesTable, type CitationLink } from "@workspace/db";
import { UpsertEmailEvidenceBody } from "@workspace/api-zod";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/email-evidence — every record for the current clinician.
// Used by the client store to hydrate once on first subscriber.
router.get("/email-evidence", async (_req, res) => {
  const rows = await db
    .select()
    .from(emailEvidenceTable)
    .where(eq(emailEvidenceTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      outlookEmailId: r.outlookEmailId,
      prescribingWarning: r.prescribingWarning,
      citations: r.citations,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
});

// GET /api/email-evidence/:outlookEmailId — per-email evidence record.
// Citations are references into the source registry, not guideline text.
router.get("/email-evidence/:outlookEmailId", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  const rows = await db
    .select()
    .from(emailEvidenceTable)
    .where(
      and(
        eq(emailEvidenceTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(emailEvidenceTable.outlookEmailId, id),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) {
    res.status(404).json({ error: "No evidence for this email" });
    return;
  }
  res.json({
    outlookEmailId: r.outlookEmailId,
    prescribingWarning: r.prescribingWarning,
    citations: r.citations,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
});

// PUT /api/email-evidence/:outlookEmailId — idempotent upsert on
// (clinicianId, outlookEmailId). Stage 3 (AI source-matching) will be
// the main writer; today it's the seeder script.
router.put("/email-evidence/:outlookEmailId", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  const parsed = UpsertEmailEvidenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const body = parsed.data;
  // Three-bucket + never-invent integrity: an email_evidence record
  // with zero citations would satisfy the client's "evidence exists"
  // check but resolve to no verified sources — the exact failure mode
  // the gate is meant to prevent. Reject at the boundary.
  if (body.citations.length === 0) {
    res.status(400).json({ error: "At least one citation is required" });
    return;
  }
  // Every sourceId must reference a real row in evidence_sources. jsonb
  // can't carry an FK so validation lives here.
  const sourceIds = Array.from(new Set(body.citations.map((c) => c.sourceId)));
  const known = await db
    .select({ id: evidenceSourcesTable.id })
    .from(evidenceSourcesTable)
    .where(inArray(evidenceSourcesTable.id, sourceIds));
  const knownIds = new Set(known.map((k) => k.id));
  const orphans = sourceIds.filter((id) => !knownIds.has(id));
  if (orphans.length > 0) {
    res.status(400).json({ error: `Unknown source IDs: ${orphans.join(", ")}` });
    return;
  }
  const citations: CitationLink[] = body.citations.map((c) => ({
    sourceId: c.sourceId,
    flag: c.flag ?? null,
    flagText: c.flagText ?? null,
  }));
  const now = new Date();
  await db
    .insert(emailEvidenceTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: id,
      prescribingWarning: body.prescribingWarning ?? null,
      citations,
    })
    .onConflictDoUpdate({
      target: [emailEvidenceTable.clinicianId, emailEvidenceTable.outlookEmailId],
      set: {
        prescribingWarning: body.prescribingWarning ?? null,
        citations,
        updatedAt: now,
      },
    });
  res.status(204).send();
});

export default router;
