import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-email evidence link: which sources from the registry are cited
// when drafting a reply to this email. One row per (clinicianId,
// outlookEmailId) per project convention. The `citations` jsonb is an
// ordered array of {sourceId, flag, flagText} — each entry points to a
// row in evidence_sources and carries the per-link concordance flag.
//
// Storage rule: organisational metadata only. Flag text is the
// clinician's (or AI's, in Stage 3) characterisation of the concordance
// — it is NOT the guideline content itself. No email body is stored.
export interface CitationLink {
  sourceId: number;
  flag: "A" | "B" | "C" | "D" | "tier5" | null;
  flagText: string | null;
}

export const emailEvidenceTable = pgTable(
  "email_evidence",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    prescribingWarning: text("prescribing_warning"),
    citations: jsonb("citations").$type<CitationLink[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clinicianId, t.outlookEmailId] })],
);

export const insertEmailEvidenceSchema = createInsertSchema(emailEvidenceTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type EmailEvidenceRow = typeof emailEvidenceTable.$inferSelect;
export type InsertEmailEvidence = z.infer<typeof insertEmailEvidenceSchema>;
