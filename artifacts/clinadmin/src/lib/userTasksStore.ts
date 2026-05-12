import { useSyncExternalStore } from 'react';

// Lightweight store for user-added tasks created from the inbox (currently
// only used for CPD "Add to Tasks" — when the AI extracts an event date /
// registration deadline from a CPD email, the clinician can one-click add a
// task without leaving the email view). Persists to localStorage.

export interface UserTask {
  id: string;
  title: string;
  source: 'cpd' | 'manual';
  emailId?: number;
  eventDate?: string | null;
  registrationDeadline?: string | null;
  createdAt: number;
}

const KEY = 'clinadmin-user-tasks-v1';
const listeners = new Set<() => void>();
let cache: UserTask[] | null = null;

function load(): UserTask[] {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    cache = raw ? (JSON.parse(raw) as UserTask[]) : [];
  } catch {
    cache = [];
  }
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

function mutate(fn: (list: UserTask[]) => UserTask[]) {
  cache = fn([...load()]);
  persist();
  listeners.forEach((l) => l());
}

export function addUserTask(task: Omit<UserTask, 'id' | 'createdAt'>): UserTask | null {
  // Dedupe: if this email already has a task, no-op. Guards against rapid
  // double-clicks of the "Add CPD to tasks" button creating duplicates before
  // the disabled-state re-render lands.
  if (task.emailId !== undefined && load().some((t) => t.emailId === task.emailId)) {
    return null;
  }
  const created: UserTask = {
    ...task,
    id: `ut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  mutate((list) => [created, ...list]);
  return created;
}

export function hasUserTaskForEmail(emailId: number): boolean {
  return load().some((t) => t.emailId === emailId);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();

export function useUserTasks(): UserTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
