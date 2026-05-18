import { useSyncExternalStore } from 'react';
import {
  listEvidenceSources,
  listEmailEvidence,
} from '@workspace/api-client-react';
import type {
  Citation,
  EvidenceBlock,
  EvidenceFlag,
  EvidenceTier,
} from './evidence';

// PERSISTENCE: registry of clinical-guideline POINTERS lives in
// Postgres (evidence_sources + email_evidence). The store hydrates both
// once on the first subscriber and resolves per-email citations into
// the `EvidenceBlock` shape EvidenceBlockView already consumes.
//
// Storage rule: nothing in this store is guideline content. Sources
// carry tier/name/title/year/URL + maintenance metadata; citations
// reference source IDs plus the per-link concordance flag. Stage 3
// will fetch the live guideline from the URL at draft time.

interface SourceRecord {
  id: number;
  tier: number;
  sourceName: string;
  title: string;
  year: number;
  url: string;
  isAustralian: boolean;
  specialty: string | null;
  publiclyAccessible: boolean;
  lastVerifiedUrl: string | null;
}

const listeners = new Set<() => void>();
let sources: Map<number, SourceRecord> = new Map();
let emailEvidence: Map<number, EvidenceBlock> = new Map();
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  // New Map identities so React's snapshot comparison fires.
  sources = new Map(sources);
  emailEvidence = new Map(emailEvidence);
  listeners.forEach((l) => l());
}

function resolveCitation(
  link: { sourceId: number; flag: EvidenceFlag; flagText: string | null },
  registry: Map<number, SourceRecord>,
): Citation | null {
  const s = registry.get(link.sourceId);
  if (!s) return null;
  return {
    tier: s.tier as EvidenceTier,
    sourceName: s.sourceName,
    title: s.title,
    year: s.year,
    url: s.url,
    publiclyAccessible: s.publiclyAccessible,
    flag: link.flag,
    flagText: link.flagText ?? undefined,
  };
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const [sourceRows, evidenceRows] = await Promise.all([
      listEvidenceSources(),
      listEmailEvidence(),
    ]);
    for (const r of sourceRows) {
      sources.set(r.id, {
        id: r.id,
        tier: r.tier,
        sourceName: r.sourceName,
        title: r.title,
        year: r.year,
        url: r.url,
        isAustralian: r.isAustralian,
        specialty: r.specialty ?? null,
        publiclyAccessible: r.publiclyAccessible,
        lastVerifiedUrl: r.lastVerifiedUrl ?? null,
      });
    }
    for (const r of evidenceRows) {
      const id = Number(r.outlookEmailId);
      if (!Number.isFinite(id)) continue;
      const citations: Citation[] = [];
      for (const link of r.citations) {
        const c = resolveCitation(
          {
            sourceId: link.sourceId,
            flag: (link.flag ?? null) as EvidenceFlag,
            flagText: link.flagText ?? null,
          },
          sources,
        );
        if (c) citations.push(c);
      }
      emailEvidence.set(id, {
        prescribingWarning: r.prescribingWarning ?? undefined,
        citations,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[evidenceStore] failed to hydrate from server', err);
  } finally {
    hydrationDone = true;
    emit();
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) {
    void hydrate();
  }
  return () => {
    listeners.delete(l);
  };
}

const getEvidenceSnapshot = () => emailEvidence;
const getSourcesSnapshot = () => sources;

export function useEmailEvidenceMap(): Map<number, EvidenceBlock> {
  return useSyncExternalStore(subscribe, getEvidenceSnapshot, getEvidenceSnapshot);
}

export function useEvidenceSources(): Map<number, SourceRecord> {
  return useSyncExternalStore(subscribe, getSourcesSnapshot, getSourcesSnapshot);
}

// Synchronous accessor for non-hook contexts (e.g. the promptFor gate
// in InboxTab). Returns undefined before hydrate completes — the gate
// treats that as "no evidence yet" which is the safe default.
export function getEvidenceBlockSync(emailId: number): EvidenceBlock | undefined {
  return emailEvidence.get(emailId);
}

export function isEvidenceHydrated(): boolean {
  return hydrationDone;
}
