import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Clinician leave / time-off — annual leave, sick days, conference,
// professional development, unpaid leave. Drives the planner to zero
// out availability on covered days so the workload is replanned
// around the absence.
//
// v1 minimal scope (locked):
//   - solo clinician (no clinicianId discrimination; uses
//     DEFAULT_CLINICIAN_ID like every other per-clinician table)
//   - add / list / delete leave blocks
//   - planner zeros out admin minutes on covered days
//   - NO recovery ramp, NO pre-leave wind-down, NO diff/review yet
//     (those are deliberately deferred to v2 — see the design doc)
//
// Composite PK (clinician_id, id) — multi-clinician ready. `id` is
// client-generated ("lv<timestamp>_<rand>") so the client knows the
// id immediately for fire-and-forget mutations.
//
// Half-days are expressed via datetimes (e.g. startAt = 09:00,
// endAt = 13:00). endAt is treated as EXCLUSIVE by the resolver.
//
// Storage rule: this is purely the clinician's own scheduling
// metadata — nothing here originates from email content.
export const leaveBlocksTable = pgTable(
  "leave_blocks",
  {
    clinicianId: text("clinician_id").notNull(),
    id: text("id").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    leaveType: text("leave_type", {
      enum: ["annual", "sick", "conference", "pd", "unpaid"],
    }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Bumped server-side on every upsert. Lets the UI sort "recently
    // edited" and supports future last-write-wins reconciliation
    // across devices without pulling the row.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clinicianId, table.id] })],
);

// POST /leave-blocks/{id} upsert body. Mirrors the sidebar_tasks
// pattern: full replace on conflict, idempotent for retries.
export const leaveBlockSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  leaveType: z.enum(["annual", "sick", "conference", "pd", "unpaid"]),
  notes: z.string().max(500).nullable().optional(),
});

export type LeaveBlockRow = typeof leaveBlocksTable.$inferSelect;
export type LeaveBlockInput = z.infer<typeof leaveBlockSchema>;
