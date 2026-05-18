import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Maps an Outlook email to one ClinAdmin custom folder. Composite PK
// (clinician_id, outlook_email_id) so each clinician owns their own
// assignments and an email can be in at most one ClinAdmin custom
// folder at a time.
//
// Storage rule: pure reference. We keep only the Outlook message ID
// and the folder ID — no subject, sender, body, or any other email
// content. Moves into Outlook-side folders go through the Graph
// move endpoint and never touch this table.
export const emailFolderAssignmentsTable = pgTable(
  "email_folder_assignments",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    customFolderId: text("custom_folder_id").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.outlookEmailId] })],
);

export const insertEmailFolderAssignmentSchema = createInsertSchema(
  emailFolderAssignmentsTable,
).omit({ assignedAt: true });

export type EmailFolderAssignmentRow =
  typeof emailFolderAssignmentsTable.$inferSelect;
export type InsertEmailFolderAssignment = z.infer<
  typeof insertEmailFolderAssignmentSchema
>;
