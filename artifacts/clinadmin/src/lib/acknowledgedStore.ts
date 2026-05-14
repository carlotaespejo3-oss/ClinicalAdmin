import { useSyncExternalStore } from 'react';
import {
  listAcknowledged,
  acknowledgeEmail as apiAcknowledgeEmail,
  unacknowledgeEmail as apiUnacknowledgeEmail,
} from '@workspace/api-client-react';
import { clearDeferralsForEmail } from './deferralStore';

// Tracks emails the clinician has marked "seen, no action needed".
//
// PERSISTENCE: this used to be localStorage. It now lives in Postgres
// via /api/acknowledged so the flag persists across devices. Same
// hydrate-once + fire-and-forget model as deferralStore — see that
// file for the full rationale on cache semantics, error policy, and
// the numeric-vs-string ID coercion at the API boundary.
//
// Storage rule: behavioural flag only. NEVER any email content.

const listeners = new Set<() => void>();
let cache: Set<number> = new Set();
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  cache = new Set(cache);
  listeners.forEach((l) => l());
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const ids = await listAcknowledged();
    // Union with any locally-acknowledged IDs recorded before hydration
    // completed (same reasoning as deferralStore.hydrate()).
    for (const raw of ids) {
      const id = Number(raw);
      if (!Number.isFinite(id)) continue;
      cache.add(id);
    }
    hydrationDone = true;
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[acknowledgedStore] failed to hydrate from server', err);
    hydrationDone = true;
  }
}

export function acknowledgeEmail(id: number) {
  if (cache.has(id)) return;
  cache.add(id);
  emit();
  // Resolution clears deferral history — same rationale as archive/done.
  clearDeferralsForEmail(id);
  apiAcknowledgeEmail({ outlookEmailId: String(id) }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[acknowledgedStore] failed to persist acknowledge', err);
  });
}

export function unacknowledgeEmail(id: number) {
  const had = cache.has(id);
  if (had) {
    cache.delete(id);
    emit();
  }
  // Always attempt the DELETE even if the local cache didn't have it —
  // hydration may not have finished yet.
  // encodeURIComponent because the generated client interpolates path
  // params verbatim (orval default).
  apiUnacknowledgeEmail(encodeURIComponent(String(id))).catch(
    (err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[acknowledgedStore] failed to persist unacknowledge', err);
    },
  );
}

// Test-only / dev-only: wipe local cache. Does NOT touch the server.
export function clearAcknowledged() {
  cache = new Set();
  hydrationStarted = false;
  hydrationDone = false;
  listeners.forEach((l) => l());
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

const getSnapshot = () => cache;
const getServerSnapshot = () => cache;

export function useAcknowledgedEmails(): Set<number> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function isHydrated(): boolean {
  return hydrationDone;
}
