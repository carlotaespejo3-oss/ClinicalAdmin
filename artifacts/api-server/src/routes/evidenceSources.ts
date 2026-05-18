import { Router } from "express";
import { asc } from "drizzle-orm";
import { db, evidenceSourcesTable } from "@workspace/db";

const router = Router();

// GET /api/evidence-sources — registry of clinical guideline POINTERS.
// Metadata only (tier, name, title, year, url, AU flag, accessibility,
// last-verified). Guideline content is never stored here; Stage 3
// fetches the live document from the URL at query time.
router.get("/evidence-sources", async (_req, res) => {
  const rows = await db
    .select()
    .from(evidenceSourcesTable)
    .orderBy(asc(evidenceSourcesTable.tier), asc(evidenceSourcesTable.sourceName));
  res.json(
    rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      sourceName: r.sourceName,
      title: r.title,
      year: r.year,
      url: r.url,
      isAustralian: r.isAustralian,
      specialty: r.specialty,
      publiclyAccessible: r.publiclyAccessible,
      lastVerifiedUrl: r.lastVerifiedUrl ? r.lastVerifiedUrl.toISOString() : null,
    })),
  );
});

export default router;
