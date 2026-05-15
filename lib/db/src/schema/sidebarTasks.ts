import { pgTable, text, integer, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Quick-checklist items the clinician adds in the sidebar — small
// admin chores that aren't worth living in the formal Tasks tab
// ("ring back reception", "sign discharge letter"). Fully
// user-managed: add, toggle done, remove.
//
// Composite PK (clinician_id, id) — multi-clinician ready. `id` is
// client-generated ("s<timestamp>") so the client knows the id
// immediately for fire-and-forget mutations.
//
// Storage rule: the clinician types these titles themselves; nothing
// here originates from email content.
export const sidebarTasksTable = pgTable(
  "sidebar_tasks",
  {
    clinicianId: text("clinician_id").notNull(),
    id: text("id").notNull(),
    title: text("title").notNull(),
    estMin: integer("est_min").notNull(),
    priority: text("priority", { enum: ["high", "normal"] }).notNull(),
    done: boolean("done").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clinicianId, table.id] })],
);

// Full upsert shape. POST /sidebar-tasks/{id} replaces the row
// wholesale — same pattern as weekly_plans. `done` is toggled by
// re-posting the existing values with the flag flipped, which is
// trivial because the client already has the full row in cache.
export const sidebarTaskSchema = z.object({
  title: z.string().min(1),
  estMin: z.number().int().min(0),
  priority: z.enum(["high", "normal"]),
  done: z.boolean(),
});

export type SidebarTaskRow = typeof sidebarTasksTable.$inferSelect;
export type SidebarTaskInput = z.infer<typeof sidebarTaskSchema>;
