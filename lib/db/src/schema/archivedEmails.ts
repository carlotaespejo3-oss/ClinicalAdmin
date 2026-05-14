import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Records that an email has been archived by a clinician — either
// because they acknowledged it (no action needed) or marked it done.
//
// Storage rule (same as deferral_history): this table holds ONLY a
// reference to the Outlook message plus behavioural metadata. Subject,
// body, sender, and any other email content are fetched live from
// Microsoft Graph at display time and never duplicated here.
//
// Schema fields:
//   clinician_id      who this archive entry belongs to
//   outlook_email_id  pointer back to the Microsoft Graph message
//   kind              'acknowledged' (no action) or 'done' (handled)
//   archived_at       when the user archived it (drives Archive tab order)
//
// PK is composite (clinician_id, outlook_email_id): each clinician has
// their own archive even if a message is shared.
export const archivedEmailsTable = pgTable(
  "archived_emails",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    kind: text("kind", { enum: ["acknowledged", "done"] }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.outlookEmailId] })],
);

export const insertArchivedEmailSchema = createInsertSchema(
  archivedEmailsTable,
).omit({ archivedAt: true });

export type ArchivedEmailRow = typeof archivedEmailsTable.$inferSelect;
export type InsertArchivedEmail = z.infer<typeof insertArchivedEmailSchema>;
