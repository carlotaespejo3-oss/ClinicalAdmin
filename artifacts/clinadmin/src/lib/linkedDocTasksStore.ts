import { useSyncExternalStore } from 'react';
import type { AiClassification, Email, ManualTask } from './types';
import { CAT } from './data';

// Runtime-created tasks for emails that the classifier flagged as requiring
// a written document (NDIS report, EHCP letter, medical certificate, court
// report, etc). One task per email, keyed by linkedEmailId.
//
// These tasks are deliberately NOT counted as separate work in the daily/
// weekly plan totals — the email's estMin already covers the combined time
// (20 min normally, 30 for LEGAL). They show up in the Tasks tab and as a
// "linked task" panel inside the email so the clinician knows a document
// is owed.

export interface LinkedDocTask extends ManualTask {
  linkedEmailId: number;
  source: 'document-detection';
  createdAt: number;
}

export function setLinkedDocNote(emailId: number, note: string | null) {
  const t = load().get(emailId);
  if (!t) return;
  mutate((m) => {
    const next = m.get(emailId);
    if (next) m.set(emailId, { ...next, noteAfterEmailDone: note ?? undefined });
  });
}

export function setLinkedDocDone(emailId: number, done: boolean) {
  const t = load().get(emailId);
  if (!t) return;
  mutate((m) => {
    const next = m.get(emailId);
    if (next) m.set(emailId, { ...next, done });
  });
}

const KEY = 'clinadmin-linked-doc-tasks-v1';
const listeners = new Set<() => void>();
let cache: Map<number, LinkedDocTask> | null = null;

function load(): Map<number, LinkedDocTask> {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    const arr = raw ? (JSON.parse(raw) as LinkedDocTask[]) : [];
    cache = new Map(arr.map((t) => [t.linkedEmailId, t]));
  } catch {
    cache = new Map();
  }
  return cache;
}

function persist() {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(cache.values())));
  } catch {
    // ignore quota errors
  }
}

function mutate(fn: (m: Map<number, LinkedDocTask>) => void) {
  const next = new Map(load());
  fn(next);
  cache = next;
  persist();
  listeners.forEach((l) => l());
}

function senderName(from: string): string {
  // "Mrs Davies (SENCO) <a@b>" → "Mrs Davies"
  return from.replace(/<.*?>/g, '').replace(/\(.+?\)/g, '').trim() || from;
}

function categoryToManualCat(category: AiClassification['category']): string {
  if (category === 'PROFESSIONAL') return CAT.PROF;
  if (category === 'LEGAL') return CAT.LEGAL;
  return CAT.UNSAFE; // CLINICAL bucket — closest match in legacy CAT enum
}

function priorityToRisk(priority: AiClassification['priority']): ManualTask['risk'] {
  if (priority === 'URGENT') return 'high';
  if (priority === 'MEDIUM') return 'medium';
  return 'low';
}

export function ensureLinkedDocTask(email: Email, c: AiClassification): LinkedDocTask | null {
  if (!c.requiresDocument) return null;
  const existing = load().get(email.id);
  if (existing) return existing;
  const due = c.documentDueDays ?? 14;
  const minutes = c.category === 'LEGAL' ? 30 : 20;
  const docType = c.documentType ?? c.documentRequested ?? 'Document';
  const patient = c.patientName ? ` — ${c.patientName}` : '';
  const sender = senderName(email.from);
  const task: LinkedDocTask = {
    id: `doc_${email.id}`,
    title: `${docType}${patient} — requested by ${sender}`,
    cat: categoryToManualCat(c.category),
    deadline: due,
    risk: priorityToRisk(c.priority),
    type: docType,
    estMin: minutes,
    linkedEmailId: email.id,
    autoCompleteOnReply: true,
    done: false,
    source: 'document-detection',
    createdAt: Date.now(),
  };
  mutate((m) => m.set(email.id, task));
  return task;
}

// If a re-classification removes the document flag, drop the auto-created
// task so it doesn't linger.
export function removeLinkedDocTaskIfNoLongerRequired(emailId: number, c: AiClassification | undefined) {
  if (!c || c.requiresDocument) return;
  if (!load().has(emailId)) return;
  mutate((m) => m.delete(emailId));
}

export function markLinkedDocTaskDone(emailId: number) {
  const t = load().get(emailId);
  if (!t || t.done) return;
  mutate((m) => {
    const next = m.get(emailId);
    if (next) m.set(emailId, { ...next, done: true });
  });
}

export function toggleLinkedDocTaskDone(emailId: number) {
  const t = load().get(emailId);
  if (!t) return;
  mutate((m) => {
    const next = m.get(emailId);
    if (next) m.set(emailId, { ...next, done: !next.done });
  });
}

export function getLinkedDocTask(emailId: number): LinkedDocTask | undefined {
  return load().get(emailId);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();
const getServerSnapshot = () => load();

export function useLinkedDocTasks(): Map<number, LinkedDocTask> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
