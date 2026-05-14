import { pgTable, text, integer, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Auto-created tasks for emails the classifier flagged as requiring
// a written document (NDIS report, EHCP letter, court report, etc).
// One per email, keyed by (clinicianId, outlookEmailId).
//
// Storage rule: this is the clinician's organisational layer (a task
// label and its action state) plus a reference back to the source
// email. It does not contain email body text. The title is a short
// label like "EHCP Letter — Jamie B — requested by Mrs Davies"; the
// patient name and sender name come from classifier-extracted PII +
// email metadata, both treated here as document/identifier strings,
// not as email content.
//
// Mutable across the task lifetime: `done`, `note_after_email_done`
// (a clinician-typed reminder shown after the originating email is
// marked done — purely the clinician's own note).
//
// All other fields (title, type, category, deadline, risk, est_min,
// auto_complete_on_reply) are set once at creation and don't change.
export const linkedDocTasksTable = pgTable(
  "linked_doc_tasks",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    title: text("title").notNull(),
    cat: text("cat").notNull(),
    type: text("type").notNull(),
    deadline: integer("deadline").notNull(),
    risk: text("risk", { enum: ["high", "medium", "low"] }).notNull(),
    estMin: integer("est_min").notNull(),
    autoCompleteOnReply: boolean("auto_complete_on_reply").notNull().default(true),
    done: boolean("done").notNull().default(false),
    noteAfterEmailDone: text("note_after_email_done"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.outlookEmailId] })],
);

export const insertLinkedDocTaskSchema = createInsertSchema(
  linkedDocTasksTable,
).omit({ createdAt: true });

export type LinkedDocTaskRow = typeof linkedDocTasksTable.$inferSelect;
export type InsertLinkedDocTask = z.infer<typeof insertLinkedDocTaskSchema>;
