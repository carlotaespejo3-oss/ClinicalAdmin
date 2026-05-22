import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Inbox catch-up backlog. When a new clinician connects Outlook with an
// existing inbox (200-300+ emails), we scan a configurable window
// (1-6 months, default 3) and surface only emails that a rule-based
// pre-filter + optional AI relevance pass judges to be genuinely open.
// These items live here, separate from the live triage flow, so the
// "cruise mode" dashboard stays calm.
//
// STORAGE RULE: minimal recognition metadata only — subject, sender,
// timestamps, and the Outlook message-id reference. No body. No patient
// content. The body is fetched on demand from Graph when the clinician
// clicks "open in Outlook".
//
// STATUS LIFECYCLE:
//   pending  → the default; item awaits clinician review
//   done     → clinician marked it handled (no task needed)
//   deferred → clinician pushed it to the task list (linkedTaskId set)
//
// Items are *not* deleted when resolved — the status is updated so the
// progress bar ("8 of 12 cleared") stays accurate for the session.
// Dismiss (pre-filter rejection or manual) goes to dismissed_backlog_items.
//
// Composite PK (clinician_id, id) — multi-clinician ready. `id` is
// client-generated ("bl<timestamp>_<rand>") so the UI can update
// synchronously while the POST follows asynchronously.
export const backlogItemsTable = pgTable(
  "backlog_items",
  {
    clinicianId: text("clinician_id").notNull(),
    id: text("id").notNull(),
    // Outlook Graph message-id. Lets us build a deep-link
    // back to the original email without storing the body.
    outlookMessageId: text("outlook_message_id").notNull(),
    // Conversation thread id — used in the "see all" modal to group
    // related messages and avoid surfacing the same thread twice.
    conversationId: text("conversation_id").notNull(),
    subject: text("subject").notNull(),
    senderName: text("sender_name").notNull(),
    senderAddress: text("sender_address").notNull(),
    // ISO datetime the email was received in the clinician's inbox.
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    // Higher score = surface earlier. Computed from days-old + AI
    // category when the AI relevance pass runs; falls back to
    // recency-only when only the rule-based pass ran.
    priorityScore: integer("priority_score").notNull().default(50),
    status: text("status", {
      enum: ["pending", "done", "deferred"],
    })
      .notNull()
      .default("pending"),
    // Set when status = 'deferred' — lets LeavePanel / Task tab cross-
    // reference back to the originating backlog item.
    linkedTaskId: text("linked_task_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clinicianId, table.id] })],
);

// Upsert body for creating or updating a backlog item. The full row is
// sent on every write so the server can do a simple ON CONFLICT DO UPDATE.
export const backlogItemSchema = z.object({
  outlookMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  subject: z.string().min(1),
  senderName: z.string(),
  senderAddress: z.string(),
  receivedAt: z.string().datetime(),
  priorityScore: z.number().int().min(0).max(100).default(50),
  status: z.enum(["pending", "done", "deferred"]).default("pending"),
  linkedTaskId: z.string().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
});

export type BacklogItemRow = typeof backlogItemsTable.$inferSelect;
export type BacklogItemInput = z.infer<typeof backlogItemSchema>;
