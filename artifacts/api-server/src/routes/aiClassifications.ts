import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiClassificationsTable } from "@workspace/db";
import { UpsertAiClassificationBody } from "@workspace/api-zod";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/ai-classifications — every classification for the
// current clinician. Three-bucket rule: organisational metadata
// only; the email subject / body are fetched live from Graph at
// display time.
router.get("/ai-classifications", async (_req, res) => {
  const rows = await db
    .select()
    .from(aiClassificationsTable)
    .where(eq(aiClassificationsTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      outlookEmailId: r.outlookEmailId,
      category: r.category,
      priority: r.priority,
      confidence: r.confidence,
      reasoning: r.reasoning,
      classifiedAt: r.classifiedAt.toISOString(),
      professionalSubType: r.professionalSubType,
      patientName: r.patientName,
      documentRequested: r.documentRequested,
      eventDate: r.eventDate,
      registrationDeadline: r.registrationDeadline,
      documentDirection: r.documentDirection,
      requiresDocument: r.requiresDocument,
      documentType: r.documentType,
      documentDueDays: r.documentDueDays,
      prescriptionRequest: r.prescriptionRequest ?? null,
      complexity: r.complexity,
      complexityReasons: r.complexityReasons ?? [],
    })),
  );
});

// POST /api/ai-classifications — upsert. Idempotent on
// (clinicianId, outlookEmailId); the server replaces the row.
router.post("/ai-classifications", async (req, res) => {
  const parsed = UpsertAiClassificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const c = parsed.data;
  const values = {
    clinicianId: DEFAULT_CLINICIAN_ID,
    outlookEmailId: c.outlookEmailId,
    category: c.category,
    priority: c.priority,
    confidence: c.confidence,
    reasoning: c.reasoning,
    classifiedAt: new Date(c.classifiedAt),
    professionalSubType: c.professionalSubType,
    patientName: c.patientName,
    documentRequested: c.documentRequested,
    eventDate: c.eventDate,
    registrationDeadline: c.registrationDeadline,
    documentDirection: c.documentDirection,
    requiresDocument: c.requiresDocument,
    documentType: c.documentType,
    documentDueDays: c.documentDueDays,
    prescriptionRequest: c.prescriptionRequest ?? null,
    complexity: c.complexity,
    complexityReasons: c.complexityReasons,
  };
  await db
    .insert(aiClassificationsTable)
    .values(values)
    .onConflictDoUpdate({
      target: [
        aiClassificationsTable.clinicianId,
        aiClassificationsTable.outlookEmailId,
      ],
      set: {
        category: values.category,
        priority: values.priority,
        confidence: values.confidence,
        reasoning: values.reasoning,
        classifiedAt: values.classifiedAt,
        professionalSubType: values.professionalSubType,
        patientName: values.patientName,
        documentRequested: values.documentRequested,
        eventDate: values.eventDate,
        registrationDeadline: values.registrationDeadline,
        documentDirection: values.documentDirection,
        requiresDocument: values.requiresDocument,
        documentType: values.documentType,
        documentDueDays: values.documentDueDays,
        prescriptionRequest: values.prescriptionRequest,
        complexity: values.complexity,
        complexityReasons: values.complexityReasons,
      },
    });
  res.status(204).send();
});

export default router;
