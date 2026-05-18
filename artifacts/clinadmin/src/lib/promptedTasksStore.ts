import { useSyncExternalStore } from 'react';
import {
  listPromptedTasks,
  acceptPromptedTask as apiAcceptPromptedTask,
  dismissPromptedTask as apiDismissPromptedTask,
  setPromptedTaskDoneApi,
} from '@workspace/api-client-react';
import type { PotentialTaskKind } from './potentialTaskDetect';

// Tasks that the clinician explicitly accepted via the inbox
// "Possible task detected" prompt. The fields stored are the
// CLINICIAN'S edited form values (they edit the AI pre-fill before
// saving) — the raw AI suggestion is never persisted.
//
// PERSISTENCE: was localStorage, now Postgres via /api/prompted-tasks.
// Same hydrate-once + fire-and-forget model as deferralStore. The
// dismissed list tracks (emailId, kind) pairs the clinician explicitly
// rejected — those prompts must never reappear for that email.
//
// Storage rule: per the three-bucket rule, this stores the clinician's
// response to each suggestion (accept/dismiss) plus the values they
// approved if they accepted. The pre-edit AI text is never stored.
//
// Implicit-dismiss-on-accept: accepting a suggestion also suppresses
// the prompt for that (email, kind). We don't write a second
// 'dismissed' row — the existence of any row satisfies isPromptDismissed.

export interface PromptedTask {
  id: string;                   // pt_<emailId>_<kind>
  emailId: number;
  kind: PotentialTaskKind;
  title: string;
  type: string;
  estMin: number;
  priority: 'high' | 'medium' | 'low';
  patientName: string | null;
  dueDays: number | null;
  notes: string;
  createdAt: number;
  done: boolean;
  // Prescription metadata — only set for kind='prescription' tasks
  // created via the rich prescription detector.
  controlledDrug?: boolean;
  medicationName?: string | null;
  medicationDose?: string | null;
  travelMentioned?: boolean;
}

interface PromptedState {
  tasks: PromptedTask[];
  dismissed: string[];          // "<emailId>:<kind>" pairs
}

const listeners = new Set<() => void>();
let cache: PromptedState = { tasks: [], dismissed: [] };
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  cache = { tasks: [...cache.tasks], dismissed: [...cache.dismissed] };
  listeners.forEach((l) => l());
}

function key(emailId: number, kind: PotentialTaskKind): string {
  return `${emailId}:${kind}`;
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const state = await listPromptedTasks();
    // Merge: keep any local entries (added before hydration finished)
    // and append server entries not already present.
    const existingIds = new Set(cache.tasks.map((t) => t.id));
    const existingDismissed = new Set(cache.dismissed);
    for (const r of state.tasks) {
      const emailId = Number(r.outlookEmailId);
      if (!Number.isFinite(emailId)) continue;
      if (existingIds.has(r.taskId)) continue;
      // Re-apply the phone-call rule on hydrate. The server enforces
      // it too (see promptedTasks route), but hydrating any legacy /
      // pre-rule row picks up the clamp here as a final safety net.
      cache.tasks.push(applyPhoneCallRule({
        id: r.taskId,
        emailId,
        kind: r.kind as PotentialTaskKind,
        title: r.title,
        type: r.type,
        estMin: r.estMin,
        priority: r.priority,
        patientName: r.patientName ?? null,
        dueDays: r.dueDays ?? null,
        notes: r.notes,
        createdAt: new Date(r.createdAt).getTime(),
        done: r.done,
        controlledDrug: r.controlledDrug ?? undefined,
        medicationName: r.medicationName,
        medicationDose: r.medicationDose,
        travelMentioned: r.travelMentioned ?? undefined,
      }));
    }
    for (const d of state.dismissed) {
      const emailId = Number(d.outlookEmailId);
      if (!Number.isFinite(emailId)) continue;
      const k = key(emailId, d.kind as PotentialTaskKind);
      if (!existingDismissed.has(k)) {
        cache.dismissed.push(k);
      }
    }
    cache.tasks.sort((a, b) => b.createdAt - a.createdAt);
    hydrationDone = true;
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[promptedTasksStore] failed to hydrate from server', err);
    hydrationDone = true;
  }
}

export function dismissPrompt(emailId: number, kind: PotentialTaskKind) {
  const k = key(emailId, kind);
  if (cache.dismissed.includes(k)) return;
  cache.dismissed = [...cache.dismissed, k];
  emit();
  apiDismissPromptedTask({
    outlookEmailId: String(emailId),
    kind,
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[promptedTasksStore] failed to persist dismissal', err);
  });
}

export function isPromptDismissed(emailId: number, kind: PotentialTaskKind): boolean {
  return cache.dismissed.includes(key(emailId, kind));
}

export interface AddPromptedTaskInput {
  emailId: number;
  kind: PotentialTaskKind;
  title: string;
  type: string;
  estMin: number;
  priority: 'high' | 'medium' | 'low';
  patientName: string | null;
  dueDays: number | null;
  notes: string;
  controlledDrug?: boolean;
  medicationName?: string | null;
  medicationDose?: string | null;
  travelMentioned?: boolean;
}

// Phone-call rule: estimated minutes are always 30, regardless of
// what the AI suggested or what the form contained. Even a "quick"
// callback wraps in history-review and a follow-up note, so 30 is
// the realistic minimum the clinician has standardised on.
function applyPhoneCallRule<T extends { kind: PotentialTaskKind; estMin: number }>(t: T): T {
  return t.kind === 'phone_call' ? { ...t, estMin: 30 } : t;
}

