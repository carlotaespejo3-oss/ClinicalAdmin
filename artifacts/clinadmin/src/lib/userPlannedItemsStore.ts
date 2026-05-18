import { useSyncExternalStore } from 'react';

// In-memory store for items the clinician adds manually from the
// "Week ahead" overview on Home:
//
//   - **userTask**: a plannable task with a title, estimate, and
//     target date. Flows into the planner like any other task — it
//     gets scheduled within its deadline window and competes for
//     bookable time with emails and existing manual tasks.
//
//   - **userEvent**: a fixed-time commitment (clinic, meeting, school
//     visit, supervision). Pinned to a specific date and duration.
//     The planner does NOT reschedule events — instead, their minutes
//     are subtracted from that day's available admin time BEFORE
//     packing, and they are injected into the runway day as
//     read-only items.
//
// Both kinds appear in:
//   - the mini workload calendar on Home
//   - the full Calendar tab
//   - the new "Week ahead" overview on Home (where they're created)
//
// PERSISTENCE: in-memory only for now. Mirrors the pre-database era
// of the other manual stores. When this graduates to real persistence
// it should follow the userTasksStore pattern (hydrate-once +
// fire-and-forget POST/DELETE).
//
// STORAGE-RULE NOTE: only the clinician's own organisational metadata
// lives here (title, date, duration, optional notes). No email body
// content. Events that originated from an Outlook calendar entry
// would later reference the Outlook event ID, never duplicate body.

export interface UserPlannedTask {
  kind: 'task';
  id: string;
  title: string;
  date: string; // YYYY-MM-DD, local
  estMin: number;
  createdAt: number;
}

export interface UserPlannedEvent {
  kind: 'event';
  id: string;
  title: string;
  date: string; // YYYY-MM-DD, local
  startTime: string | null; // 'HH:MM' 24h, optional
  durationMin: number;
  notes: string | null;
  createdAt: number;
}

export type UserPlannedItem = UserPlannedTask | UserPlannedEvent;

const listeners = new Set<() => void>();
let cache: UserPlannedItem[] = [];

function emit() {
  cache = [...cache];
  listeners.forEach((l) => l());
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function addUserPlannedTask(input: {
  title: string;
  date: string;
  estMin: number;
}): UserPlannedTask {
  const item: UserPlannedTask = {
    kind: 'task',
    id: genId('upt'),
    title: input.title.trim(),
    date: input.date,
    estMin: Math.max(5, Math.round(input.estMin)),
    createdAt: Date.now(),
  };
  cache = [item, ...cache];
  emit();
  return item;
}

export function addUserPlannedEvent(input: {
  title: string;
  date: string;
  startTime?: string | null;
  durationMin: number;
  notes?: string | null;
}): UserPlannedEvent {
  const item: UserPlannedEvent = {
    kind: 'event',
    id: genId('upe'),
    title: input.title.trim(),
    date: input.date,
    startTime: input.startTime?.trim() || null,
    durationMin: Math.max(5, Math.round(input.durationMin)),
    notes: input.notes?.trim() || null,
    createdAt: Date.now(),
  };
  cache = [item, ...cache];
  emit();
  return item;
}

export function deleteUserPlannedItem(id: string): void {
  const next = cache.filter((it) => it.id !== id);
  if (next.length === cache.length) return;
  cache = next;
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;

export function useUserPlannedItems(): UserPlannedItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
