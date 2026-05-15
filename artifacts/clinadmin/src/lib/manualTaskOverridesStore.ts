import { useSyncExternalStore } from 'react';
import {
  listManualTaskOverrides,
  upsertManualTaskOverride,
  deleteManualTaskOverride,
} from '@workspace/api-client-react';
import { manualTasks as seedManualTasks } from '@/lib/data';
import type { ManualTask } from '@/lib/types';

// Per-clinician overrides on the seed ManualTask records.
//
// PERSISTENCE: now Postgres via /api/manual-task-overrides. The
// seed records (m2/m3/m4/m5 in lib/data.ts) ship with the app —
// they describe pre-existing admin work and are deliberately
// static. What the user actually mutates is just two things:
//   - whether they've ticked the task done
//   - an optional kept-open note attached when they choose to
//     keep the task open after the linked email is done
// Storing only the override keeps the seed list editable (we can
// retitle a task, add new ones, drop old ones) without dancing
// around stale rows. Overrides for ids no longer in the seed are
// simply ignored at merge time.
//
// Storage rule: done flag + clinician-authored note. No email
// content of any kind.

export interface ManualTaskOverride {
  done: boolean;
  note: string | null;
}

const overrides = new Map<string, ManualTaskOverride>();
const listeners = new Set<() => void>();
let hydrationStarted = false;
let hydrationDone = false;
// Bumped on every write so useSyncExternalStore sees a new snapshot.
let snapshotToken: object = {};

function emit() {
  snapshotToken = {};
  listeners.forEach((l) => l());
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listManualTaskOverrides();
    for (const r of rows) {
      // Don't clobber overrides set locally before hydration finished —
      // the user's clicks are more recent than the GET.
      if (overrides.has(r.taskId)) continue;
      overrides.set(r.taskId, { done: r.done, note: r.note ?? null });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[manualTaskOverridesStore] failed to hydrate', err);
  } finally {
    hydrationDone = true;
    emit();
  }
}

// Per-task write chain so two rapid edits to the same task can't be
// reordered by the network and overwrite newer state.
const writeChains = new Map<string, Promise<unknown>>();
function chainWrite(taskId: string, run: () => Promise<unknown>) {
  const prev = writeChains.get(taskId) ?? Promise.resolve();
  const next = prev.then(run).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[manualTaskOverridesStore] persist failed for ${taskId}`, err);
  });
  writeChains.set(taskId, next);
}

export function setManualTaskDone(taskId: string, done: boolean): void {
  const prev = overrides.get(taskId) ?? { done: false, note: null };
  // When toggling back to default (done=false, no note) we could DELETE
  // the row, but keeping it is cheaper than a round-trip and lets the
  // server hold updatedAt for diagnostics. Fine either way.
  overrides.set(taskId, { ...prev, done });
  emit();
  chainWrite(taskId, () =>
    upsertManualTaskOverride(encodeURIComponent(taskId), { done }),
  );
}

export function setManualTaskNote(taskId: string, note: string | null): void {
  const prev = overrides.get(taskId) ?? { done: false, note: null };
  overrides.set(taskId, { ...prev, note });
  emit();
  chainWrite(taskId, () =>
    upsertManualTaskOverride(encodeURIComponent(taskId), { note }),
  );
}

export function clearManualTaskOverride(taskId: string): void {
  overrides.delete(taskId);
  emit();
  chainWrite(taskId, () =>
    deleteManualTaskOverride(encodeURIComponent(taskId)),
  );
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) void hydrate();
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => snapshotToken;

// Returns the seed manual tasks merged with the clinician's overrides.
// Tasks the user has ticked done show as done; notes attached via the
// "keep open" prompt show on the task. Untouched tasks pass through
// unchanged.
export function useManualTasksWithOverrides(): ManualTask[] {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return seedManualTasks.map((t) => {
    const ovr = overrides.get(t.id);
    if (!ovr) return t;
    return {
      ...t,
      done: ovr.done,
      noteAfterEmailDone: ovr.note ?? undefined,
    };
  });
}

export function isManualOverridesHydrated(): boolean {
  return hydrationDone;
}
