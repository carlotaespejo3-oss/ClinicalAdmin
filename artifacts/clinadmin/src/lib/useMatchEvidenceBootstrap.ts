import { useEffect, useRef } from 'react';
import { useAiComplete } from '@workspace/api-client-react';
import { emails } from './data';
import {
  useAiClassifications,
  isHydrated as isClassifyHydrated,
} from './aiClassifyStore';
import {
  useEmailEvidenceMap,
  isEvidenceHydrated,
  getMatcherStateSync,
  setEvidence,
  markPending,
  clearPending,
  markNoMatchForSession,
  getRegistrySnapshot,
} from './evidenceStore';
import { matchQueue } from './matchEvidence';
import type { AiClassification } from './types';

// App-level bootstrap for the AI source-matcher. Stage 3 hybrid plan:
// at boot we only match the urgent subset (URGENT_CLINICAL +
// SAFEGUARDING). Routine CLINICAL emails are matched on-demand the
// first time the clinician opens them (see `useEnsureEvidenceMatch`),
// which keeps boot AI fan-out tight and avoids burning prompts on
// emails the clinician may never look at.
//
// Gates: both the classification store AND the evidence store must
// have hydrated from Postgres first. Without this gate, the first
// render sees empty caches, re-asks the AI for every urgent email,
// and the resulting PUTs would overwrite existing rows. The hook
// re-runs on every emit of either store and only fires the queue
// once via `startedRef`.
const URGENT_CATEGORIES = new Set<AiClassification['category']>([
  'URGENT_CLINICAL',
  'SAFEGUARDING',
]);

export function useMatchEvidenceBootstrap(): void {
  const classifications = useAiClassifications();
  // Subscribing to the evidence map ensures this effect re-runs when
  // the evidence store finishes hydrating (the `isEvidenceHydrated()`
  // gate flips from false to true in the same emit that publishes the
  // hydrated map).
  const evidenceMap = useEmailEvidenceMap();
  const aiComplete = useAiComplete();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!isClassifyHydrated()) return;
    if (!isEvidenceHydrated()) return;
    const registry = getRegistrySnapshot();
    if (registry.length === 0) {
      // No registry means nothing to match against. Treat as a no-op
      // session, but DO flip the started flag so we don't loop on
      // every emit.
      startedRef.current = true;
      return;
    }
    const targets = emails.filter((e) => {
      const c = classifications.get(e.id);
      if (!c) return false;
      if (!URGENT_CATEGORIES.has(c.category)) return false;
      // Skip anything we've already matched, already marked as
      // no-match, or that's somehow already pending.
      return getMatcherStateSync(e.id) === 'unmatched';
    });
    if (targets.length === 0) {
      startedRef.current = true;
      return;
    }
    startedRef.current = true;
    // Mark every target as pending up-front so on-demand opens during
    // bootstrap coalesce on the same in-flight match instead of
    // double-firing.
    for (const t of targets) markPending(t.id);
    const runPrompt = async (prompt: string): Promise<string> => {
      const res = await aiComplete.mutateAsync({ data: { prompt } });
      return res.text ?? '';
    };
    void matchQueue(
      targets,
      classifications,
      registry,
      runPrompt,
      (emailId, citations) => {
        clearPending(emailId);
        setEvidence(emailId, citations);
      },
      {
        concurrency: 3,
        onError: (emailId, err) => {
          // eslint-disable-next-line no-console
          console.warn('[matchBootstrap] match failed', emailId, err);
          // Session-only no-match — failure was probably transient
          // (network, malformed response, timeout). We don't want
          // to hammer the AI for the same email this session, but
          // we also don't want to write a permanent no-match
          // marker. Next session's bootstrap retries from scratch.
          markNoMatchForSession(emailId);
        },
      },
    );
    // `classifications` and `evidenceMap` are in deps so this effect
    // re-runs once each store hydrates. `startedRef` prevents the
    // queue from firing more than once. `aiComplete` is stable across
    // renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classifications, evidenceMap]);
}
