import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Per-week planner snapshot. One row per (clinician, ISO week).
//
// Shape: hours/days/sessionLength inputs the clinician chose for
// that specific week PLUS the GeneratedPlan the planner produced
// from those inputs (which emails got slotted where, what slipped,
// the safety note). Different from clinician_settings.app_settings
// which is the standing default for the planner; this is the
// concrete result for one week.
//
// Stored as a single JSONB blob (`setup`) rather than spread across
// columns because:
//   * the consumer always reads/writes the whole thing together;
//   * the inner GeneratedPlan shape evolves (docSummary, bufferMin,
//     minutesByDay all added after the fact), and additive changes
//     stay schema-free;
//   * hours can be fractional, days is an array, plan is deeply
//     nested — flattening would just leak structure the client
//     already models in TypeScript.
//
// Storage rule: WeekSetup contains planner inputs (hours, days,
// session length) and PlanBlock summaries the planner authored
// from email metadata (`task: "Reply to <patient> re medication"`,
// `reason: "high-risk flag"`). These are clinician-authored
// summaries derived from email metadata, never raw email body or
// sender content. The same summaries already live in
// deferral_history et al — they're our organisational layer over
// the inbox, not a copy of correspondence.
//
// PK is composite (clinician_id, week_key) so multi-clinician falls
// out for free when auth lands. week_key is the ISO-style identifier
// "YYYY-NN" (e.g. "2026-21"); the legacy localStorage key was
// `clinadmin-week-${weekKey}` and the migration strips that prefix.
export const weeklyPlansTable = pgTable(
  "weekly_plans",
  {
    clinicianId: text("clinician_id").notNull(),
    weekKey: text("week_key").notNull(),
    setup: jsonb("setup").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.weekKey] })],
);

export type WeeklyPlanRow = typeof weeklyPlansTable.$inferSelect;

// Wire schema for the WeekSetup blob. Kept passthrough — the client
// owns the inner shape (hours, days, plan, sessionLengthMin,
// minutesByDay). Only the outer fields the server cares about for
// validation are listed; everything else flows through.
export const weekSetupSchema = z
  .object({
    hours: z.number(),
    days: z.array(z.string()),
    plan: z.unknown().nullable().optional(),
    sessionLengthMin: z.number().optional(),
    minutesByDay: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

export type WeekSetupPayload = z.infer<typeof weekSetupSchema>;
