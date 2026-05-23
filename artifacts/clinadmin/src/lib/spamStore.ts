// spamStore.ts
//
// Clinician-managed spam list. Two concepts:
//
//   emailIds       — IDs of emails manually marked as spam. These are
//                    removed from the main inbox and shown in the Spam
//                    folder. Clinician can restore them at any time.
//
//   senderPatterns — Substrings (lowercase). When an incoming email's
//                    "from" field includes one of these patterns, the
//                    email is auto-flagged as spam without the clinician
//                    needing to act on each one. The clinician adds a
//                    pattern by checking "Block all from this sender"
//                    when marking an email as spam.
//
// Persistence: two-layer (localStorage + server) via the same
// fire-and-forget pattern as acknowledgedStore. Server column:
// clinician_settings.spam_settings JSONB.
//
// Storage rule: emailIds are demo IDs. senderPatterns are sender
// substrings — no email body content is ever stored here.

import { useSyncExternalStore } from 'react';
import {
  getClinicianSettings,
  upsertClinicianSettings,
} from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpamState {
  emailIds: Set<number>;
  senderPatterns: string[]; // lowercase substrings
}

interface PersistedSpam {
  emailIds: number[];
  senderPatterns: string[];
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'clinadmin:spam:v1';

function loadFromStorage(): SpamState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { emailIds: new Set(), senderPatterns: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedSpam>;
    return {
      emailIds: new Set((parsed.emailIds ?? []).map(Number).filter(isFinite)),
      senderPatterns: (parsed.senderPatterns ?? []).map(String),
    };
  } catch {
    return { emailIds: new Set(), senderPatterns: [] };
  }
}

function saveToStorage(s: SpamState): void {
  try {
    const p: PersistedSpam = {
      emailIds: [...s.emailIds],
      senderPatterns: s.senderPatterns,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* quota — ignore */ }
}

function persistToServer(s: SpamState): void {
  const p: PersistedSpam = {
    emailIds: [...s.emailIds],
    senderPatterns: s.senderPatterns,
  };
  upsertClinicianSettings(
    { spamSettings: p as unknown as Record<string, unknown> },
  ).catch((err: unknown) => {
    console.warn('[spamStore] server write failed', err);
  });
}

let _state: SpamState = loadFromStorage();
const _listeners = new Set<() => void>();

function emit(): void {
  _state = { ..._state }; // new reference so useSyncExternalStore re-renders
  _listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// Server hydration
// ---------------------------------------------------------------------------

let _hydrationStarted = false;

export function startSpamSync(): void {
  if (_hydrationStarted) return;
  _hydrationStarted = true;

  getClinicianSettings().then((settings) => {
    const remote = settings.spamSettings as Partial<PersistedSpam> | null;
    if (!remote) return;

    const remoteIds = new Set((remote.emailIds ?? []).map(Number).filter(isFinite));
    const remotePatterns = (remote.senderPatterns ?? []).map(String);

    // Union: keep anything the clinician marked locally (might be offline
    // writes that haven't reached server yet) plus everything from server.
    const merged: SpamState = {
      emailIds: new Set([..._state.emailIds, ...remoteIds]),
      senderPatterns: [...new Set([..._state.senderPatterns, ...remotePatterns])],
    };

    _state = merged;
    saveToStorage(_state);
    emit();
  }).catch((err: unknown) => {
    console.warn('[spamStore] server hydration failed — using localStorage', err);
  });
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

const getSnapshot = (): SpamState => _state;

export function useSpamState(): SpamState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Synchronous read for use outside React (e.g. InboxTab filter). */
export function getSpamState(): SpamState { return _state; }

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Mark an email as spam. Optionally block the sender so all future
 * emails from the same sender are auto-flagged.
 */
export function markAsSpam(emailId: number, senderFrom?: string): void {
  const ids = new Set(_state.emailIds);
  ids.add(emailId);
  _state = { ..._state, emailIds: ids };
  saveToStorage(_state);
  persistToServer(_state);
  emit();

  // If a sender string was provided, also add it to the block list
  // (called separately when the clinician checks "block sender").
  if (senderFrom) {
    blockSender(senderFrom);
  }
}

/** Remove an email from the spam list (restore to inbox). */
export function unmarkSpam(emailId: number): void {
  const ids = new Set(_state.emailIds);
  if (!ids.has(emailId)) return;
  ids.delete(emailId);
  _state = { ..._state, emailIds: ids };
  saveToStorage(_state);
  persistToServer(_state);
  emit();
}

/**
 * Add a sender pattern to the block list. The pattern is the
 * sender's "from" string lowercased — future emails whose "from"
 * contains this pattern are auto-classified as spam.
 */
export function blockSender(senderFrom: string): void {
  const pattern = senderFrom.toLowerCase().trim();
  if (!pattern || _state.senderPatterns.includes(pattern)) return;
  _state = { ..._state, senderPatterns: [..._state.senderPatterns, pattern] };
  saveToStorage(_state);
  persistToServer(_state);
  emit();
}

/** Remove a sender pattern from the block list. */
export function unblockSender(pattern: string): void {
  const next = _state.senderPatterns.filter((p) => p !== pattern);
  if (next.length === _state.senderPatterns.length) return;
  _state = { ..._state, senderPatterns: next };
  saveToStorage(_state);
  persistToServer(_state);
  emit();
}

/**
 * Returns true if an email is in the spam list OR its sender matches
 * a blocked pattern. Used by the inbox filter.
 */
export function isSpam(emailId: number, senderFrom: string): boolean {
  if (_state.emailIds.has(emailId)) return true;
  const lower = senderFrom.toLowerCase();
  return _state.senderPatterns.some((p) => lower.includes(p));
}
