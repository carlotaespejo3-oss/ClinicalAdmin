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
// values). Idempotent on (clinicianId, outlookEmailId, kind). On
// conflict we UPDATE the editable fields so the clinician can revise
// the task later (calendar task-detail modal posts back here). We
// deliberately preserve `taskId`, `response`, and `createdAt` so the
// original accept-time identity / audit timestamps stay stable —
// only the fields the form actually lets you change are touched.
router.post("/prompted-tasks", async (req, res) => {
  const parsed = AcceptPromptedTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const t = parsed.data;
  // Phone-call rule (server-enforced): a phone_call task always
  // books 30 minutes regardless of what the client posted. This is
  // the authoritative boundary — the client clamps too, but the
  // server is the only place a crafted request can't bypass. Any
  // other estMin value the client sends is silently coerced here.
  const estMin = t.kind === "phone_call" ? 30 : t.estMin;
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
      estMin,
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
    .onConflictDoUpdate({
      target: [
        promptedTasksTable.clinicianId,
        promptedTasksTable.outlookEmailId,
        promptedTasksTable.kind,
      ],
      set: {
        title: t.title,
        type: t.type,
        estMin,
        priority: t.priority,
        patientName: t.patientName ?? null,
        dueDays: t.dueDays ?? null,
        notes: t.notes,
        // done is also editable via /done; keep it in sync if the
        // client posts it explicitly with an accept.
        done: t.done,
      },
    });
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
