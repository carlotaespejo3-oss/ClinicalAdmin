import { useSyncExternalStore } from 'react';
import {
  listUserTasks,
  createUserTask as apiCreateUserTask,
  deleteUserTask as apiDeleteUserTask,
} from '@workspace/api-client-react';

// Lightweight store for user-added tasks created from the inbox
// (currently only used for CPD "Add to Tasks" — when the AI extracts
// an event date / registration deadline from a CPD email, the
// clinician can one-click add a task without leaving the email view).
//
// PERSISTENCE: was localStorage, now Postgres via /api/user-tasks.
// Same hydrate-once + fire-and-forget model as deferralStore — see
// that file for the full rationale.
//
// Storage rule: this is the clinician's own organisational data
// (their chosen task title, the dates they care about). The
// outlookEmailId, when present, is a reference back to the source
// email — we never store body text.

export interface UserTask {
  id: string;
  title: string;
  source: 'cpd' | 'manual';
  emailId?: number;
  eventDate?: string | null;
  registrationDeadline?: string | null;
  createdAt: number;
}

const listeners = new Set<() => void>();
let cache: UserTask[] = [];
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  // New array reference so useSyncExternalStore sees a changed snapshot.
  cache = [...cache];
  listeners.forEach((l) => l());
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listUserTasks();
    // Merge: keep any tasks added locally before hydration finished
    // (dedupe by id), append server rows that aren't already present.
    const existingIds = new Set(cache.map((t) => t.id));
    for (const r of rows) {
      if (existingIds.has(r.id)) continue;
      // Server stores outlookEmailId as a string; the in-app planner
      // currently uses numeric seed IDs. Coerce here at the API
      // boundary. Drop when real Outlook IDs replace the seeds.
      const emailId =
        r.outlookEmailId != null ? Number(r.outlookEmailId) : undefined;
      cache.push({
        id: r.id,
        title: r.title,
        source: r.source,
        emailId: emailId != null && Number.isFinite(emailId) ? emailId : undefined,
        eventDate: r.eventDate ?? null,
        registrationDeadline: r.registrationDeadline ?? null,
        createdAt: new Date(r.createdAt).getTime(),
      });
    }
    // Sort by createdAt desc to match original "[created, ...list]"
    cache.sort((a, b) => b.createdAt - a.createdAt);
    hydrationDone = true;
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[userTasksStore] failed to hydrate from server', err);
    hydrationDone = true;
  }
}

export function addUserTask(task: Omit<UserTask, 'id' | 'createdAt'>): UserTask | null {
  // Dedupe: if this email already has a task, no-op. Guards against
  // rapid double-clicks of the "Add CPD to tasks" button creating
  // duplicates before the disabled-state re-render lands.
  if (task.emailId !== undefined && cache.some((t) => t.emailId === task.emailId)) {
    return null;
  }
  const created: UserTask = {
    ...task,
    id: `ut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  cache = [created, ...cache];
  listeners.forEach((l) => l());
  // Fire-and-forget POST. Server is idempotent on `id`, so retries
  // are safe.
  apiCreateUserTask({
    id: created.id,
    outlookEmailId: created.emailId != null ? String(created.emailId) : null,
    title: created.title,
    source: created.source,
    eventDate: created.eventDate ?? null,
    registrationDeadline: created.registrationDeadline ?? null,
    createdAt: new Date(created.createdAt).toISOString(),
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[userTasksStore] failed to persist task', err);
  });
  return created;
}

export function deleteUserTask(id: string): void {
  const had = cache.some((t) => t.id === id);
  if (had) {
    cache = cache.filter((t) => t.id !== id);
    listeners.forEach((l) => l());
  }
  apiDeleteUserTask(encodeURIComponent(id)).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[userTasksStore] failed to delete task', err);
  });
}

export function hasUserTaskForEmail(emailId: number): boolean {
  return cache.some((t) => t.emailId === emailId);
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

export function useUserTasks(): UserTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isHydrated(): boolean {
  return hydrationDone;
}
