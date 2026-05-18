import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Registry of clinical guideline POINTERS (not content). Stores tier,
// source name, title, year, URL and maintenance metadata so the Stage 3
// AI step can fetch the live document at query time. Nothing about the
// guideline body is stored here — guidelines change without notice and
// any cached version would create medico-legal exposure.
//
// Storage rule: pure organisational metadata + a public URL. No
// clinical content, no email content, no patient data.
export const evidenceSourcesTable = pgTable("evidence_sources", {
  id: serial("id").primaryKey(),
  tier: integer("tier").notNull(),
  sourceName: text("source_name").notNull(),
  title: text("title").notNull(),
  year: integer("year").notNull(),
  url: text("url").notNull(),
  isAustralian: boolean("is_australian").notNull(),
  specialty: text("specialty"),
  // False when the document sits behind a paywall, login wall or is not
  // machine-readable (e.g. some RANZCP/RANZCOG PDFs). Stage 3 falls back
  // to a metadata-only citation with a "refer to source directly" note.
  publiclyAccessible: boolean("publicly_accessible").notNull().default(true),
  // Date we last confirmed the URL resolves. Maintenance signal for link rot.
  lastVerifiedUrl: timestamp("last_verified_url", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEvidenceSourceSchema = createInsertSchema(evidenceSourcesTable).omit({
  id: true,
  createdAt: true,
});

export type EvidenceSourceRow = typeof evidenceSourcesTable.$inferSelect;
export type InsertEvidenceSource = z.infer<typeof insertEvidenceSourceSchema>;
