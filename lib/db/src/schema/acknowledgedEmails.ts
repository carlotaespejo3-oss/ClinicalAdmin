import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Records that an email has been acknowledged ("seen, no action") by a
// clinician. Parallel to archived_emails — kept as a separate table to
// mirror the existing two-store client design 1:1 without refactoring
// business logic in this round.
//
// Storage rule: reference + behavioural metadata only. NEVER any email
// content. Subject/body/sender come live from Microsoft Graph.
//
// Composite PK (clinician_id, outlook_email_id) — per-clinician.
export const acknowledgedEmailsTable = pgTable(
  "acknowledged_emails",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.outlookEmailId] })],
);

export const insertAcknowledgedEmailSchema = createInsertSchema(
  acknowledgedEmailsTable,
).omit({ acknowledgedAt: true });

export type AcknowledgedEmailRow = typeof acknowledgedEmailsTable.$inferSelect;
export type InsertAcknowledgedEmail = z.infer<
  typeof insertAcknowledgedEmailSchema
>;
