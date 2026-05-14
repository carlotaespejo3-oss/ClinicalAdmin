import { pgTable, text, integer, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// "Possible task detected" prompts from the inbox panel. The clinician
// either accepts (after editing the pre-filled form) or dismisses
// each suggestion. Keyed by (clinicianId, outlookEmailId, kind) so
// each email can have one decision per detected kind.
//
// Storage rule: per the three-bucket rule, this stores the clinician's
// EXPLICIT RESPONSE to each suggestion. When response='accepted', the
// other fields hold the clinician's saved values from the form (they
// edit the AI's pre-filled suggestion before saving — what we store is
// what they approved, not the raw AI text). When response='dismissed',
// the task fields are NULL — there's nothing to remember beyond "they
// said no".
//
// Implicit-dismiss-on-accept: in the client, accepting a suggestion
// also suppresses the prompt for that (email, kind). We don't write a
// second 'dismissed' row — the existence of any row for that key
// satisfies isPromptDismissed.
//
// Mutable: `done`. All other accepted-task fields are set once at
// acceptance time and don't change.
export const promptedTasksTable = pgTable(
  "prompted_tasks",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    kind: text("kind").notNull(),
    response: text("response", { enum: ["accepted", "dismissed"] }).notNull(),
    // Below: only populated when response='accepted'.
    taskId: text("task_id"),
    title: text("title"),
    type: text("type"),
    estMin: integer("est_min"),
    priority: text("priority", { enum: ["high", "medium", "low"] }),
    patientName: text("patient_name"),
    dueDays: integer("due_days"),
    notes: text("notes"),
    done: boolean("done"),
    controlledDrug: boolean("controlled_drug"),
    medicationName: text("medication_name"),
    medicationDose: text("medication_dose"),
    travelMentioned: boolean("travel_mentioned"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.outlookEmailId, t.kind] })],
);

export const insertPromptedTaskSchema = createInsertSchema(
  promptedTasksTable,
).omit({ createdAt: true });

export type PromptedTaskRow = typeof promptedTasksTable.$inferSelect;
export type InsertPromptedTask = z.infer<typeof insertPromptedTaskSchema>;
