// =============================================================================
// Client-side helper for the chat-audit carve-out.
// =============================================================================
//
// Fire-and-forget POST on top of the generated API client. Called twice
// per round-trip in the chat box:
//
//   - once with the clinician's typed message (role='clinician',
//     kind='message')
//   - once with the AI reply (role='assistant', kind='draft'|'answer')
//
// Both pass through the same server-side de-identification pass as
// draft_audit, against the participants extracted from the open
// email + classification. The content is hashed BEFORE the network
// hop so the audit trail can later confirm what was de-identified
// without ever storing the original.
//
// Errors are swallowed and logged — the audit trail is medico-legal
// documentation, not a safety gate. A failed POST must not block the
// clinician's actual work.
// =============================================================================

import { recordChatAuditTurn } from "@workspace/api-client-react";
import type { EmailParticipant } from "@workspace/api-zod";

export interface RecordChatTurnInput {
  outlookEmailId: string;
  turnIndex: number;
  role: "clinician" | "assistant";
  kind: "message" | "draft" | "answer";
  content: string;
  participants: EmailParticipant[];
}

// The server hashes the content itself (single source of truth for
// tamper-evidence) and de-identifies it before any DB write. The
// client just forwards the raw content + the participants list it
// extracted from the open email.
export async function recordChatTurn(input: RecordChatTurnInput): Promise<void> {
  try {
    await recordChatAuditTurn(input.outlookEmailId, {
      turnIndex: input.turnIndex,
      role: input.role,
      kind: input.kind,
      content: input.content,
      participants: input.participants,
    });
  } catch (err) {
    // Fire-and-forget — never block the chat on an audit failure.
    console.warn("[chatAudit] recordChatTurn failed", err);
  }
}
