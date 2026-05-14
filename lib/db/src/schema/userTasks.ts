import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tasks the clinician adds to their own task list — currently the
// "Add CPD to tasks" one-click action and (future) manual entries.
//
// Storage rule: this is the clinician's own organisational data
// (their chosen task title, optional dates they care about). It is
// NOT email content. When a task is linked to an email we store the
// outlookEmailId as a reference only; subject/body/sender are fetched
// live from Microsoft Graph at display time.
//
// Schema notes:
//   id                    client-generated 'ut_<base36>_<rand>'. Acts as
//                         primary key and lets the client know the id
//                         immediately for fire-and-forget mutations.
//   clinician_id          per-clinician scope (single-tenant for now).
//   outlook_email_id      reference to source email; NULL for manual
//                         tasks not tied to a specific message.
//   title                 the clinician's task title (CPD auto-title or
//                         their own typed text).
//   source                'cpd' | 'manual' — drives icon / future
//                         filtering in the Tasks tab.
//   event_date            ISO YYYY-MM-DD; CPD event start.
//   registration_deadline ISO YYYY-MM-DD; CPD early-bird / registration cut-off.
//   created_at            insert time, used for descending order in UI.
export const userTasksTable = pgTable("user_tasks", {
  id: text("id").primaryKey(),
  clinicianId: text("clinician_id").notNull(),
  outlookEmailId: text("outlook_email_id"),
  title: text("title").notNull(),
  source: text("source", { enum: ["cpd", "manual"] }).notNull(),
  eventDate: text("event_date"),
  registrationDeadline: text("registration_deadline"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertUserTaskSchema = createInsertSchema(userTasksTable).omit({
  createdAt: true,
});

export type UserTaskRow = typeof userTasksTable.$inferSelect;
export type InsertUserTask = z.infer<typeof insertUserTaskSchema>;