export function addPromptedTask(input: AddPromptedTaskInput): PromptedTask | null {
  // Dedupe key is (emailId, kind) — guards against rapid double-click
  // of "Add to my tasks" creating two identical tasks.
  if (hasPromptedTaskForKind(input.emailId, input.kind)) return null;
  const id = `pt_${input.emailId}_${input.kind}_${Date.now().toString(36)}`;
  const task: PromptedTask = applyPhoneCallRule({
    ...input,
    id,
    createdAt: Date.now(),
    done: false,
  });
  // Adding a task implicitly dismisses the prompt for that (email, kind).
  const k = key(input.emailId, input.kind);
  cache.tasks = [task, ...cache.tasks];
  if (!cache.dismissed.includes(k)) {
    cache.dismissed = [...cache.dismissed, k];
  }
  emit();
  // Fire-and-forget POST. Server is idempotent on (clinician, email,
  // kind) and treats accepted as implicitly dismissed too.
  apiAcceptPromptedTask({
    taskId: task.id,
    outlookEmailId: String(task.emailId),
    kind: task.kind,
    title: task.title,
    type: task.type,
    estMin: task.estMin,
    priority: task.priority,
    patientName: task.patientName,
    dueDays: task.dueDays,
    notes: task.notes,
    done: task.done,
    controlledDrug: task.controlledDrug ?? null,
    medicationName: task.medicationName ?? null,
    medicationDose: task.medicationDose ?? null,
    travelMentioned: task.travelMentioned ?? null,
    createdAt: new Date(task.createdAt).toISOString(),
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[promptedTasksStore] failed to persist accepted task', err);
  });
  return task;
}

export function hasPromptedTaskForKind(emailId: number, kind: PotentialTaskKind): boolean {
  return cache.tasks.some((t) => t.emailId === emailId && t.kind === kind);
}

export function getPromptedTasksForEmail(emailId: number): PromptedTask[] {
  return cache.tasks.filter((t) => t.emailId === emailId);
}

function persistDoneById(id: string) {
  const t = cache.tasks.find((x) => x.id === id);
  if (!t) return;
  setPromptedTaskDoneApi({
    outlookEmailId: String(t.emailId),
    kind: t.kind,
    done: t.done,
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[promptedTasksStore] failed to persist done flag', err);
  });
}

export interface UpdatePromptedTaskInput {
  title?: string;
  estMin?: number;
  dueDays?: number | null;
  priority?: 'high' | 'medium' | 'low';
  notes?: string;
}

// Edit an accepted prompted task. Fires a re-POST to /prompted-tasks
// which now upserts on (clinician, email, kind) and updates the
// editable fields server-side. Phone-call estMin is always clamped
// back to 30 here too — the rule applies to any path that mutates
// the task, not just the create path.
export function updatePromptedTask(id: string, patch: UpdatePromptedTaskInput): PromptedTask | null {
  const existing = cache.tasks.find((t) => t.id === id);
  if (!existing) return null;
  const merged = applyPhoneCallRule({
    ...existing,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.estMin !== undefined ? { estMin: Math.max(5, Math.round(patch.estMin)) } : {}),
    ...(patch.dueDays !== undefined ? { dueDays: patch.dueDays } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
  });
  cache.tasks = cache.tasks.map((t) => (t.id === id ? merged : t));
  emit();
  apiAcceptPromptedTask({
    taskId: merged.id,
    outlookEmailId: String(merged.emailId),
    kind: merged.kind,
    title: merged.title,
    type: merged.type,
    estMin: merged.estMin,
    priority: merged.priority,
    patientName: merged.patientName,
    dueDays: merged.dueDays,
    notes: merged.notes,
    done: merged.done,
    controlledDrug: merged.controlledDrug ?? null,
    medicationName: merged.medicationName ?? null,
    medicationDose: merged.medicationDose ?? null,
    travelMentioned: merged.travelMentioned ?? null,
    createdAt: new Date(merged.createdAt).toISOString(),
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[promptedTasksStore] failed to persist task update', err);
  });
  return merged;
}

export function togglePromptedTaskDone(id: string) {
  const idx = cache.tasks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  cache.tasks = cache.tasks.map((t) =>
    t.id === id ? { ...t, done: !t.done } : t,
  );
  emit();
  persistDoneById(id);
}

export function setPromptedTaskDone(id: string, done: boolean) {
  const idx = cache.tasks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  cache.tasks = cache.tasks.map((t) =>
    t.id === id ? { ...t, done } : t,
  );
  emit();
  persistDoneById(id);
}

// "Undo" for an auto-created prompted task. Removes the row from
// the in-memory cache immediately so My tasks updates, and persists
// the removal server-side as a soft-delete (done=true) — the server
// has no DELETE for prompted tasks today, and treating undone-auto
// as "done" keeps a clean audit trail without leaking the row back
// into the active list.
//
// Crucially we KEEP the (emailId, kind) dismissal marker (added by
// addPromptedTask itself), so the auto-creator won't immediately
// re-create the task on the next render pass.
export function removePromptedTask(id: string) {
  const t = cache.tasks.find((x) => x.id === id);
  if (!t) return;
  cache.tasks = cache.tasks.filter((x) => x.id !== id);
  emit();
  setPromptedTaskDoneApi({
    outlookEmailId: String(t.emailId),
    kind: t.kind,
    done: true,
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[promptedTasksStore] failed to persist undo', err);
  });
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

export function usePromptedTasksState(): PromptedState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isHydrated(): boolean {
  return hydrationDone;
}
