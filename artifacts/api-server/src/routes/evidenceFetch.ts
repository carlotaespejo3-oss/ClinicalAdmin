import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, evidenceSourcesTable } from "@workspace/db";
import { FetchEvidenceBody } from "@workspace/api-zod";

const router = Router();

// =============================================================================
// POST /api/evidence-fetch
// =============================================================================
//
// Server-side proxy fetch for registered guideline URLs. Hard allow-list:
// the supplied URL must exactly match evidence_sources.url for the supplied
// sourceId. Sources with publicly_accessible=false are never fetched; the
// client gets reason='not_public' and falls back to metadata-only.
//
// Redirects: handled manually. Cross-domain redirects are blocked
// (reason='redirect_blocked'). At most 3 in-domain hops are followed.
//
// Timeout: 8s.
//
// Cache: in-memory, per-process, 10-minute TTL. Keyed by sourceId. Shared
// across clinicians in the same server process so we don't hammer
// guideline sites when multiple clinicians draft replies on similar
// emails.
// =============================================================================

const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const MAX_CONTENT_CHARS = 30_000;

interface CacheEntry {
  body: string;
  fetchedAt: number;
}
const cache = new Map<number, CacheEntry>();

function extractText(html: string): string {
  // Minimal HTML → text. Strips script/style blocks, then tags, then
  // collapses whitespace. Good enough for Stage 4 — swap for a real
  // parser (jsdom / cheerio) before a clinical pilot.
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const noTags = noScripts.replace(/<[^>]+>/g, " ");
  const decoded = noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_CONTENT_CHARS
    ? collapsed.slice(0, MAX_CONTENT_CHARS)
    : collapsed;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

async function fetchWithManualRedirects(
  startUrl: string,
): Promise<{ ok: true; body: string } | { ok: false; reason: "redirect_blocked" | "fetch_failed" }> {
  let url = startUrl;
  const originalHost = (() => {
    try {
      return new URL(startUrl).host;
    } catch {
      return null;
    }
  })();
  if (!originalHost) return { ok: false, reason: "fetch_failed" };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          // Be a polite citizen: identify ourselves so guideline servers
          // can log / rate-limit appropriately.
          "user-agent": "ClinAdmin-EvidenceFetch/0.1 (+contact: clinadmin)",
          accept: "text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.5",
        },
      });
    } catch {
      return { ok: false, reason: "fetch_failed" };
    }

    // 3xx → manual redirect handling
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, reason: "fetch_failed" };
      const nextUrl = new URL(location, url).toString();
      if (!sameHost(nextUrl, startUrl)) {
        return { ok: false, reason: "redirect_blocked" };
      }
      url = nextUrl;
      continue;
    }

    if (!res.ok) return { ok: false, reason: "fetch_failed" };

    let body: string;
    try {
      body = await res.text();
    } catch {
      return { ok: false, reason: "fetch_failed" };
    }
    return { ok: true, body };
  }
  return { ok: false, reason: "fetch_failed" };
}

router.post("/evidence-fetch", async (req, res) => {
  const parsed = FetchEvidenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { sourceId, url } = parsed.data;

  // Allow-list: the URL must exact-match the registered URL for this
  // source. No fuzzy matching, no normalisation — if the client sent us
  // a URL that isn't on the list, refuse.
  const rows = await db
    .select({
      url: evidenceSourcesTable.url,
      publiclyAccessible: evidenceSourcesTable.publiclyAccessible,
    })
    .from(evidenceSourcesTable)
    .where(eq(evidenceSourcesTable.id, sourceId))
    .limit(1);
  const source = rows[0];
  if (!source) {
    res.json({ fetched: false, reason: "unknown_source", content: null });
    return;
  }
  if (source.url !== url) {
    req.log.warn({ sourceId, requestedUrl: url }, "evidence-fetch URL mismatch");
    res.json({ fetched: false, reason: "url_mismatch", content: null });
    return;
  }
  if (!source.publiclyAccessible) {
    res.json({ fetched: false, reason: "not_public", content: null });
    return;
  }

  // In-memory cache check.
  const now = Date.now();
  const cached = cache.get(sourceId);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    res.json({ fetched: true, reason: null, content: cached.body });
    return;
  }

  const result = await fetchWithManualRedirects(url);
  if (!result.ok) {
    req.log.warn({ sourceId, url, reason: result.reason }, "evidence-fetch failed");
    res.json({ fetched: false, reason: result.reason, content: null });
    return;
  }

  const content = extractText(result.body);
  cache.set(sourceId, { body: content, fetchedAt: now });

  // Fire-and-forget: bump last_verified_url on successful fetch. We
  // don't await this — a failed maintenance write must not block a
  // successful fetch from returning to the client.
  db.update(evidenceSourcesTable)
    .set({ lastVerifiedUrl: new Date(now) })
    .where(eq(evidenceSourcesTable.id, sourceId))
    .catch((err) => req.log.warn({ err, sourceId }, "lastVerifiedUrl update failed"));

  res.json({ fetched: true, reason: null, content });
});

export default router;
