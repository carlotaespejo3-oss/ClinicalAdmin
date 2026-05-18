import { Router } from "express";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, chatAuditTable } from "@workspace/db";
import { RecordChatAuditTurnBody } from "@workspace/api-zod";
import { deidentify, type Participant } from "../lib/deidentify";

const router = Router();
const DEFAULT_CLINICIAN_ID = "default";

// GET /api/chat-audit/:outlookEmailId — return the full thread in turn order.
// Not currently rendered by any UI, but a future "show my AI trail" view
// will use it. Empty thread returns [] (200), not 404 — distinguishes
// "no chat" from "lookup failed".
router.get("/chat-audit/:outlookEmailId", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  const rows = await db
    .select()
    .from(chatAuditTable)
    .where(
      and(
        eq(chatAuditTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(chatAuditTable.outlookEmailId, id),
      ),
    )
    .orderBy(asc(chatAuditTable.turnIndex), asc(chatAuditTable.id));
  res.json(
    rows.map((r) => ({
      id: r.id,
      outlookEmailId: r.outlookEmailId,
      turnIndex: r.turnIndex,
      role: r.role,
      kind: r.kind,
      contentDeid: r.contentDeid,
      contentHash: r.contentHash,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// POST /api/chat-audit/:outlookEmailId/turn — append one de-identified turn.
//
// The clinician's own typed messages are scrubbed too: the consultant may
// reasonably type a name when asking a question, so neither side of the
// conversation is trusted to be name-free.
//
// Append-only: every send produces a new row. We do NOT enforce
// uniqueness on (clinicianId, outlookEmailId, turnIndex) — if the
// client retries a failed POST, both retries are recorded, which is
// the medico-legally safer default for an audit table (no silent
// dedupe). The GET orders by (turnIndex, id) so retries land
// adjacent to the original turn.
router.post("/chat-audit/:outlookEmailId/turn", async (req, res) => {
  const id = req.params.outlookEmailId;
  if (!id) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  const parsed = RecordChatAuditTurnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const body = parsed.data;

  // Defence in depth: refuse a write that can't de-identify because the
  // client supplied no names. The openapi schema enforces minItems: 1,
  // this is the runtime backstop.
  if (body.participants.length === 0) {
    res.status(400).json({ error: "participants required" });
    return;
  }

  // Hash the ORIGINAL pre-scrub content server-side. The client never
  // sends the hash — tamper-evidence is only meaningful if the server is
  // the single source of truth for it. The original is discarded
  // immediately after hashing + scrubbing; only the de-identified text
  // and the server-computed hash land in the DB.
  const contentHash = createHash("sha256").update(body.content, "utf8").digest("hex");

  // De-id BEFORE write. Original is never persisted.
  const participants: Participant[] = body.participants.map((p) => ({
    name: p.name,
    role: p.role,
  }));
  const scrubbed = deidentify(body.content, participants);

  // Defensive leak-check mirroring draft_audit: refuse the write if any
  // supplied name still appears verbatim in the scrubbed output. Fails
  // closed — generic 500 + count-only log line so a real name never
  // ends up in the response or the log.
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
    req.log.error({ leakedCount: leaked.length }, "chat-audit deidentify leaked names; refusing write");
    res.status(500).json({ error: "De-identification failed" });
    return;
  }

  await db.insert(chatAuditTable).values({
    clinicianId: DEFAULT_CLINICIAN_ID,
    outlookEmailId: id,
    turnIndex: body.turnIndex,
    role: body.role,
    kind: body.kind,
    contentDeid: scrubbed,
    contentHash,
  });
  res.status(204).send();
});

export default router;
