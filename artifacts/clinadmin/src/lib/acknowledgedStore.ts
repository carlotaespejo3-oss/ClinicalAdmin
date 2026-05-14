import { useSyncExternalStore } from 'react';
import { clearDeferralsForEmail } from './deferralStore';

const KEY = 'clinadmin-acknowledged-v1';
const listeners = new Set<() => void>();
let cache: Set<number> | null = null;

function load(): Set<number> {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    cache = new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function persist() {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(cache)));
  } catch {
    // ignore quota errors
  }
}

function mutate(fn: (s: Set<number>) => void) {
  const next = new Set(load());
  fn(next);
  cache = next;
  persist();
  listeners.forEach((l) => l());
}

export function acknowledgeEmail(id: number) {
  if (load().has(id)) return;
  mutate((s) => s.add(id));
  // Resolution clears deferral history — see archivedStore for rationale.
  clearDeferralsForEmail(id);
}

export function unacknowledgeEmail(id: number) {
  if (!load().has(id)) return;
  mutate((s) => s.delete(id));
}

export function clearAcknowledged() {
  mutate((s) => s.clear());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();
const getServerSnapshot = () => load();

export function useAcknowledgedEmails(): Set<number> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
