import { pgTable, text, integer, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Behavioural signal ONLY — this table records that the planner could
// not fit a given email into one or more weekly runways. It is NEVER
// a copy of email content.
//
// Storage rule for this app: emails live in Outlook. Our database
// stores only references (outlook_email_id) plus behavioural metadata
// (which weeks the email slipped, how many times). Subject, body,
// sender, and any other email content are fetched live from Microsoft
// Graph at display time and never duplicated here.
//
// Schema fields:
//   clinician_id      who this record belongs to (multi-clinician ready)
//   outlook_email_id  pointer back to the Microsoft Graph message — text
//                     because Graph IDs are long opaque strings, not ints
//   iso_weeks         array of 'YYYY-MM-DD' Monday strings, ascending,
//                     for each ISO week the planner could not place it
//   deferral_count    iso_weeks.length, denormalised for cheap reads/sort
//   updated_at        last write timestamp
//
// The "deferral warning level" (none / once / twice-or-more) is NOT
// stored. It's a pure function of deferral_count and is derived where
// needed; persisting it would create a two-source-of-truth hazard.
//
// PK is composite (clinician_id, outlook_email_id) so each clinician
// has independent history for the same Outlook message — useful for
// shared-inbox scenarios.
export const deferralHistoryTable = pgTable(
  "deferral_history",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    isoWeeks: jsonb("iso_weeks").$type<string[]>().notNull().default([]),
    deferralCount: integer("deferral_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.outlookEmailId] })],
);

export const insertDeferralHistorySchema = createInsertSchema(
  deferralHistoryTable,
).omit({ updatedAt: true });

export type DeferralHistoryRow = typeof deferralHistoryTable.$inferSelect;
export type InsertDeferralHistory = z.infer<typeof insertDeferralHistorySchema>;
