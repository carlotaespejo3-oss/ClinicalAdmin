import { Router } from "express";
import { eq } from "drizzle-orm";
// eq used by GET; SET clause built imperatively below.
import {
  db,
  clinicianSettingsTable,
  upsertClinicianSettingsSchema,
} from "@workspace/db";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

type SettingsColumn =
  | "arrivalsConfig"
  | "styleProfile"
  | "signaturesSettings"
  | "appSettings"
  | "onboardingProfile"
  | "spamSettings";

// GET /api/clinician-settings — single envelope. Returns nulls for
// unset sections so the client can fall back to its built-in
// defaults without needing to special-case "row missing".
router.get("/clinician-settings", async (_req, res) => {
  const rows = await db
    .select()
    .from(clinicianSettingsTable)
    .where(eq(clinicianSettingsTable.clinicianId, DEFAULT_CLINICIAN_ID))
    .limit(1);
  const row = rows[0];
  res.json({
    arrivalsConfig: row?.arrivalsConfig ?? null,
    styleProfile: row?.styleProfile ?? null,
    signaturesSettings: row?.signaturesSettings ?? null,
    appSettings: row?.appSettings ?? null,
    onboardingProfile: row?.onboardingProfile ?? null,
    spamSettings: row?.spamSettings ?? null,
  });
});

// POST /api/clinician-settings — partial patch upsert. Idempotent.
// Sections omitted from the body are preserved; sections set to
// null are explicitly cleared.
//
// Concurrency: we deliberately avoid the read-then-merge pattern
// (SELECT current row, merge in JS, write back) because two
// overlapping requests patching different sections would race —
// each would read the same baseline and then clobber the other's
// write on the way back. Instead, the ON CONFLICT DO UPDATE clause
// only touches the columns named in this request's body. Columns
// the patch doesn't mention are left exactly as they are in the
// row, atomically, by Postgres. The INSERT branch (no row yet)
// supplies nulls for unspecified sections, which is the correct
// "never been set" baseline.
router.post("/clinician-settings", async (req, res) => {
  const parsed = upsertClinicianSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const patch = parsed.data;

  const insertValues: {
    clinicianId: string;
    arrivalsConfig: unknown | null;
    styleProfile: unknown | null;
    signaturesSettings: unknown | null;
    appSettings: unknown | null;
    onboardingProfile: unknown | null;
    spamSettings: unknown | null;
  } = {
    clinicianId: DEFAULT_CLINICIAN_ID,
    arrivalsConfig: patch.arrivalsConfig ?? null,
    styleProfile: patch.styleProfile ?? null,
    signaturesSettings: patch.signaturesSettings ?? null,
    appSettings: patch.appSettings ?? null,
    onboardingProfile: patch.onboardingProfile ?? null,
    spamSettings: patch.spamSettings ?? null,
  };

  // Build a dynamic SET clause containing only the patched columns.
  // Empty patch (no keys present) is a no-op on conflict, but the
  // INSERT may still create a fresh nulls-only row — that matches
  // GET semantics (every section nullable, defaults to null).
  const setClause: Partial<
    Record<SettingsColumn, unknown | null>
  > = {};
  if (Object.prototype.hasOwnProperty.call(patch, "arrivalsConfig")) {
    setClause.arrivalsConfig = patch.arrivalsConfig ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "styleProfile")) {
    setClause.styleProfile = patch.styleProfile ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "signaturesSettings")) {
    setClause.signaturesSettings = patch.signaturesSettings ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "appSettings")) {
    setClause.appSettings = patch.appSettings ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "onboardingProfile")) {
    setClause.onboardingProfile = patch.onboardingProfile ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spamSettings")) {
    setClause.spamSettings = patch.spamSettings ?? null;
  }

  if (Object.keys(setClause).length === 0) {
    // Nothing to patch. Make sure a row exists (GET returns nulls
    // either way) without disturbing existing values.
    await db
      .insert(clinicianSettingsTable)
      .values(insertValues)
      .onConflictDoNothing({ target: clinicianSettingsTable.clinicianId });
  } else {
    await db
      .insert(clinicianSettingsTable)
      .values(insertValues)
      .onConflictDoUpdate({
        target: clinicianSettingsTable.clinicianId,
        set: setClause,
      });
  }
  res.status(204).send();
});

export default router;
