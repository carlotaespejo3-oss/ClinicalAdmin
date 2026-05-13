import { useSyncExternalStore } from 'react';
import { DEFAULT_ARRIVAL_CONFIG, type ArrivalConfig } from './planner';

const KEY = 'clinadmin-arrivals-config-v1';
const listeners = new Set<() => void>();
let cache: ArrivalConfig | null = null;

function load(): ArrivalConfig {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ArrivalConfig>;
      cache = { ...DEFAULT_ARRIVAL_CONFIG, ...parsed };
      return cache;
    }
  } catch {
    // ignore
  }
  cache = { ...DEFAULT_ARRIVAL_CONFIG };
  return cache;
}

function persist() {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

export function setArrivalsConfig(next: ArrivalConfig) {
  cache = { ...next };
  persist();
  listeners.forEach((l) => l());
}

export function resetArrivalsConfig() {
  cache = { ...DEFAULT_ARRIVAL_CONFIG };
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();
const getServerSnapshot = () => load();

export function useArrivalsConfig(): ArrivalConfig {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
