import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Per-clinician overrides on the seed ManualTask records that ship
// with the app (m2, m3, m4, m5 in lib/data.ts).
//
// The seed records themselves are static: they describe pre-existing
// admin work the consultant already had to do (callbacks, discharge
// letters, governance items). What the user actually mutates is
// limited to two things — whether they've ticked it off, and an
// optional "kept open because…" note attached when they choose to
// keep a task open after the linked email is done. Storing only the
// override means a future seed change (re-titling a task, removing
// it) doesn't have to dance around stale rows.
//
// Composite PK (clinician_id, task_id) — multi-clinician ready, the
// task_id is the seed id (e.g. "m2"). For overrides on tasks that no
// longer exist in the seed the row is harmless; the merge layer in
// the client store just ignores orphaned overrides.
//
// Storage rule: this is the clinician's own organisational state
// (done flag) plus a clinician-authored note. No email body,
// subject, or sender is stored here — the note is what the
// consultant chose to type when keeping a task open, not anything
// the patient or family wrote.
export const manualTaskOverridesTable = pgTable(
  "manual_task_overrides",
  {
    clinicianId: text("clinician_id").notNull(),
    taskId: text("task_id").notNull(),
    done: boolean("done").notNull().default(false),
    note: text("note"),
    // Editable overlays on the seed record. Nullable = "use seed value".
    // Lets the clinician retitle, reschedule, or resize a seed task
    // (e.g. shrink a discharge letter that turned out to be quick)
    // without us editing the shipped seed array.
    titleOverride: text("title_override"),
    deadlineOverride: integer("deadline_override"),
    estMinOverride: integer("est_min_override"),
    // Soft-delete for seed records. The seed array stays static; this
    // just hides the row from every consumer of useManualTasksWithOverrides.
    hidden: boolean("hidden").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clinicianId, table.taskId] })],
);

// Patch shape. Both fields are optional so callers can flip done
// without touching the note and vice versa. `note: null` clears it.
export const manualTaskOverrideSchema = z.object({
  done: z.boolean().optional(),
  note: z.string().nullable().optional(),
  titleOverride: z.string().min(1).max(200).nullable().optional(),
  deadlineOverride: z.number().int().nullable().optional(),
  estMinOverride: z.number().int().min(0).max(600).nullable().optional(),
  hidden: z.boolean().optional(),
});

export type ManualTaskOverrideRow = typeof manualTaskOverridesTable.$inferSelect;
export type ManualTaskOverridePatch = z.infer<typeof manualTaskOverrideSchema>;
