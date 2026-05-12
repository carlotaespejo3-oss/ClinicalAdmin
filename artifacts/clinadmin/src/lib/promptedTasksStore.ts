import { useSyncExternalStore } from 'react';
import type { PotentialTaskKind } from './potentialTaskDetect';

// Tasks that the clinician explicitly accepted via the inbox
// "Possible task detected" prompt. Persisted to localStorage so the
// list survives a refresh, and dedupe-keyed by `${emailId}:${kind}`
// so the same suggestion can never spawn two tasks.
//
// The "dismissedPrompts" set tracks (emailId, kind) pairs the
// clinician explicitly rejected — those prompts must never reappear
// for that email, per spec.

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
}

interface PromptedState {
  tasks: PromptedTask[];
  dismissed: string[];          // "<emailId>:<kind>" pairs
}

const KEY = 'clinadmin-prompted-tasks-v1';
const listeners = new Set<() => void>();
let cache: PromptedState | null = null;

function load(): PromptedState {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    cache = raw ? (JSON.parse(raw) as PromptedState) : { tasks: [], dismissed: [] };
    if (!Array.isArray(cache.tasks)) cache.tasks = [];
    if (!Array.isArray(cache.dismissed)) cache.dismissed = [];
  } catch {
    cache = { tasks: [], dismissed: [] };
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

function mutate(fn: (s: PromptedState) => PromptedState) {
  cache = fn({ ...load(), tasks: [...load().tasks], dismissed: [...load().dismissed] });
  persist();
  listeners.forEach((l) => l());
}

function key(emailId: number, kind: PotentialTaskKind): string {
  return `${emailId}:${kind}`;
}

export function dismissPrompt(emailId: number, kind: PotentialTaskKind) {
  const k = key(emailId, kind);
  if (load().dismissed.includes(k)) return;
  mutate((s) => ({ ...s, dismissed: [...s.dismissed, k] }));
}

export function isPromptDismissed(emailId: number, kind: PotentialTaskKind): boolean {
  return load().dismissed.includes(key(emailId, kind));
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
}

export function addPromptedTask(input: AddPromptedTaskInput): PromptedTask | null {
  // Dedupe key is (emailId, kind) — guards against rapid double-click
  // of "Add to my tasks" creating two identical tasks. The id itself
  // also includes a timestamp suffix so that if the dedupe rule is
  // ever relaxed (e.g. detector starts emitting multiple tasks of the
  // same kind), we don't get id collisions.
  if (hasPromptedTaskForKind(input.emailId, input.kind)) return null;
  const id = `pt_${input.emailId}_${input.kind}_${Date.now().toString(36)}`;
  const task: PromptedTask = {
    ...input,
    id,
    createdAt: Date.now(),
    done: false,
  };
  // Adding a task implicitly dismisses the prompt for that (email, kind).
  mutate((s) => ({
    tasks: [task, ...s.tasks],
    dismissed: s.dismissed.includes(key(input.emailId, input.kind))
      ? s.dismissed
      : [...s.dismissed, key(input.emailId, input.kind)],
  }));
  return task;
}

export function hasPromptedTaskForKind(emailId: number, kind: PotentialTaskKind): boolean {
  return load().tasks.some((t) => t.emailId === emailId && t.kind === kind);
}

export function getPromptedTasksForEmail(emailId: number): PromptedTask[] {
  return load().tasks.filter((t) => t.emailId === emailId);
}

export function togglePromptedTaskDone(id: string) {
  mutate((s) => ({
    ...s,
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
  }));
}

export function setPromptedTaskDone(id: string, done: boolean) {
  mutate((s) => ({
    ...s,
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, done } : t)),
  }));
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();

export function usePromptedTasksState(): PromptedState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
