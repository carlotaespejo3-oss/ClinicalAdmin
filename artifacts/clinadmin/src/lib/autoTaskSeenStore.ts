import { useSyncExternalStore } from 'react';

// Tracks which auto-created prompted tasks the clinician has
// "seen" — i.e. opened or otherwise interacted with in My tasks.
// Drives the small blue "new" dot. localStorage-only on purpose:
// the seen state is per-device UI noise, not a clinical fact that
// needs to round-trip the server.
//
// Three-bucket rule: this is purely the clinician's "I've looked
// at it" signal — no email content or clinical metadata stored.

const STORAGE_KEY = 'clinadmin:autoTaskSeen:v1';
// Separate provenance set — tracks IDs the auto-creator stamped at
// creation time. The undo strip filters on this so manually
// accepted Tier 1/2 prompted tasks (from the inbox panel) don't
// also get an "Auto-created" strip slapped on them.
const PROVENANCE_KEY = 'clinadmin:autoTaskCreated:v1';

let cache: ReadonlySet<string> = new Set();
let hydrated = false;
let provenance: ReadonlySet<string> = new Set();
let provenanceHydrated = false;
const listeners = new Set<() => void>();

function load(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      cache = new Set(parsed.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // Corrupt localStorage → start fresh; the dot will reappear once
    // but that's acceptable.
  }
}

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache]));
  } catch {
    // Quota / disabled storage → drop silently.
  }
}

function emit(): void {
  cache = new Set(cache); // new reference so useSyncExternalStore reruns
  listeners.forEach((l) => l());
}

export function markAutoTaskSeen(id: string): void {
  load();
  if (cache.has(id)) return;
  const next = new Set(cache);
  next.add(id);
  cache = next;
  persist();
  emit();
}

export function isAutoTaskSeen(id: string): boolean {
  load();
  return cache.has(id);
}

function loadProvenance(): void {
  if (provenanceHydrated) return;
  provenanceHydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(PROVENANCE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      provenance = new Set(parsed.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // Corrupt → start fresh. Worst case: strip won't appear for old
    // auto-created tasks until next creation. Acceptable.
  }
}

function persistProvenance(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROVENANCE_KEY, JSON.stringify([...provenance]));
  } catch {
    // ignore
  }
}

// Called by the auto-creator the moment it asks the store to add a
// prompted task. Persists immediately so a refresh mid-session
// still recognises the row as auto-created.
export function markAutoCreated(id: string): void {
  loadProvenance();
  if (provenance.has(id)) return;
  const next = new Set(provenance);
  next.add(id);
  provenance = next;
  persistProvenance();
  listeners.forEach((l) => l());
}

export function isAutoCreated(id: string): boolean {
  loadProvenance();
  return provenance.has(id);
}

export function useAutoCreatedIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      loadProvenance();
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    () => provenance,
    () => provenance,
  );
}

function subscribe(l: () => void): () => void {
  load();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;

export function useAutoTaskSeenSet(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
