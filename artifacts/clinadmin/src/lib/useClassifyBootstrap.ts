import { useEffect, useRef } from 'react';
import { useAiComplete } from '@workspace/api-client-react';
import { emails } from './data';
import {
  useAiClassifications,
  setClassification,
  isHydrated,
} from './aiClassifyStore';
import { classifyQueue } from './classifyEmail';

// App-level bootstrap: kicks off AI classification for every inbox email
// exactly once per session, regardless of which tab the user opens first.
// Previously this lived inside InboxTab, which meant tabs that depend on
// classifications (High-Risk, future Home/Forecast etc.) would show empty
// or stale data until the user manually visited the inbox.
//
// IMPORTANT: must wait for the store to hydrate from Postgres before
// deciding what's unclassified. Without this gate, the first render
// sees an empty cache, re-classifies every email, and the resulting
// upserts overwrite persisted classifications (including manual
// overrides via `overrideCategory`). The hook re-runs on every cache
// emit and only fires the classify queue once, after `isHydrated()`
// returns true.
//
// Concurrency limited to 3 so we don't fan out 50+ AI requests at once.
// On per-email failure we store an UNCLEAR fallback so any "Classifying…"
// shimmer resolves and the user can re-classify the affected row later.
export function useClassifyBootstrap(): void {
  const classifications = useAiClassifications();
  const aiComplete = useAiComplete();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!isHydrated()) return;
    startedRef.current = true;
    const unclassified = emails.filter((e) => !classifications.has(e.id));
    if (unclassified.length === 0) return;
    const runPrompt = async (prompt: string) => {
      const res = await aiComplete.mutateAsync({ data: { prompt } });
      return res.text ?? '';
    };
    void classifyQueue(unclassified, runPrompt, (c) => setClassification(c), {
      concurrency: 3,
      onError: (id) => {
        setClassification({
          emailId: id,
          category: 'UNCLEAR',
          priority: 'UNCLEAR',
          confidence: 0,
          reasoning: 'Classification failed — please re-classify.',
          classifiedAt: Date.now(),
          professionalSubType: null,
          patientName: null,
          documentRequested: null,
          eventDate: null,
          registrationDeadline: null,
          documentDirection: null,
          requiresDocument: false,
          documentType: null,
          documentDueDays: null,
        prescriptionRequest: null,
        complexity: null,
        complexityReasons: [],
        });
      },
    });
    // `classifications` is included so this effect re-runs after the
    // initial hydration emit (when `isHydrated()` flips from false to
    // true). `startedRef` prevents the queue from firing more than
    // once. `aiComplete` is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classifications]);
}
