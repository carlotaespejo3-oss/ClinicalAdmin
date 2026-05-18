import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, draftAuditTable, type EvidenceSnapshotEntry } from "@workspace/db";
import { RecordDraftAuditBody, RecordDraftAuditSentBody } from "@workspace/api-zod";
import { deidentify, type Participant } from "../lib/deidentify";

const router = Router();
const DEFAULT_CLINICIAN_ID = "default";

// GET /api/draft-audit/:outlookEmailId — read the audit row.
// Not currently rendered by any UI, but kept cheap for the future
// "show my audit trail" view.
router.get("/draft-audit/:outlookEmailId", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  const rows = await db
    .select()
    .from(draftAuditTable)
    .where(
      and(
        eq(draftAuditTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(draftAuditTable.outlookEmailId, id),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) {
    res.status(404).json({ error: "No audit row for this email" });
    return;
  }
  res.json({
    outlookEmailId: r.outlookEmailId,
    aiDraftText: r.aiDraftText,
    aiDraftHash: r.aiDraftHash,
    sentHash: r.sentHash,
    draftEdited: r.draftEdited,
    evidenceSnapshot: r.evidenceSnapshot,
    draftedAt: r.draftedAt ? r.draftedAt.toISOString() : null,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
});

// POST /api/draft-audit/:outlookEmailId/draft
// Records the AI draft (de-identified) + the evidence snapshot at draft
// time. The server scrubs aiDraftText against the supplied participants
// BEFORE any DB write. Idempotent on (clinicianId, outlookEmailId): re-
// drafting overwrites the previous draft text + snapshot and resets sent
// state so we don't carry a stale sentHash across a re-draft.
router.post("/draft-audit/:outlookEmailId/draft", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  const parsed = RecordDraftAuditBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const body = parsed.data;

  // De-id BEFORE write. Original is discarded after the call — never
  // touches the DB. The hash the client computed is on the original
  // pre-scrub text (single source of truth for draft_edited comparison).
  const participants: Participant[] = body.participants.map((p) => ({
    name: p.name,
    role: p.role,
  }));
  const scrubbed = deidentify(body.aiDraftText, participants);

  // Defensive: if the scrubber leaves any of the supplied names verbatim
  // in the output, refuse the write. This catches dev regressions where
  // someone tweaks the helper and lets a name through. The check mirrors
  // the scrubber: full names AND every whitespace-split token of length
  // >= 2, case-insensitive whole-word. Fails closed — 500 with a
  // generic error and a (count-only) log line.
  const leakNeedles = new Set<string>();
  for (const p of participants) {
    const name = p.name.trim();
    if (name.length < 2) continue;
    leakNeedles.add(name.toLowerCase());
    for (const token of name.split(/\s+/)) {
      if (token.length < 2) continue;
      leakNeedles.add(token.toLowerCase());
    }
  }
  const leaked = Array.from(leakNeedles).filter((n) =>
    new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(scrubbed),
  );
  if (leaked.length > 0) {
    req.log.error({ leakedCount: leaked.length }, "deidentify leaked names; refusing write");
    res.status(500).json({ error: "De-identification failed" });
    return;
  }

  // Cast: orval generates the snapshot's flag as the open enum; our
  // table type uses the same union. Safe by construction.
  const snapshot = body.evidenceSnapshot as EvidenceSnapshotEntry[];
  const draftedAt = new Date(body.draftedAt);
  const now = new Date();

  await db
    .insert(draftAuditTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: id,
      aiDraftText: scrubbed,
      aiDraftHash: body.aiDraftHash,
      sentHash: null,
      draftEdited: false,
      evidenceSnapshot: snapshot,
      draftedAt,
      sentAt: null,
    })
    .onConflictDoUpdate({
      target: [draftAuditTable.clinicianId, draftAuditTable.outlookEmailId],
      set: {
        aiDraftText: scrubbed,
        aiDraftHash: body.aiDraftHash,
        // Preserve sent state when this POST is just a replay of the same
        // draft (same hash). Reset sent state ONLY when the hash differs
        // — that's a genuine re-draft, where any stored sentHash refers
        // to a previous draft and must not be compared against this one.
        // This also makes us race-safe if /sent lands before /draft: the
        // /draft POST that arrives later carries the hash the client
        // already sent against, so the existing sentHash is preserved.
        sentHash: sql`CASE WHEN ${draftAuditTable.aiDraftHash} = ${body.aiDraftHash} THEN ${draftAuditTable.sentHash} ELSE NULL END`,
        draftEdited: sql`CASE WHEN ${draftAuditTable.aiDraftHash} = ${body.aiDraftHash} THEN ${draftAuditTable.draftEdited} ELSE FALSE END`,
        sentAt: sql`CASE WHEN ${draftAuditTable.aiDraftHash} = ${body.aiDraftHash} THEN ${draftAuditTable.sentAt} ELSE NULL END`,
        evidenceSnapshot: snapshot,
        draftedAt,
        updatedAt: now,
      },
    });
  res.status(204).send();
});

// POST /api/draft-audit/:outlookEmailId/sent
// Hash-only sent-record. The full sent text never leaves the browser.
// Server compares sentHash against the stored ai_draft_hash to derive
// draft_edited. Defensive: if no draft row exists yet (sent-before-
// draft, which should be impossible in practice), insert a stub with
// just the sent fields so we still record that the send happened.
router.post("/draft-audit/:outlookEmailId/sent", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  const parsed = RecordDraftAuditSentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const body = parsed.data;
  const sentAt = new Date(body.sentAt);
  const now = new Date();

  const existing = await db
    .select({ aiDraftHash: draftAuditTable.aiDraftHash })
    .from(draftAuditTable)
    .where(
      and(
        eq(draftAuditTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(draftAuditTable.outlookEmailId, id),
      ),
    )
    .limit(1);
  const priorHash = existing[0]?.aiDraftHash ?? null;
  // draft_edited is meaningful only when we have both hashes. With no
  // prior draft we default to false (we can't claim it was edited if we
  // never saw the original).
  const draftEdited = priorHash !== null && priorHash !== body.sentHash;

  await db
    .insert(draftAuditTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: id,
      aiDraftText: null,
      aiDraftHash: null,
      sentHash: body.sentHash,
      draftEdited,
      evidenceSnapshot: [],
      draftedAt: null,
      sentAt,
    })
    .onConflictDoUpdate({
      target: [draftAuditTable.clinicianId, draftAuditTable.outlookEmailId],
      set: {
        sentHash: body.sentHash,
        draftEdited,
        sentAt,
        updatedAt: now,
      },
    });
  res.status(204).send();
});

export default router;
