import { useSyncExternalStore } from 'react';
import {
  listEvidenceSources,
  listEmailEvidence,
  upsertEmailEvidence,
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
//
// STAGE 3 ADDITIONS (AI source-matching):
//   - `setEvidence(emailId, citations)` writes a new evidence record
//     via fire-and-forget PUT. Empty citations are persisted as a
//     no-match marker (aiCheckedNoMatch=true) so the matcher never
//     re-asks for the same email across sessions.
//   - `noMatchSet` is the in-memory mirror of those server rows; the
//     view treats no-match the same as "no row" (renders the existing
//     refusal panel), so we don't pollute `emailEvidence` with empty
//     blocks.
//   - `pendingSet` is transient — the spinner state for on-demand
//     matches triggered from the email-open container.
//   - `getMatcherStateSync(id)` collapses all three into a single
//     accessor for the bootstrap + on-demand triggers.

export interface ServerCitation {
  sourceId: number;
  flag: 'A' | 'B' | 'C' | 'D' | null;
  flagText: null;
}

export interface RegistryItem {
  id: number;
  tier: number;
  sourceName: string;
  title: string;
  year: number;
  isAustralian: boolean;
  specialty: string | null;
}

export interface SourceRecord {
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
let noMatchSet: Set<number> = new Set();
let pendingSet: Set<number> = new Set();
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  // New identities so React's snapshot comparison fires for every
  // observable the hooks return. `noMatchSet` rotates too because
  // ensureMatched callers depend on its current contents via the
  // store hook re-renders.
  sources = new Map(sources);
  emailEvidence = new Map(emailEvidence);
  pendingSet = new Set(pendingSet);
  noMatchSet = new Set(noMatchSet);
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
      // No-match markers (Stage 3): the AI honestly found nothing in
      // the registry. Track in noMatchSet so the matcher won't retry,
      // and DO NOT populate emailEvidence — the view should fall
      // through to the existing "no verified source" panel.
      if (r.aiCheckedNoMatch) {
        noMatchSet.add(id);
        continue;
      }
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
const getPendingSnapshot = () => pendingSet;

export function useEmailEvidenceMap(): Map<number, EvidenceBlock> {
  return useSyncExternalStore(subscribe, getEvidenceSnapshot, getEvidenceSnapshot);
}

export function useEvidenceSources(): Map<number, SourceRecord> {
  return useSyncExternalStore(subscribe, getSourcesSnapshot, getSourcesSnapshot);
}

// Hook for components that need to render a "Looking up evidence…"
// spinner while an on-demand match is in flight.
export function useEvidencePending(): Set<number> {
  return useSyncExternalStore(subscribe, getPendingSnapshot, getPendingSnapshot);
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

// Build the registry payload the matcher prompt embeds. Metadata only
// — no URLs (we don't want the AI to fabricate URL-shaped citations),
// no `publiclyAccessible` (an AI-relevance signal it isn't), no
// `lastVerifiedUrl` (an internal maintenance field).
export function getRegistrySnapshot(): RegistryItem[] {
  return Array.from(sources.values()).map((s) => ({
    id: s.id,
    tier: s.tier,
    sourceName: s.sourceName,
    title: s.title,
    year: s.year,
    isAustralian: s.isAustralian,
    specialty: s.specialty,
  }));
}

export type MatcherState = 'matched' | 'no-match' | 'pending' | 'unmatched';

// Collapses the three sources of truth into a single state the
// bootstrap + on-demand triggers consult before deciding to run.
// `matched` ⇒ there is at least one resolved citation in the cache.
// `no-match` ⇒ the AI already ran (this session OR previously, via
// the persisted aiCheckedNoMatch flag) and found nothing.
// `pending` ⇒ a match is currently in flight.
// `unmatched` ⇒ no record exists yet — eligible for the matcher.
export function getMatcherStateSync(emailId: number): MatcherState {
  if (emailEvidence.has(emailId)) return 'matched';
  if (noMatchSet.has(emailId)) return 'no-match';
  if (pendingSet.has(emailId)) return 'pending';
  return 'unmatched';
}

// Mark an email as in-flight so concurrent open-handlers coalesce on
// the same match instead of firing duplicate AI calls. Returns false
// when the email is already matched, no-match, or pending — callers
// can skip the AI request in that case.
export function markPending(emailId: number): boolean {
  if (
    pendingSet.has(emailId) ||
    emailEvidence.has(emailId) ||
    noMatchSet.has(emailId)
  ) {
    return false;
  }
  pendingSet.add(emailId);
  emit();
  return true;
}

export function clearPending(emailId: number): void {
  if (pendingSet.delete(emailId)) emit();
}

// Session-only no-match marker. Use when the matcher FAILED (network
// error, malformed AI response, timeout) — we want to stop pestering
// the AI for this email in the current session, but we do NOT want
// to persist a permanent no-match record because the failure was
// transient. Next session's bootstrap / re-open will retry.
//
// Contrast with `setEvidence(id, [])` which writes the persistent
// `aiCheckedNoMatch:true` marker (use ONLY when the AI returned an
// honest empty array).
export function markNoMatchForSession(emailId: number): void {
  pendingSet.delete(emailId);
  if (noMatchSet.has(emailId)) {
    emit();
    return;
  }
  noMatchSet.add(emailId);
  emit();
}

// Persist the AI matcher's verdict. Empty citations is a legitimate
// outcome and is written as the no-match marker; non-empty citations
// are resolved against the registry (orphan IDs silently dropped as
// defence-in-depth — the server also enforces this) and written as a
// normal evidence block. Always fire-and-forget; cache update is
// synchronous so the view re-renders immediately.
export function setEvidence(
  emailId: number,
  serverCitations: ServerCitation[],
  prescribingWarning: string | null = null,
): void {
  pendingSet.delete(emailId);
  if (serverCitations.length === 0) {
    noMatchSet.add(emailId);
    emailEvidence.delete(emailId);
    emit();
    upsertEmailEvidence(String(emailId), {
      prescribingWarning,
      citations: [],
      aiCheckedNoMatch: true,
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[evidenceStore] PUT no-match failed', err);
    });
    return;
  }
  const resolved: Citation[] = [];
  const wireCitations: ServerCitation[] = [];
  for (const sc of serverCitations) {
    const c = resolveCitation(
      { sourceId: sc.sourceId, flag: sc.flag, flagText: null },
      sources,
    );
    if (!c) continue;
    resolved.push(c);
    wireCitations.push({ sourceId: sc.sourceId, flag: sc.flag, flagText: null });
  }
  if (wireCitations.length === 0) {
    // Every citation was an orphan after client-side resolution. Treat
    // as no-match rather than risk a 400 from the server's orphan
    // guard with citations.length>0 but all unknown.
    noMatchSet.add(emailId);
    emailEvidence.delete(emailId);
    emit();
    upsertEmailEvidence(String(emailId), {
      prescribingWarning,
      citations: [],
      aiCheckedNoMatch: true,
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[evidenceStore] PUT no-match (post-orphan) failed', err);
    });
    return;
  }
  noMatchSet.delete(emailId);
  emailEvidence.set(emailId, {
    citations: resolved,
    prescribingWarning: prescribingWarning ?? undefined,
  });
  emit();
  upsertEmailEvidence(String(emailId), {
    prescribingWarning,
    citations: wireCitations,
    aiCheckedNoMatch: false,
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[evidenceStore] PUT failed', err);
  });
}

// Test-only / dev-only: wipe local cache + reset hydration flag.
// Mirrors the helper on aiClassifyStore. Not used by UI code.
export function _resetEvidenceStoreForTests(): void {
  sources = new Map();
  emailEvidence = new Map();
  noMatchSet = new Set();
  pendingSet = new Set();
  hydrationStarted = false;
  hydrationDone = false;
}
