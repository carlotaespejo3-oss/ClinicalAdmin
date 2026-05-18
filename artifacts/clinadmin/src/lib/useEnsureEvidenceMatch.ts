import { useEffect } from 'react';
import { useAiComplete } from '@workspace/api-client-react';
import { emails } from './data';
import {
  getClassification,
  isHydrated as isClassifyHydrated,
} from './aiClassifyStore';
import {
  isEvidenceHydrated,
  getMatcherStateSync,
  getRegistrySnapshot,
  markPending,
  clearPending,
  markNoMatchForSession,
  setEvidence,
} from './evidenceStore';
import { matchEmailEvidence } from './matchEvidence';

// On-demand source-matcher hook. Mounted by the email-open container
// (InboxTab when `selectedEmail` changes, EmailPreviewModal when it
// opens). The hook fires exactly ONE AI call per email per session:
//
//   - Idempotent via the store's pending set — concurrent opens of
//     the same email coalesce on the same in-flight match.
//   - Skipped when state is `matched`, `no-match`, or `pending`.
//   - Restricted to CLINICAL emails. URGENT_CLINICAL and SAFEGUARDING
//     are handled by `useMatchEvidenceBootstrap` so they're already
//     done by the time anyone opens them.
//   - Errors are written as no-match for the session (avoids
//     hammering an unresponsive AI). Next session's bootstrap /
//     re-open will try again.
//
// Pass `null` when no email is open — the effect is a no-op.
export function useEnsureEvidenceMatch(emailId: number | null): void {
  const aiComplete = useAiComplete();
  useEffect(() => {
    if (emailId === null) return;
    if (!isClassifyHydrated()) return;
    if (!isEvidenceHydrated()) return;
    const classification = getClassification(emailId);
    if (!classification) return;
    if (classification.category !== 'CLINICAL') return;
    if (getMatcherStateSync(emailId) !== 'unmatched') return;
    const email = emails.find((e) => e.id === emailId);
    if (!email) return;
    const registry = getRegistrySnapshot();
    if (registry.length === 0) return;
    // markPending returns false if another caller raced ahead.
    if (!markPending(emailId)) return;
    let cancelled = false;
    void (async () => {
      try {
        const runPrompt = async (prompt: string): Promise<string> => {
          const res = await aiComplete.mutateAsync({ data: { prompt } });
          return res.text ?? '';
        };
        const result = await matchEmailEvidence(
          email,
          classification,
          registry,
          runPrompt,
        );
        if (cancelled) {
          clearPending(emailId);
          return;
        }
        if (result === null) {
          // Malformed AI response — treat as a transient failure.
          // Mark no-match for THIS session only so we don't loop on
          // re-open, but skip the persistent PUT so a future session
          // can retry once the model is behaving.
          // eslint-disable-next-line no-console
          console.warn('[ensureMatched] malformed AI response', emailId);
          markNoMatchForSession(emailId);
          return;
        }
        clearPending(emailId);
        setEvidence(emailId, result);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ensureMatched] match failed', emailId, err);
        // Session-only no-match — see comment above for rationale.
        markNoMatchForSession(emailId);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `aiComplete` is stable across renders; we only want to fire on
    // emailId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId]);
}
