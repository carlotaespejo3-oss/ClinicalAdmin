import { useSyncExternalStore } from 'react';

export type ArchiveKind = 'acknowledged' | 'done';

export interface ArchiveEntry {
  id: number;
  kind: ArchiveKind;
  at: number; // epoch ms
}

const KEY = 'clinadmin-archived-v1';
const listeners = new Set<() => void>();
let cache: Map<number, ArchiveEntry> | null = null;

// Legacy data: before Step 2, "Acknowledge — no action" only wrote into
// `clinadmin-acknowledged-v1`. Those IDs would now be hidden from the inbox
// (because acknowledged.has(id) is true) but invisible in the Archive tab
// (because they're not in archivedStore). One-shot migration on first load
// pulls any orphaned IDs into this store as kind='acknowledged'.
const LEGACY_ACK_KEY = 'clinadmin-acknowledged-v1';
const MIGRATION_KEY = 'clinadmin-archived-v1-migrated';

function migrateLegacyAcknowledged(into: Map<number, ArchiveEntry>) {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(MIGRATION_KEY)) return;
    const raw = window.localStorage.getItem(LEGACY_ACK_KEY);
    if (raw) {
      const ids = JSON.parse(raw) as unknown;
      if (Array.isArray(ids)) {
        const now = Date.now();
        for (const id of ids) {
          if (typeof id === 'number' && !into.has(id)) {
            into.set(id, { id, kind: 'acknowledged', at: now });
          }
        }
      }
    }
    window.localStorage.setItem(MIGRATION_KEY, '1');
  } catch {
    // ignore migration errors
  }
}

function load(): Map<number, ArchiveEntry> {
  if (cache) return cache;
  let map: Map<number, ArchiveEntry>;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    const arr = raw ? (JSON.parse(raw) as ArchiveEntry[]) : [];
    map = new Map(arr.map((e) => [e.id, e]));
  } catch {
    map = new Map();
  }
  migrateLegacyAcknowledged(map);
  cache = map;
  // Persist if migration added anything so it survives a page reload.
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(Array.from(map.values())));
    } catch {
      // ignore quota errors
    }
  }
  return cache;
}

function persist() {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(cache.values())));
  } catch {
    // ignore quota errors
  }
}

function mutate(fn: (m: Map<number, ArchiveEntry>) => void) {
  const next = new Map(load());
  fn(next);
  cache = next;
  persist();
  listeners.forEach((l) => l());
}

export function archiveEmail(id: number, kind: ArchiveKind) {
  mutate((m) => m.set(id, { id, kind, at: Date.now() }));
}

export function unarchiveEmail(id: number) {
  if (!load().has(id)) return;
  mutate((m) => m.delete(id));
}

export function clearArchive() {
  mutate((m) => m.clear());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();
const getServerSnapshot = () => load();

export function useArchivedEmails(): Map<number, ArchiveEntry> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
