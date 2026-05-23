// quickSessionStore.ts
//
// Ephemeral state for the "quick session" feature. When a clinician
// opens the app on a day they normally don't work, they can opt in to
// an ad-hoc session of a chosen duration. This store tracks:
//
//   session — the active session (null when idle)
//
// The session snapshot captures baseline counts at start so the summary
// modal can report what was handled during the session.
//
// Persistence: intentionally NONE. Sessions are transient — if the page
// refreshes mid-session the session is gone. That's acceptable; no
// work is lost, only the timer context.

import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionSnapshot {
  acknowledgedCount: number;
  archivedCount: number;
  doneTaskCount: number;
}

export interface ActiveSession {
  startedAt: number;     // Date.now() ms
  durationMin: number;   // chosen duration
  dayKey: string;        // YYYY-MM-DD
  dayAbbr: string;       // 'Mon', 'Tue', …
  snapshot: SessionSnapshot;
}

interface QuickSessionState {
  session: ActiveSession | null;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _state: QuickSessionState = { session: null };
const _listeners = new Set<() => void>();

function emit(): void {
  _state = { ..._state };
  _listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

const getSnapshot = (): QuickSessionState => _state;

export function useQuickSession(): QuickSessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Begin a new quick session with `durationMin` minutes. */
export function startSession(
  durationMin: number,
  snapshot: SessionSnapshot,
): void {
  const now = new Date();
  _state = {
    session: {
      startedAt: Date.now(),
      durationMin,
      dayKey: now.toISOString().slice(0, 10),
      dayAbbr: DOW_ABBR[now.getDay()],
      snapshot,
    },
  };
  emit();
}

/**
 * End the current session. Returns the session details (used by the
 * caller to build the summary) and resets state to idle.
 */
export function endSession(): ActiveSession | null {
  const s = _state.session;
  _state = { session: null };
  emit();
  return s;
}
