import { useSyncExternalStore } from 'react';
import {
  listLinkedDocTasks,
  upsertLinkedDocTask as apiUpsertLinkedDocTask,
  deleteLinkedDocTask as apiDeleteLinkedDocTask,
} from '@workspace/api-client-react';
import type { AiClassification, Email, ManualTask } from './types';
import { CAT } from './data';

// Runtime-created tasks for emails that the classifier flagged as
// requiring a written document (NDIS report, EHCP letter, medical
// certificate, court report, etc). One task per email, keyed by
// linkedEmailId.
//
// PERSISTENCE: was localStorage, now Postgres via /api/linked-doc-tasks.
// Same hydrate-once + fire-and-forget model as deferralStore. Mutations
// (toggle done, edit note) re-POST the whole row — the server upserts.
//
// Storage rule: the title is a short organisational label
// ("EHCP Letter — Jamie B — requested by Mrs Davies"); we treat
// document type and patient identifier as task labels, not as email
// body text. The clinician's note (noteAfterEmailDone) is their own.
//
// These tasks are deliberately NOT counted as separate work in the
// daily/weekly plan totals — the email's estMin already covers the
// combined time (20 min normally, 30 for LEGAL). They show up in the
// Tasks tab and as a "linked task" panel inside the email so the
// clinician knows a document is owed.

export interface LinkedDocTask extends ManualTask {
  linkedEmailId: number;
  source: 'document-detection';
  createdAt: number;
}

const listeners = new Set<() => void>();
let cache: Map<number, LinkedDocTask> = new Map();
let hydrationStarted = false;
let hydrationDone = false;
// Auto-creates from `ensureLinkedDocTask` that fired before hydrate
// completed. We can't POST these immediately — the server uses a
// full-row upsert, so a default `done:false, note:null` payload
// would clobber any existing server row's done/note state. Instead
// we hold them here and let hydrate decide:
//   - if a server row landed for this id, server wins (placeholder
//     dropped, no POST)
//   - if no server row exists, POST the placeholder so genuinely
//     new entries reach the DB.
const pendingCreates = new Set<number>();

function emit() {
  cache = new Map(cache);
  listeners.forEach((l) => l());
}

function persist(t: LinkedDocTask): void {
  apiUpsertLinkedDocTask({
    outlookEmailId: String(t.linkedEmailId),
    title: t.title,
    cat: t.cat,
    type: t.type,
    deadline: t.deadline,
    // ManualTask.risk includes 'none' (legacy hand-coded fallback);
    // linked-doc tasks always come from priorityToRisk which never
    // emits 'none'. Coerce defensively at the API boundary.
    risk: t.risk === 'none' ? 'low' : t.risk,
    estMin: t.estMin,
    autoCompleteOnReply: t.autoCompleteOnReply ?? true,
    done: t.done ?? false,
    noteAfterEmailDone: t.noteAfterEmailDone ?? null,
    createdAt: new Date(t.createdAt).toISOString(),
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[linkedDocTasksStore] failed to persist task', err);
  });
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listLinkedDocTasks();
    // Server-wins merge: server rows overwrite any pre-hydrate local
    // placeholder for the same key. Placeholders for keys NOT in the
    // server response remain (they're genuinely new entries).
    const serverIds = new Set<number>();
    for (const r of rows) {
      const id = Number(r.outlookEmailId);
      if (!Number.isFinite(id)) continue;
      serverIds.add(id);
      cache.set(id, {
        id: `doc_${id}`,
        title: r.title,
        cat: r.cat,
        deadline: r.deadline,
        risk: r.risk,
        type: r.type,
        estMin: r.estMin,
        linkedEmailId: id,
        autoCompleteOnReply: r.autoCompleteOnReply,
        done: r.done,
        noteAfterEmailDone: r.noteAfterEmailDone ?? undefined,
        source: 'document-detection',
        createdAt: new Date(r.createdAt).getTime(),
      });
    }
    hydrationDone = true;
    emit();
    // Drain pending creates: for any pre-hydrate placeholder whose id
    // didn't come back from the server, persist it now. For any whose
    // id DID come back, the server row already overwrote the
    // placeholder above — drop without POST so we don't clobber it.
    for (const id of pendingCreates) {
      if (serverIds.has(id)) continue;
      const t = cache.get(id);
      if (t) persist(t);
    }
    pendingCreates.clear();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[linkedDocTasksStore] failed to hydrate from server', err);
    hydrationDone = true;
    // Hydrate failed — best-effort: try to persist pending placeholders
    // since we have no server truth to defer to.
    for (const id of pendingCreates) {
      const t = cache.get(id);
      if (t) persist(t);
    }
    pendingCreates.clear();
  }
}

export function setLinkedDocNote(emailId: number, note: string | null) {
  const t = cache.get(emailId);
  if (!t) return;
  const next: LinkedDocTask = { ...t, noteAfterEmailDone: note ?? undefined };
  cache.set(emailId, next);
  emit();
  persist(next);
}

export function setLinkedDocDone(emailId: number, done: boolean) {
  const t = cache.get(emailId);
  if (!t) return;
  const next: LinkedDocTask = { ...t, done };
  cache.set(emailId, next);
  emit();
  persist(next);
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
  const existing = cache.get(email.id);
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
  cache.set(email.id, task);
  emit();
  if (hydrationDone) {
    persist(task);
  } else {
    // Hold the POST until hydrate decides whether the server already
    // has authoritative state for this email. See pendingCreates +
    // hydrate() for the drain logic.
    pendingCreates.add(email.id);
  }
  return task;
}

// If a re-classification removes the document flag, drop the auto-created
// task so it doesn't linger.
export function removeLinkedDocTaskIfNoLongerRequired(emailId: number, c: AiClassification | undefined) {
  if (!c || c.requiresDocument) return;
  if (!cache.has(emailId)) return;
  cache.delete(emailId);
  emit();
  apiDeleteLinkedDocTask(encodeURIComponent(String(emailId))).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[linkedDocTasksStore] failed to delete task', err);
  });
}

export function markLinkedDocTaskDone(emailId: number) {
  const t = cache.get(emailId);
  if (!t || t.done) return;
  const next: LinkedDocTask = { ...t, done: true };
  cache.set(emailId, next);
  emit();
  persist(next);
}

export function toggleLinkedDocTaskDone(emailId: number) {
  const t = cache.get(emailId);
  if (!t) return;
  const next: LinkedDocTask = { ...t, done: !t.done };
  cache.set(emailId, next);
  emit();
  persist(next);
}

export function getLinkedDocTask(emailId: number): LinkedDocTask | undefined {
  return cache.get(emailId);
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
const getServerSnapshot = () => cache;

export function useLinkedDocTasks(): Map<number, LinkedDocTask> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function isHydrated(): boolean {
  return hydrationDone;
}
