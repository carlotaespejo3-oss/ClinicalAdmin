import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Clinician-defined custom folders — the clinician's own
// organisational layer over their Outlook inbox. Storage rule:
// folder definitions and assignments only, NEVER email content.
// Outlook system folders (Inbox, Sent, Drafts) and any folders the
// clinician has made in Outlook itself live in Outlook and are
// fetched live; they are not stored here.
//
//   id           client-generated 'cf_<base36>_<rand>'.
//   clinician_id per-clinician scope (single-tenant for now).
//   name         clinician-chosen folder name.
//   created_at   insert time (drives sort order alongside name).
export const customFoldersTable = pgTable("custom_folders", {
  id: text("id").primaryKey(),
  clinicianId: text("clinician_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertCustomFolderSchema = createInsertSchema(
  customFoldersTable,
).omit({ createdAt: true });

export type CustomFolderRow = typeof customFoldersTable.$inferSelect;
export type InsertCustomFolder = z.infer<typeof insertCustomFolderSchema>;
