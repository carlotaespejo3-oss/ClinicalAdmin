import {
  pgTable,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Audit log of backlog items that were auto-dismissed by the pre-filter
// or the AI relevance pass, or manually dismissed by the clinician.
//
// WHY STORE AT ALL: the full email body lives in Outlook and we never
// replicate it here. The subject + sender fields are the minimum the
// clinician needs to recognise an email in the audit list and decide
// whether to restore it. Without this table, there is no audit trail
// and no restore path.
//
// GDPR / DATA MINIMISATION: subject lines can occasionally contain
// patient names or identifiers, so this table is personal data and
// carries the same access controls as the rest of the per-clinician
// data. No body, no attachment content, no headers beyond what we need
// for recognition. Retention: indefinite while the account is active;
// a "Clear dismissed history" action in Settings triggers a batch delete.
//
// DISMISS REASONS (enum):
//   rule:thread_replied      — clinician has a sent-item after the last incoming
//   rule:calendar_expired    — calendar invite with a past event date
//   rule:bulk_mail           — List-ID / Precedence:bulk / mailing-list headers
//   rule:auto_reply          — Auto-Submitted / X-Autoreply headers
//   rule:system_generated    — MAILER-DAEMON sender, delivery receipt subject
//   rule:non_inbox_folder    — email is in Sent/Deleted/Junk/Archive/Drafts
//   ai:expired               — AI relevance pass judged the item expired
//   ai:noise                 — AI relevance pass judged the item irrelevant
//   manual                   — clinician explicitly dismissed it from the backlog
//
// RESTORE: restoredAt is set when the clinician restores a dismissed item
// back to the active backlog. The item is re-inserted into backlog_items
// with a fresh id; this row is kept for the audit trail.
export const dismissedBacklogItemsTable = pgTable(
  "dismissed_backlog_items",
  {
    clinicianId: text("clinician_id").notNull(),
    id: text("id").notNull(),
    outlookMessageId: text("outlook_message_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    subject: text("subject").notNull(),
    senderName: text("sender_name").notNull(),
    senderAddress: text("sender_address").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dismissReason: text("dismiss_reason", {
      enum: [
        "rule:thread_replied",
        "rule:calendar_expired",
        "rule:bulk_mail",
        "rule:auto_reply",
        "rule:system_generated",
        "rule:non_inbox_folder",
        "ai:expired",
        "ai:noise",
        "manual",
      ],
    }).notNull(),
    // Set when the clinician restores this item to the active backlog.
    // The restored item gets a fresh backlog_items row; this row is
    // retained so the audit trail is complete.
    restoredAt: timestamp("restored_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.clinicianId, table.id] })],
);

export const DISMISS_REASONS = [
  "rule:thread_replied",
  "rule:calendar_expired",
  "rule:bulk_mail",
  "rule:auto_reply",
  "rule:system_generated",
  "rule:non_inbox_folder",
  "ai:expired",
  "ai:noise",
  "manual",
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number];

// POST body for recording a dismissed item.
export const dismissedBacklogItemSchema = z.object({
  outlookMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  subject: z.string().min(1),
  senderName: z.string(),
  senderAddress: z.string(),
  receivedAt: z.string().datetime(),
  dismissedAt: z.string().datetime(),
  dismissReason: z.enum([
    "rule:thread_replied",
    "rule:calendar_expired",
    "rule:bulk_mail",
    "rule:auto_reply",
    "rule:system_generated",
    "rule:non_inbox_folder",
    "ai:expired",
    "ai:noise",
    "manual",
  ]),
});

export type DismissedBacklogItemRow =
  typeof dismissedBacklogItemsTable.$inferSelect;
export type DismissedBacklogItemInput = z.infer<
  typeof dismissedBacklogItemSchema
>;
