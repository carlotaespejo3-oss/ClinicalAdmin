import { useSyncExternalStore } from 'react';
import {
  listSidebarTasks,
  upsertSidebarTask,
  deleteSidebarTask,
} from '@workspace/api-client-react';
import type { SidebarTask } from '@/lib/types';

// Quick-checklist sidebar items.
//
// PERSISTENCE: now Postgres via /api/sidebar-tasks. Hydrate-once +
// fire-and-forget pattern. Each row is keyed on a client-generated
// id ("s<timestamp>") so the UI can update synchronously and the
// POST that follows is idempotent on conflict.
//
// Storage rule: clinician-typed titles only; nothing originates from
// email content.

const seedDefaults: SidebarTask[] = [
  { id: 's2', title: 'Phone callback Dr. Osei re case formulation', estMin: 10, priority: 'high', done: false },
  { id: 's3', title: 'Sign off discharge letter — Thomas Wright', estMin: 10, priority: 'normal', done: false },
];

// One-shot marker so the demo seed tasks are inserted exactly once
// per browser. Without this, a clinician who deletes both seeds and
// then reloads would see them reappear (server returns []  AND local
// cache is [] — the same state as a brand-new install). Persisting
// the marker locally is good enough: the seeds are demo content, not
// data the user expects to flow across devices.
const SEEDED_KEY = 'clinadmin-sidebar-seeded-v1';
function hasSeededBefore(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SEEDED_KEY) === '1';
  } catch {
    return false;
  }
}
function markSeeded(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SEEDED_KEY, '1');
  } catch {
    // ignore — worst case we re-seed on next reload, which is recoverable
  }
}

let cache: SidebarTask[] = [];
let hydrationStarted = false;
let hydrationDone = false;
const listeners = new Set<() => void>();

function emit() {
  // New array reference so useSyncExternalStore sees a changed snapshot.
  cache = [...cache];
  listeners.forEach((l) => l());
}

// Per-task write chain — same reason as the other stores: prevent
// two rapid edits on the same id from being reordered on the wire.
const writeChains = new Map<string, Promise<unknown>>();
function chainWrite(id: string, run: () => Promise<unknown>) {
  const prev = writeChains.get(id) ?? Promise.resolve();
  const next = prev.then(run).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[sidebarTasksStore] persist failed for ${id}`, err);
  });
  writeChains.set(id, next);
}

function persist(t: SidebarTask) {
  chainWrite(t.id, () =>
    upsertSidebarTask(encodeURIComponent(t.id), {
      title: t.title,
      estMin: t.estMin,
      priority: t.priority,
      done: t.done,
    }),
  );
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listSidebarTasks();
    if (rows.length === 0 && cache.length === 0 && !hasSeededBefore()) {
      // Truly first-ever load on this browser: server has nothing,
      // cache has nothing, and the seed marker has never been set.
      // Insert the demo starter tasks, persist them, and flip the
      // marker so a future "delete everything → reload" doesn't
      // resurrect them.
      cache = [...seedDefaults];
      for (const t of seedDefaults) persist(t);
      markSeeded();
    } else {
      // Either we have rows, or the user has already been here and
      // cleared things out. Either way — never reseed.
      if (rows.length > 0) markSeeded();
      // Merge: keep any tasks added locally before hydration finished
      // (dedupe by id), append server rows that aren't already present.
      const existingIds = new Set(cache.map((t) => t.id));
      for (const r of rows) {
        if (existingIds.has(r.id)) continue;
        cache.push({
          id: r.id,
          title: r.title,
          estMin: r.estMin,
          priority: r.priority,
          done: r.done,
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sidebarTasksStore] failed to hydrate', err);
  } finally {
    hydrationDone = true;
    emit();
  }
}

export function addSidebarTaskInternal(
  title: string,
  estMin: number,
  priority: 'high' | 'normal',
): SidebarTask {
  const task: SidebarTask = {
    id: `s${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    estMin,
    priority,
    done: false,
  };
  cache = [...cache, task];
  listeners.forEach((l) => l());
  persist(task);
  return task;
}

export function removeSidebarTaskInternal(id: string): void {
  const had = cache.some((t) => t.id === id);
  if (!had) return;
  cache = cache.filter((t) => t.id !== id);
  listeners.forEach((l) => l());
  chainWrite(id, () => deleteSidebarTask(encodeURIComponent(id)));
}

export function toggleSidebarTaskInternal(id: string): void {
  let updated: SidebarTask | undefined;
  cache = cache.map((t) => {
    if (t.id !== id) return t;
    updated = { ...t, done: !t.done };
    return updated;
  });
  if (!updated) return;
  listeners.forEach((l) => l());
  persist(updated);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) void hydrate();
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;

export function useSidebarTasks(): SidebarTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isSidebarHydrated(): boolean {
  return hydrationDone;
}
