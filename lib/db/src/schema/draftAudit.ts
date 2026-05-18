import { pgTable, text, jsonb, timestamp, boolean, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// =============================================================================
// AUDIT-ONLY EXCEPTION to the three-bucket rule.
// =============================================================================
//
// This table stores de-identified AI draft text and evidence snapshots for
// medico-legal audit purposes. The incoming email body is never persisted
// here — that rule is unchanged. Patient names are replaced with
// [PATIENT_NAME] / [PARENT_NAME] / [NAME] placeholders server-side before
// any write. The sent reply text is not stored here — it lives in Outlook on
// Microsoft's servers. Only its SHA-256 hash is recorded so we can tell
// whether the clinician edited the AI draft before sending.
//
// What lives here:
//   - ai_draft_text      — the de-identified AI draft (names scrubbed
//                          before write; original discarded).
//   - ai_draft_hash      — SHA-256 of the ORIGINAL pre-scrub draft.
//                          Compared against sent_hash to derive
//                          draft_edited.
//   - sent_hash          — SHA-256 of the text the clinician actually
//                          sent. Computed client-side at send time; the
//                          text itself never leaves the browser.
//   - draft_edited       — true iff ai_draft_hash !== sent_hash at the
//                          moment of send. Computed server-side.
//   - evidence_snapshot  — frozen copy of the citations block as it was
//                          at draft time: [{tier, sourceName, title,
//                          year, url, flag, flagText}]. Separate from
//                          email_evidence so registry edits don't
//                          rewrite history.
//
// What does NOT live here:
//   - Incoming email body / sender / subject — Outlook owns those.
//   - Sent reply body — Outlook owns it; we keep a hash only.
//   - Raw (non-scrubbed) AI draft text — discarded server-side after
//     hashing.
// =============================================================================

export interface EvidenceSnapshotEntry {
  sourceId: number;
  tier: number;
  sourceName: string;
  title: string;
  year: number;
  url: string;
  flag: "A" | "B" | "C" | "D" | "tier5" | null;
  flagText: string | null;
}

export const draftAuditTable = pgTable(
  "draft_audit",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    // De-identified. Nullable because a sent-record can land before the
    // draft-record in pathological cases (we still want to record the send).
    aiDraftText: text("ai_draft_text"),
    // SHA-256 hex of the ORIGINAL pre-scrub draft. Required when a draft is
    // recorded; nullable for the rare sent-before-draft case.
    aiDraftHash: text("ai_draft_hash"),
    // SHA-256 hex of the text the clinician sent. Set by the /sent endpoint;
    // null until then.
    sentHash: text("sent_hash"),
    draftEdited: boolean("draft_edited").notNull().default(false),
    evidenceSnapshot: jsonb("evidence_snapshot")
      .$type<EvidenceSnapshotEntry[]>()
      .notNull()
      .default([]),
    draftedAt: timestamp("drafted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.outlookEmailId] })],
);

export const insertDraftAuditSchema = createInsertSchema(draftAuditTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type DraftAuditRow = typeof draftAuditTable.$inferSelect;
export type InsertDraftAudit = z.infer<typeof insertDraftAuditSchema>;
