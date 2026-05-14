import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, promptedTasksTable } from "@workspace/db";
import {
  AcceptPromptedTaskBody,
  DismissPromptedTaskBody,
  SetPromptedTaskDoneApiBody,
} from "@workspace/api-zod";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/prompted-tasks — returns {tasks, dismissed}. An accepted
// row also implicitly suppresses the prompt for that (email, kind),
// matching the client's original semantics.
router.get("/prompted-tasks", async (_req, res) => {
  const rows = await db
    .select()
    .from(promptedTasksTable)
    .where(eq(promptedTasksTable.clinicianId, DEFAULT_CLINICIAN_ID));

  const tasks = rows
    .filter((r) => r.response === "accepted")
    .map((r) => ({
      taskId: r.taskId ?? "",
      outlookEmailId: r.outlookEmailId,
      kind: r.kind,
      title: r.title ?? "",
      type: r.type ?? "",
      estMin: r.estMin ?? 0,
      priority: (r.priority ?? "medium") as "high" | "medium" | "low",
      patientName: r.patientName,
      dueDays: r.dueDays,
      notes: r.notes ?? "",
      done: r.done ?? false,
      controlledDrug: r.controlledDrug,
      medicationName: r.medicationName,
      medicationDose: r.medicationDose,
      travelMentioned: r.travelMentioned,
      createdAt: r.createdAt.toISOString(),
    }));

  // Dismissed list is the union of explicit dismissals AND accepted
  // entries — accepting implicitly dismisses the prompt for that
  // (email, kind), so consumers calling isPromptDismissed should see
  // both as suppressed.
  const dismissed = rows.map((r) => ({
    outlookEmailId: r.outlookEmailId,
    kind: r.kind,
  }));

  res.json({ tasks, dismissed });
});

// POST /api/prompted-tasks — accept (with the clinician's saved form
// values). Idempotent on (clinicianId, outlookEmailId, kind) — re-posts
// no-op so we don't overwrite the original accepted-at timestamp.
router.post("/prompted-tasks", async (req, res) => {
  const parsed = AcceptPromptedTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const t = parsed.data;
  await db
    .insert(promptedTasksTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: t.outlookEmailId,
      kind: t.kind,
      response: "accepted",
      taskId: t.taskId,
      title: t.title,
      type: t.type,
      estMin: t.estMin,
      priority: t.priority,
      patientName: t.patientName ?? null,
      dueDays: t.dueDays ?? null,
      notes: t.notes,
      done: t.done,
      controlledDrug: t.controlledDrug ?? null,
      medicationName: t.medicationName ?? null,
      medicationDose: t.medicationDose ?? null,
      travelMentioned: t.travelMentioned ?? null,
    })
    .onConflictDoNothing();
  res.status(204).send();
});

// POST /api/prompted-tasks/dismiss — record an explicit rejection.
// On conflict do nothing so we never clobber an accepted row with
// a dismissal (matches client's "accepted implies dismissed" model).
router.post("/prompted-tasks/dismiss", async (req, res) => {
  const parsed = DismissPromptedTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { outlookEmailId, kind } = parsed.data;
  await db
    .insert(promptedTasksTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId,
      kind,
      response: "dismissed",
    })
    .onConflictDoNothing();
  res.status(204).send();
});

// POST /api/prompted-tasks/done — toggle the done flag on an accepted
// task. No-op on dismissed/missing rows. Body POST (not PATCH/path
// param) to keep multi-segment ids/kinds out of the URL.
router.post("/prompted-tasks/done", async (req, res) => {
  const parsed = SetPromptedTaskDoneApiBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { outlookEmailId, kind, done } = parsed.data;
  await db
    .update(promptedTasksTable)
    .set({ done })
    .where(
      and(
        eq(promptedTasksTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(promptedTasksTable.outlookEmailId, outlookEmailId),
        eq(promptedTasksTable.kind, kind),
        eq(promptedTasksTable.response, "accepted"),
      ),
    );
  res.status(204).send();
});

export default router;
