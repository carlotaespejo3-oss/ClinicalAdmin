// =============================================================================
// Client-side helpers for the draft-audit carve-out.
// =============================================================================
//
// Two fire-and-forget operations on top of the generated API client:
//
//   recordDraft  — POST /api/draft-audit/{id}/draft after an AI draft lands.
//                  Sends the AI text, the evidence snapshot, and the
//                  participants list for server-side de-id. The server
//                  scrubs the text and hashes the original pre-scrub
//                  text into ai_draft_hash (server-side hash = single
//                  source of truth for tamper-evidence) before writing
//                  to the DB.
//
//   recordSent   — POST /api/draft-audit/{id}/sent when the clinician hits
//                  Send. Hashes the final sent text and sends ONLY the hash.
//                  The text itself never leaves the browser. Server
//                  compares against the stored ai_draft_hash to derive
//                  draft_edited.
//
// Both helpers swallow errors and log to console — the audit trail is
// medico-legal documentation, not a safety gate. A failed POST must not
// block the clinician's actual work.
//
// Known Stage 4 limitation: draft_audit's PK is (clinician, outlookEmailId)
// — one row per email. For SAFEGUARDING / URGENT_CLINICAL emails that
// generate parallel family + admin drafts, only the last-written one is
// captured. We only call recordDraft from the CLINICAL single-slot path
// (the evidence-citing path) so this isn't yet a problem in practice.
// =============================================================================

import {
  recordDraftAudit,
  recordDraftAuditSent,
} from "@workspace/api-client-react";
import type { EvidenceSnapshotEntry, EmailParticipant } from "@workspace/api-zod";

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface RecordDraftInput {
  outlookEmailId: string;
  aiDraftText: string;
  evidenceSnapshot: EvidenceSnapshotEntry[];
  participants: EmailParticipant[];
}

export async function recordDraft(input: RecordDraftInput): Promise<void> {
  try {
    await recordDraftAudit(input.outlookEmailId, {
      aiDraftText: input.aiDraftText,
      evidenceSnapshot: input.evidenceSnapshot,
      participants: input.participants,
      draftedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Fire-and-forget — never block the draft pipeline on an audit failure.
    console.warn("[draftAudit] recordDraft failed", err);
  }
}

export async function recordSent(
  outlookEmailId: string,
  sentText: string,
): Promise<void> {
  try {
    const sentHash = await sha256Hex(sentText);
    await recordDraftAuditSent(outlookEmailId, {
      sentHash,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[draftAudit] recordSent failed", err);
  }
}
