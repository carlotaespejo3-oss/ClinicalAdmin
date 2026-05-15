import {
  pgTable,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// AI classification of an inbox email — the clinician's
// organisational layer over each message. Mirrors the same
// composite-PK pattern used by archived_emails / acknowledged_emails
// / deferred_emails / linked_doc_tasks: per-clinician, keyed on
// (clinicianId, outlookEmailId).
//
// Storage rule (three-bucket): this is decision metadata, NOT
// correspondence. We persist the category, priority, confidence,
// detector outputs, and AI-generated reasoning text — all of which
// describe how the clinician's system has organised the email, not
// what the email itself says. Subject and body are still fetched
// live from Microsoft Graph at display time.
//
// Caveat on extracted strings: `patientName`, `documentRequested`,
// `documentType` and the prescription detector's `medicationName`/
// `medicationDose` are extracted from the email and stored here so
// that downstream tasks/badges/banners can render without re-running
// the AI on every page load. They drive the clinician's
// organisational layer (task titles, controlled-drug warnings) and
// match the existing localStorage shape — no new content has been
// added during this migration.
export const aiClassificationsTable = pgTable(
  "ai_classifications",
  {
    clinicianId: text("clinician_id").notNull(),
    outlookEmailId: text("outlook_email_id").notNull(),
    category: text("category").notNull(),
    priority: text("priority").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    reasoning: text("reasoning").notNull(),
    classifiedAt: timestamp("classified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    professionalSubType: text("professional_sub_type"),
    patientName: text("patient_name"),
    documentRequested: text("document_requested"),
    eventDate: text("event_date"),
    registrationDeadline: text("registration_deadline"),
    documentDirection: text("document_direction"),
    requiresDocument: boolean("requires_document").notNull().default(false),
    documentType: text("document_type"),
    documentDueDays: integer("document_due_days"),
    // PrescriptionRequest is a structured object (flavour, medication,
    // dose, controlled-drug flag, deadline, evidence) — store as JSONB
    // so we don't have to flatten ten more nullable columns just for
    // the prescription path.
    prescriptionRequest: jsonb("prescription_request").$type<unknown | null>(),
    complexity: text("complexity"),
    // Free-form short reasons surfaced in the UI tooltip; small
    // string list — JSONB keeps the shape symmetrical with the
    // generated TypeScript type.
    complexityReasons: jsonb("complexity_reasons")
      .$type<string[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    primaryKey({ columns: [t.clinicianId, t.outlookEmailId] }),
  ],
);

export const insertAiClassificationSchema = createInsertSchema(
  aiClassificationsTable,
).omit({ classifiedAt: true });

export type AiClassificationRow = typeof aiClassificationsTable.$inferSelect;
export type InsertAiClassification = z.infer<
  typeof insertAiClassificationSchema
>;
