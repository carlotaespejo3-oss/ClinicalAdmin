import { pgTable, text, integer, timestamp, serial, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// =============================================================================
// AUDIT-ONLY EXCEPTION to the three-bucket rule (chat carve-out).
// =============================================================================
//
// Companion to draft_audit: where draft_audit captures the single AI reply
// draft + the text the clinician finally sent, chat_audit captures the
// freeform chat conversation that sits alongside that draft — the
// clinician asking the AI to revise a draft AND the clinician asking the
// AI clinical / literature questions about the open email.
//
// Why this exists: a clinical pilot needs a complete medico-legal trail
// of every AI interaction that touched a patient email. The chat surface
// is one of those interactions; without this table the trail has a hole
// in it.
//
// The same de-identification rules apply as for draft_audit:
//   - Content is scrubbed server-side against the client-supplied
//     participants list BEFORE any DB write.
//   - The pre-scrub original is hashed (SHA-256 hex) and then discarded.
//     Only the de-identified content lands in the DB.
//   - The incoming email body is never persisted here — that is still
//     Outlook's job.
//   - Patient/parent/other names from the AI's replies and the
//     clinician's own messages are both scrubbed. The clinician may
//     reasonably type a name when asking a question, so we cannot trust
//     either side of the conversation to be name-free.
//
// Schema notes:
//   - One row per turn (serial id PK). Multiple turns per email means
//     this cannot share the (clinician, outlookEmailId) PK that
//     draft_audit uses.
//   - turnIndex is the 0-based position of the turn within its
//     email-scoped thread, set client-side at insert time. Combined
//     with (clinicianId, outlookEmailId) it forms a stable ordering
//     even if rows arrive out of order.
//   - role is who spoke. kind tags the assistant's reply shape so a
//     future audit view can render drafts differently from answers.
//     For clinician turns, kind is always 'message'.
// =============================================================================

export const chatAuditTable = pgTable(
  "chat_audit",
  {
    id: serial("id").primaryKey(),
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    turnIndex: integer("turn_index").notNull(),
    // 'clinician' = the consultant's typed message
    // 'assistant' = the AI's reply
    role: text("role").notNull(),
    // 'message' for clinician turns; 'draft' or 'answer' for assistant
    // turns (matches the JSON envelope returned by the chat completion).
    kind: text("kind").notNull(),
    // De-identified content. Never the pre-scrub original.
    contentDeid: text("content_deid").notNull(),
    // SHA-256 hex of the ORIGINAL pre-scrub content. Lets a future
    // audit view confirm that what was de-identified matches what was
    // shown to the clinician, without storing the original text.
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Common read pattern: "give me the full thread for email X, in order".
    index("chat_audit_thread_idx").on(t.clinicianId, t.outlookEmailId, t.turnIndex),
  ],
);

export const insertChatAuditSchema = createInsertSchema(chatAuditTable).omit({
  id: true,
  createdAt: true,
});

export type ChatAuditRow = typeof chatAuditTable.$inferSelect;
export type InsertChatAudit = z.infer<typeof insertChatAuditSchema>;
