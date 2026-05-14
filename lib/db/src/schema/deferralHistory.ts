import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Records, per email, every ISO-week (Monday) in which the planner
// could not fit it into the runway. Moved out of browser localStorage
// so the warning persists across devices and browser clears — a
// clinician switching from desk to laptop must still see "deferred
// twice" on a slipping email.
//
// Granularity is per ISO-week: the count is `weeksDeferred.length`,
// and idempotency for the same (emailId, weekMonday) pair is
// enforced server-side to prevent UI re-render churn from inflating
// counts. Rows are deleted entirely when the email is archived,
// acknowledged, or marked done — the warning is meaningful only on
// active, unresolved emails.
export const deferralHistoryTable = pgTable("deferral_history", {
  emailId: integer("email_id").primaryKey(),
  // ISO 'YYYY-MM-DD' Monday strings, ascending.
  weeksDeferred: jsonb("weeks_deferred").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertDeferralHistorySchema = createInsertSchema(
  deferralHistoryTable,
).omit({ updatedAt: true });

export type DeferralHistoryRow = typeof deferralHistoryTable.$inferSelect;
export type InsertDeferralHistory = z.infer<typeof insertDeferralHistorySchema>;
