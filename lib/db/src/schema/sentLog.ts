import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Audit trail of every reply the clinician HANDS OFF to their mail
// client via the mailto: link. We can't observe what the mail client
// does after handoff (the user may cancel in Outlook, the URL may
// exceed length limits, etc.), so this is a "handoff log", not a
// true sent log. The UI surfaces it that way.
//
// Storage rule (three-bucket): outgoing email content lives in
// Outlook Sent Items, not here. We deliberately persist NO subject
// line and NO body — not even a snippet. Stored fields are the
// clinician's organisational metadata only:
//
//   - id              client-generated handoff id (globally unique)
//   - outlookEmailId  reference to the email being replied to
//   - variant         which draft slot (single/family/admin/chat/unknown)
//   - sentAt          when the mailto handoff fired
//
// Multiple rows per email are expected (single + admin variant for
// the same thread, retried draft, etc.) — that's why `id` is the PK
// rather than (clinicianId, outlookEmailId).
export const sentLogTable = pgTable(
  "sent_log",
  {
    id: text("id").primaryKey(),
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    variant: text("variant", {
      enum: ["single", "family", "admin", "chat", "unknown"],
    }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Lookups are always scoped by clinician and frequently grouped by
    // email (lastSentByEmailId). Composite index keeps both fast.
    index("sent_log_clinician_email_idx").on(t.clinicianId, t.outlookEmailId),
  ],
);

export const insertSentLogSchema = createInsertSchema(sentLogTable).omit({
  sentAt: true,
});

export type SentLogRow = typeof sentLogTable.$inferSelect;
export type InsertSentLog = z.infer<typeof insertSentLogSchema>;
