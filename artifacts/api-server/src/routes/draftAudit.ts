import { Router } from "express";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, draftAuditTable, type EvidenceSnapshotEntry } from "@workspace/db";
import { RecordDraftAuditBody, RecordDraftAuditSentBody } from "@workspace/api-zod";
import { deidentify, type Participant } from "../lib/deidentify";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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
  // touches the DB. The hash is computed SERVER-SIDE from the original
  // pre-scrub text so the tamper-evidence trail isn't trusting a
  // client-supplied value (matches the chat_audit pattern).
  const participants: Participant[] = body.participants.map((p) => ({
    name: p.name,
    role: p.role,
  }));
  const aiDraftHash = sha256Hex(body.aiDraftText);
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
      aiDraftHash,
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
        aiDraftHash,
        // Three cases, evaluated atomically inside the upsert so we are
        // race-safe against a concurrent /sent POST:
        //   1) STUB — prior row has aiDraftHash IS NULL but a sentHash
        //      (sent-before-draft, or a /sent that landed first). Keep
        //      the sent fields and compute draftEdited by comparing the
        //      stored sentHash against this incoming aiDraftHash.
        //   2) REPLAY — prior aiDraftHash matches incoming. Preserve
        //      everything sent-related verbatim.
        //   3) GENUINE RE-DRAFT — prior aiDraftHash exists and differs.
        //      Any stored sentHash refers to a previous draft and must
        //      not be compared against this one; clear sent state.
        sentHash: sql`CASE
          WHEN ${draftAuditTable.aiDraftHash} IS NULL THEN ${draftAuditTable.sentHash}
          WHEN ${draftAuditTable.aiDraftHash} = ${aiDraftHash} THEN ${draftAuditTable.sentHash}
          ELSE NULL
        END`,
        sentAt: sql`CASE
          WHEN ${draftAuditTable.aiDraftHash} IS NULL THEN ${draftAuditTable.sentAt}
          WHEN ${draftAuditTable.aiDraftHash} = ${aiDraftHash} THEN ${draftAuditTable.sentAt}
          ELSE NULL
        END`,
        draftEdited: sql`CASE
          WHEN ${draftAuditTable.aiDraftHash} IS NULL AND ${draftAuditTable.sentHash} IS NOT NULL
            THEN ${draftAuditTable.sentHash} <> ${aiDraftHash}
          WHEN ${draftAuditTable.aiDraftHash} = ${aiDraftHash} THEN ${draftAuditTable.draftEdited}
          ELSE FALSE
        END`,
        evidenceSnapshot: snapshot,
        draftedAt,
        updatedAt: now,
      },
    });
  res.status(204).send();
});

// POST /api/draft-audit/:outlookEmailId/sent
// Hash-only sent-record. The full sent text never leaves the browser
// (storage rule: outgoing correspondence lives in Outlook Sent Items,
// nowhere else). So unlike the /draft handler — which receives the
// full text and recomputes the hash server-side — this endpoint
// necessarily trusts the client-supplied sentHash. The asymmetry is
// deliberate: we'd rather have a client-trusted hash than persist the
// sent body. Server compares sentHash against the stored ai_draft_hash
// to derive draft_edited.
//
// Race-safety: the comparison happens INSIDE the upsert (single SQL
// statement) — no read-modify-write, so a concurrent /draft POST cannot
// slip between a select and an update. Defensive: if no draft row
// exists yet (sent-before-draft, which should be impossible in
// practice), insert a stub with just the sent fields so we still
// record that the send happened. A later /draft POST will then compute
// draft_edited against the stored sentHash via the stub-aware merge in
// the /draft handler.
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

  await db
    .insert(draftAuditTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: id,
      aiDraftText: null,
      aiDraftHash: null,
      sentHash: body.sentHash,
      // No prior draft on insert path → draft_edited cannot be derived;
      // default to false. We can't claim a draft was edited if we
      // never saw the original.
      draftEdited: false,
      evidenceSnapshot: [],
      draftedAt: null,
      sentAt,
    })
    .onConflictDoUpdate({
      target: [draftAuditTable.clinicianId, draftAuditTable.outlookEmailId],
      set: {
        sentHash: body.sentHash,
        sentAt,
        // Compute draft_edited atomically from the stored aiDraftHash
        // vs the incoming sentHash. With no prior draft (NULL hash)
        // the comparison evaluates to false — true edits require a
        // prior known draft to compare against.
        draftEdited: sql`${draftAuditTable.aiDraftHash} IS NOT NULL AND ${draftAuditTable.aiDraftHash} <> ${body.sentHash}`,
        updatedAt: now,
      },
    });
  res.status(204).send();
});

export default router;
