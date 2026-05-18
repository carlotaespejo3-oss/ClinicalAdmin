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
  titleOverride: string | null;
  deadlineOverride: number | null;
  estMinOverride: number | null;
  hidden: boolean;
}

const EMPTY_OVERRIDE: ManualTaskOverride = {
  done: false,
  note: null,
  titleOverride: null,
  deadlineOverride: null,
  estMinOverride: null,
  hidden: false,
};

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
      overrides.set(r.taskId, {
        done: r.done,
        note: r.note ?? null,
        titleOverride: r.titleOverride ?? null,
        deadlineOverride: r.deadlineOverride ?? null,
        estMinOverride: r.estMinOverride ?? null,
        hidden: r.hidden,
      });
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
  const prev = overrides.get(taskId) ?? EMPTY_OVERRIDE;
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
  const prev = overrides.get(taskId) ?? EMPTY_OVERRIDE;
  overrides.set(taskId, { ...prev, note });
  emit();
  chainWrite(taskId, () =>
    upsertManualTaskOverride(encodeURIComponent(taskId), { note }),
  );
}

// Edit the seed task's user-facing fields. Pass null to clear an override
// back to the seed value. Planner reflection is automatic: the override
// flows through useManualTasksWithOverrides → manualTaskList → planner.
export function setManualTaskFields(
  taskId: string,
  patch: {
    titleOverride?: string | null;
    deadlineOverride?: number | null;
    estMinOverride?: number | null;
  },
): void {
  const prev = overrides.get(taskId) ?? EMPTY_OVERRIDE;
  overrides.set(taskId, {
    ...prev,
    ...(patch.titleOverride !== undefined && {
      titleOverride: patch.titleOverride,
    }),
    ...(patch.deadlineOverride !== undefined && {
      deadlineOverride: patch.deadlineOverride,
    }),
    ...(patch.estMinOverride !== undefined && {
      estMinOverride: patch.estMinOverride,
    }),
  });
  emit();
  chainWrite(taskId, () =>
    upsertManualTaskOverride(encodeURIComponent(taskId), patch),
  );
}

// Soft-delete: removes a seed task from every view. The seed array
// itself is never mutated; clearing the override (via clearManualTaskOverride)
// brings it back.
export function setManualTaskHidden(taskId: string, hidden: boolean): void {
  const prev = overrides.get(taskId) ?? EMPTY_OVERRIDE;
  overrides.set(taskId, { ...prev, hidden });
  emit();
  chainWrite(taskId, () =>
    upsertManualTaskOverride(encodeURIComponent(taskId), { hidden }),
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
  const merged: ManualTask[] = [];
  for (const t of seedManualTasks) {
    const ovr = overrides.get(t.id);
    if (!ovr) {
      merged.push(t);
      continue;
    }
    if (ovr.hidden) continue;
    merged.push({
      ...t,
      done: ovr.done,
      noteAfterEmailDone: ovr.note ?? undefined,
      title: ovr.titleOverride ?? t.title,
      deadline: ovr.deadlineOverride ?? t.deadline,
      estMin: ovr.estMinOverride ?? t.estMin,
    });
  }
  return merged;
}

export function isManualOverridesHydrated(): boolean {
  return hydrationDone;
}
