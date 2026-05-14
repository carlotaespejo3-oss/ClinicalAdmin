import { useSyncExternalStore } from 'react';
import {
  listDeferrals,
  recordDeferrals,
  deleteDeferral,
} from '@workspace/api-client-react';

// Tracks which emails have been deferred from past planning windows
// (i.e. items the planner couldn't fit into a previous week's runway).
//
// PERSISTENCE: this used to be localStorage. It now lives in Postgres
// via /api/deferrals so the warning persists across devices and survives
// a browser clear — a clinician switching from desk to laptop must still
// see "deferred 2×" on a slipping email.
//
// CACHE MODEL: a single in-memory Map<emailId, DeferralRecord> backs
// `useDeferralHistory()`. On first subscription we hydrate from the
// server with a one-shot `listDeferrals()` and emit when it resolves.
// Mutations (record / clear) update the local cache synchronously so
// the UI is instant, then fire-and-forget the server call. We accept
// that a network failure leaves local and server briefly out of sync;
// the next page load reconciles. We deliberately do NOT show the user
// a toast for these failures — the deferral warning is advisory, not
// safety-critical, and a banner every time a flaky network hiccupped
// would be far more annoying than helpful.
//
// IDEMPOTENCY: granularity is per ISO-week (Monday). Refreshing the
// page mid-week must NOT inflate counts. Both the local cache and the
// server route enforce "skip if (emailId, weekMonday) already present".

const listeners = new Set<() => void>();

export interface DeferralRecord {
  emailId: number;
  weeksDeferred: string[]; // ISO date strings of Mondays, ascending
}

let cache: Map<number, DeferralRecord> = new Map();
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  // Allocate a new Map reference so useSyncExternalStore sees a
  // changed snapshot — React bails out otherwise.
  cache = new Map(cache);
  listeners.forEach((l) => l());
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listDeferrals();
    // Merge server rows into the local cache. Local entries that the
    // user just recorded but haven't been confirmed by the server yet
    // win on key collision — server rows simply backfill missing keys.
    for (const r of rows) {
      if (!cache.has(r.emailId)) {
        cache.set(r.emailId, {
          emailId: r.emailId,
          weeksDeferred: r.weeksDeferred,
        });
      }
    }
    hydrationDone = true;
    emit();
  } catch (err) {
    // Surface to the dev console but don't throw — planner falls back
    // to "no prior deferrals known" which is the safe default.
    // eslint-disable-next-line no-console
    console.warn('[deferralStore] failed to hydrate from server', err);
    hydrationDone = true;
  }
}

// Returns the Monday-of-this-week as an ISO date string (YYYY-MM-DD).
// Uses local-time date components so two runs on the same calendar
// week always agree, regardless of UTC offset.
export function isoMondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0=Sun, 1=Mon, ..., 6=Sat. Want offset to Monday.
  const dow = d.getDay();
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offsetToMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Idempotent: recording the same emailId for the same Monday twice
// adds only one entry. Counts only ever increase across distinct weeks.
// Local cache updates synchronously; the server POST is fire-and-forget.
export function recordDeferralsForWeek(
  emailIds: number[],
  weekMondayISO: string,
): void {
  if (emailIds.length === 0) return;
  let changed = false;
  const idsToPersist: number[] = [];
  for (const id of emailIds) {
    const existing = cache.get(id);
    if (!existing) {
      cache.set(id, { emailId: id, weeksDeferred: [weekMondayISO] });
      changed = true;
      idsToPersist.push(id);
    } else if (!existing.weeksDeferred.includes(weekMondayISO)) {
      existing.weeksDeferred.push(weekMondayISO);
      changed = true;
      idsToPersist.push(id);
    }
  }
  if (changed) emit();
  if (idsToPersist.length > 0) {
    recordDeferrals({ emailIds: idsToPersist, weekMonday: weekMondayISO }).catch(
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[deferralStore] failed to persist deferrals', err);
      },
    );
  }
}

// Drop history for an email when it's archived/acknowledged/done — the
// deferral warning is meaningful only on active unresolved emails. Local
// cache updates synchronously; server DELETE is fire-and-forget. Safe
// to call when there is no record (no-op locally, server returns 204).
export function clearDeferralsForEmail(id: number): void {
  const had = cache.has(id);
  if (had) {
    cache.delete(id);
    emit();
  }
  // Always attempt the DELETE — the local cache may be empty simply
  // because hydration hasn't finished yet, but a server-side row could
  // still exist that needs removing.
  deleteDeferral(id).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[deferralStore] failed to delete deferral history', err);
  });
}

// Test-only / dev-only: wipe local cache. Does NOT touch the server.
// Production code paths should use clearDeferralsForEmail per resolution.
export function clearAllDeferrals(): void {
  cache = new Map();
  hydrationStarted = false;
  hydrationDone = false;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  // Trigger one-shot hydration on the first subscriber. Subsequent
  // subscribers get the cached value immediately.
  if (!hydrationStarted) {
    void hydrate();
  }
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;
const getServerSnapshot = () => cache;

export function useDeferralHistory(): Map<number, DeferralRecord> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Exposed for tests + diagnostics. True once the initial /api/deferrals
// fetch has settled (success OR failure). Planner consumers don't need
// this — they treat an empty Map as "no prior deferrals" which is safe.
export function isHydrated(): boolean {
  return hydrationDone;
}

// Convenience selector for the planner: a count of how many PRIOR
// planning windows the email was deferred in, excluding the current
// week. The current week is excluded because usePlannerOutput records
// today's deferredItems immediately on render; without exclusion,
// an email transiently unplaced (e.g. before the user adds capacity)
// would re-appear as "Deferred 1×" the instant it got scheduled in
// the same week — a false signal. Only weeks STRICTLY before
// currentWeekMondayISO count as "from a previous planning window".
export function deferralCountMap(
  history: Map<number, DeferralRecord>,
  currentWeekMondayISO: string,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, rec] of history) {
    let prior = 0;
    for (const w of rec.weeksDeferred) {
      if (w < currentWeekMondayISO) prior++;
    }
    if (prior > 0) out.set(id, prior);
  }
  return out;
}
