import { pgTable, text, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Clinician-wide configuration: a single row per clinician holding
// three independent settings blobs. JSONB-per-section was chosen
// over key/value because each blob is read together, written
// together, and shaped differently — flattening into many columns
// would just leak structure that the consumers already model.
//
// Three-bucket rule: every field below is the clinician's own
// organisational layer (planner inputs, prompt-tuning text,
// outgoing-reply sign-offs the clinician authored). None of it is
// correspondence — no email body or sender content is ever stored
// here. Sections are nullable so a fresh clinician simply has no
// row, and every reader has a sensible default.
export const clinicianSettingsTable = pgTable("clinician_settings", {
  clinicianId: text("clinician_id").primaryKey(),
  // ArrivalConfig (planner.ts) — emailsPerWeek, highPerWeek,
  // mediumPerWeek, urgentDailyReserveMin, mediumWeeklyReserveMin.
  arrivalsConfig: jsonb("arrivals_config").$type<unknown | null>(),
  // StyleProfile (styleProfile.ts) — overall voice + per-recipient
  // greeting/tone/sign-off/keyPhrases + builtAt timestamp.
  styleProfile: jsonb("style_profile").$type<unknown | null>(),
  // SignaturesSettings — { default: string, perRecipient: Partial<Record<RecipientType, string>> }.
  // The clinician's own sign-off text used to seed AI-drafted
  // replies. It is metadata about how the clinician signs mail,
  // not the content of any specific message.
  signaturesSettings: jsonb("signatures_settings").$type<unknown | null>(),
  // AppSettings — { profile, weeklyDefaults, notifications }.
  // Personal/identity (name, role, work email, service), planner
  // defaults (admin hours/week, admin days, session length), and
  // notification preferences. All cross-device by nature; bundled
  // because they're written together from a single Settings page
  // and previously lived under one localStorage key.
  appSettings: jsonb("app_settings").$type<unknown | null>(),
  // OnboardingProfile — collected during the first-run wizard.
  // Stores: displayName, role, specialty, setting, criticalKeywords,
  // deadlines, adminTimeBlocks, defaultReplyTone, signatures,
  // coverContact, onboardingComplete, onboardingStep.
  // Nullable — null means the wizard has never been completed.
  // Cross-device by nature: the same clinician must not see the
  // wizard again on a second device.
  onboardingProfile: jsonb("onboarding_profile").$type<unknown | null>(),
});

export type ClinicianSettingsRow = typeof clinicianSettingsTable.$inferSelect;

// Section schemas — kept loose (passthrough) on the wire so the
// client owns the inner shape. The DB column types match. The
// outer envelope schema is what the route validates.
const ArrivalsConfigSchema = z
  .object({
    emailsPerWeek: z.number(),
    highPerWeek: z.number(),
    mediumPerWeek: z.number(),
    urgentDailyReserveMin: z.number(),
    mediumWeeklyReserveMin: z.number(),
  })
  .passthrough();

const StyleProfileSectionSchema = z
  .object({
    greeting: z.string(),
    tone: z.string(),
    signOff: z.string(),
    keyPhrases: z.string(),
  })
  .passthrough();

const StyleProfileSchema = z
  .object({
    overall: z.string(),
    sections: z.record(z.string(), StyleProfileSectionSchema),
    builtAt: z.number(),
  })
  .passthrough();

const SignaturesSettingsSchema = z
  .object({
    default: z.string(),
    perRecipient: z.record(z.string(), z.string()),
  })
  .passthrough();

// AppSettings — kept loose like the others; the client owns the
// inner shape (profile / weeklyDefaults / notifications). Each
// inner field passthrough'd so additive changes don't require a
// schema rev.
const AppSettingsSchema = z
  .object({
    profile: z.record(z.string(), z.unknown()).optional(),
    weeklyDefaults: z.record(z.string(), z.unknown()).optional(),
    notifications: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// Loose passthrough for onboardingProfile — the client owns the
// inner shape (UserProfile from userProfileStore). We validate only
// that it's an object; richer checks live in the frontend store.
const OnboardingProfileSchema = z.record(z.string(), z.unknown()).passthrough();

// Patch envelope: every section is independently optional. `null`
// explicitly clears a section; `undefined` (omitted) leaves it
// alone. Keeping the two distinct lets the UI "reset" arrivals
// without touching the style profile.
export const upsertClinicianSettingsSchema = z.object({
  arrivalsConfig: ArrivalsConfigSchema.nullable().optional(),
  styleProfile: StyleProfileSchema.nullable().optional(),
  signaturesSettings: SignaturesSettingsSchema.nullable().optional(),
  appSettings: AppSettingsSchema.nullable().optional(),
  onboardingProfile: OnboardingProfileSchema.nullable().optional(),
});

export type UpsertClinicianSettings = z.infer<
  typeof upsertClinicianSettingsSchema
>;
