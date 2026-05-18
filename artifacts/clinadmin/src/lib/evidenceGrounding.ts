// =============================================================================
// Build the evidence snapshot + live grounding block for a CLINICAL draft.
// =============================================================================
//
// Called from the CLINICAL single-slot path in InboxTab before the AI is
// invoked. Two outputs:
//
//   - snapshot:       frozen [{tier, sourceName, title, year, url, flag,
//                     flagText}] for the audit row. Stable regardless of
//                     fetch outcomes.
//   - groundingBlock: a plain-text section to append to the AI prompt.
//                     Contains the live-fetched content from each cited
//                     source that returned successfully, plus a metadata-
//                     only note for sources that didn't (publicly_
//                     accessible=false, fetch_failed, redirect_blocked,
//                     etc).
//
// Tier hierarchy is respected at fetch ordering: AU (T2/T3) sources are
// fetched first; international (T4) only after, and only if AU coverage
// was thin (no AU source returned content). Fetches run in parallel
// within each tier band so we don't pay a serial round-trip cost.
//
// Failure handling: a failed or refused fetch is NOT an error. The AI
// proceeds on metadata only; the EvidenceBlock UI surfaces a "source not
// verified live this session" pill (separate UI work, Stage 4 T005).
// =============================================================================

import type { EvidenceSnapshotEntry } from "@workspace/api-zod";
import { fetchEvidence } from "@workspace/api-client-react";
import type { EvidenceBlock } from "./evidence";
import type { SourceRecord } from "./evidenceStore";

export interface FetchOutcome {
  sourceId: number;
  fetched: boolean;
  content: string | null;
  reason: string | null;
}

// Reverse-lookup SourceRecord by URL — citations resolved by the store
// drop the sourceId, so we re-attach it here by URL match (each source
// row has a unique registered URL). Citations whose URL doesn't match
// any registered source are dropped; they can't be fetched or audited.
function reverseIndexByUrl(
  sources: Map<number, SourceRecord>,
): Map<string, SourceRecord> {
  const out = new Map<string, SourceRecord>();
  for (const s of sources.values()) out.set(s.url, s);
  return out;
}

export function buildEvidenceSnapshot(
  evidence: EvidenceBlock,
  sources: Map<number, SourceRecord>,
): EvidenceSnapshotEntry[] {
  const byUrl = reverseIndexByUrl(sources);
  const snapshot: EvidenceSnapshotEntry[] = [];
  for (const c of evidence.citations) {
    if (!c.url) continue; // can't audit without a stable identifier
    const src = byUrl.get(c.url);
    if (!src) continue; // orphan; defence-in-depth
    snapshot.push({
      sourceId: src.id,
      tier: src.tier,
      sourceName: src.sourceName,
      title: src.title,
      year: src.year,
      url: src.url,
      flag: c.flag ?? null,
      flagText: c.flagText ?? null,
    });
  }
  return snapshot;
}

interface TierGroups {
  australian: EvidenceSnapshotEntry[];
  international: EvidenceSnapshotEntry[];
}

function partitionByTier(
  snapshot: EvidenceSnapshotEntry[],
  sources: Map<number, SourceRecord>,
): TierGroups {
  const australian: EvidenceSnapshotEntry[] = [];
  const international: EvidenceSnapshotEntry[] = [];
  for (const entry of snapshot) {
    const src = sources.get(entry.sourceId);
    if (src?.isAustralian) australian.push(entry);
    else international.push(entry);
  }
  return { australian, international };
}

async function fetchOne(entry: EvidenceSnapshotEntry): Promise<FetchOutcome> {
  try {
    const res = await fetchEvidence({
      sourceId: entry.sourceId,
      url: entry.url,
    });
    return {
      sourceId: entry.sourceId,
      fetched: res.fetched,
      content: res.content ?? null,
      reason: res.reason ?? null,
    };
  } catch (err) {
    console.warn("[evidenceGrounding] fetch failed", { sourceId: entry.sourceId, err });
    return { sourceId: entry.sourceId, fetched: false, content: null, reason: "fetch_failed" };
  }
}

export async function fetchEvidenceForGrounding(
  snapshot: EvidenceSnapshotEntry[],
  sources: Map<number, SourceRecord>,
): Promise<FetchOutcome[]> {
  const { australian, international } = partitionByTier(snapshot, sources);

  // AU first, in parallel.
  const auResults = await Promise.all(australian.map(fetchOne));

  // Only fetch international if AU returned no usable content. Tier
  // hierarchy: don't ground the AI on international guidance when an
  // AU source already covered the question.
  const anyAuContent = auResults.some((r) => r.fetched && r.content);
  if (anyAuContent) {
    return auResults.concat(
      international.map((e) => ({
        sourceId: e.sourceId,
        fetched: false,
        content: null,
        reason: "skipped_au_coverage",
      })),
    );
  }
  const intlResults = await Promise.all(international.map(fetchOne));
  return auResults.concat(intlResults);
}

// Cap per-source content so a long guideline page doesn't blow the
// prompt window. Server already caps at ~30k; we further trim to 8k
// per source for grounding context.
const PER_SOURCE_CHARS = 8_000;

export function buildGroundingBlock(
  snapshot: EvidenceSnapshotEntry[],
  outcomes: FetchOutcome[],
): string {
  if (snapshot.length === 0) return "";
  const byId = new Map(outcomes.map((o) => [o.sourceId, o]));
  const lines: string[] = [];
  lines.push("");
  lines.push("--- GROUNDING EVIDENCE (cite only these sources) ---");
  for (const entry of snapshot) {
    const outcome = byId.get(entry.sourceId);
    const header = `[T${entry.tier}] ${entry.sourceName} (${entry.year}) — ${entry.title}`;
    lines.push("");
    lines.push(header);
    lines.push(`URL: ${entry.url}`);
    if (outcome?.fetched && outcome.content) {
      const trimmed =
        outcome.content.length > PER_SOURCE_CHARS
          ? outcome.content.slice(0, PER_SOURCE_CHARS) + " …[truncated]"
          : outcome.content;
      lines.push("Live content:");
      lines.push(trimmed);
    } else {
      const why =
        outcome?.reason === "not_public"
          ? "behind a login/paywall"
          : outcome?.reason === "skipped_au_coverage"
            ? "skipped — Australian source coverage available"
            : outcome?.reason === "redirect_blocked"
              ? "redirected outside the registered domain — not followed"
              : outcome?.reason === "url_mismatch"
                ? "URL did not match the registered source — not fetched"
                : "fetch unavailable this session";
      lines.push(`Live content: not available (${why}). Refer to the source URL directly.`);
    }
  }
  lines.push("");
  lines.push("--- END GROUNDING EVIDENCE ---");
  lines.push("");
  lines.push(
    "When you draft the reply, only cite the sources above. If a source's live content was unavailable, cite it by name + year only and tell the clinician to verify directly. Prefer Australian sources where they cover the question.",
  );
  return lines.join("\n");
}
