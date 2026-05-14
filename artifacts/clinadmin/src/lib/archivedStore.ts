import { useSyncExternalStore } from 'react';
import {
  listArchived,
  archiveEmail as apiArchiveEmail,
  unarchiveEmail as apiUnarchiveEmail,
} from '@workspace/api-client-react';
import { clearDeferralsForEmail } from './deferralStore';

export type ArchiveKind = 'acknowledged' | 'done';

export interface ArchiveEntry {
  id: number;
  kind: ArchiveKind;
  at: number; // epoch ms
}

// Tracks which emails are archived (acknowledged-no-action OR done).
//
// PERSISTENCE: this used to be localStorage. It now lives in Postgres
// via /api/archived. Same hydrate-once + fire-and-forget model as
// deferralStore. See that file for the full rationale.
//
// Storage rule: behavioural metadata + reference only. NEVER any
// email content. The legacy localStorage migration that pulled
// orphaned acknowledged-only IDs into the archive has been removed —
// we're starting clean from the database.

const listeners = new Set<() => void>();
let cache: Map<number, ArchiveEntry> = new Map();
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  cache = new Map(cache);
  listeners.forEach((l) => l());
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listArchived();
    for (const r of rows) {
      const id = Number(r.outlookEmailId);
      if (!Number.isFinite(id)) continue;
      // Don't overwrite local entries recorded before hydration finished.
      if (cache.has(id)) continue;
      cache.set(id, {
        id,
        kind: r.kind,
        at: new Date(r.archivedAt).getTime(),
      });
    }
    hydrationDone = true;
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[archivedStore] failed to hydrate from server', err);
    hydrationDone = true;
  }
}

export function archiveEmail(id: number, kind: ArchiveKind) {
  cache.set(id, { id, kind, at: Date.now() });
  emit();
  // Resolution clears any deferral history — the "deferred 2×" warning
  // is meaningful only on active unresolved emails, and a stale record
  // would resurface if the email is ever restored from archive.
  clearDeferralsForEmail(id);
  apiArchiveEmail({ outlookEmailId: String(id), kind }).catch(
    (err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[archivedStore] failed to persist archive', err);
    },
  );
}

export function unarchiveEmail(id: number) {
  const had = cache.has(id);
  if (had) {
    cache.delete(id);
    emit();
  }
  // Always attempt DELETE even if cache miss (hydration may be pending).
  apiUnarchiveEmail(encodeURIComponent(String(id))).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[archivedStore] failed to persist unarchive', err);
  });
}

// Test-only / dev-only: wipe local cache. Does NOT touch the server.
export function clearArchive() {
  cache = new Map();
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

export function useArchivedEmails(): Map<number, ArchiveEntry> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function isHydrated(): boolean {
  return hydrationDone;
}
