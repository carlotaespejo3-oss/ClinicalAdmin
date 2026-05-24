// manualDeferStore.ts
//
// Tracks email IDs the clinician has explicitly deferred for the
// current session ("I acknowledge this breach — I'll deal with it
// next session"). Ephemeral: resets on page reload. No server sync
// needed — deferring is an in-session acknowledgement, not a
// persistent setting.
//
// Effect on the planner: none. The planner continues to schedule the
// item correctly (overdue → earliest available day). What changes is
// only the *alarm* — deferred items no longer show in red in TodaysPlan
// or in the clinical breach strip. They get a calm "deferred" label
// instead so the clinician knows it's been noted.

import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _deferred: Set<number> = new Set();
const _listeners = new Set<() => void>();

function emit(): void {
  _deferred = new Set(_deferred); // new reference → useSyncExternalStore re-renders
  _listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

const getSnapshot = (): Set<number> => _deferred;

export function useDeferredEmails(): Set<number> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Synchronous read for use outside React (e.g. beforeunload handler). */
export function getDeferredEmails(): Set<number> {
  return _deferred;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Mark an email as deferred for this session. */
export function deferEmail(emailId: number): void {
  if (_deferred.has(emailId)) return;
  _deferred = new Set(_deferred);
  _deferred.add(emailId);
  emit();
}

/** Un-defer an email (clinician changes their mind). */
export function undeferEmail(emailId: number): void {
  if (!_deferred.has(emailId)) return;
  _deferred = new Set(_deferred);
  _deferred.delete(emailId);
  emit();
}
