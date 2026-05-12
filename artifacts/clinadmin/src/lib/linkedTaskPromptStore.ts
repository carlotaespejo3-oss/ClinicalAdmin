import { useSyncExternalStore } from 'react';

// Three flows the clinician can hit when emails and tasks are linked:
//
//   email-done     → "You've marked this email as done. Have you completed
//                     the document too?"
//   task-done      → "You've completed the document. Mark the original
//                     email as done too?"
//   reply-language → "It looks like you may have completed this document.
//                     Do you want to mark the linked task as done?"
//
// Components push prompts here; ClinAdmin renders one modal at a time
// from the head of the queue. Multiple prompts for the same emailId are
// deduplicated — the most recent one wins.

export type LinkedTaskPromptMode = 'email-done' | 'task-done' | 'reply-language';

export interface LinkedTaskPrompt {
  id: number; // monotonic counter, used as React key
  mode: LinkedTaskPromptMode;
  emailId: number;
  emailSubject: string;
  taskId: string;
  taskTitle: string;
  taskSource: 'manual' | 'doc' | 'prompt';
}

let nextId = 1;
let queue: LinkedTaskPrompt[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function requestLinkedTaskPrompt(p: Omit<LinkedTaskPrompt, 'id'>) {
  // Dedupe: drop any pending prompt for the same emailId. The newest
  // request reflects the most recent user action.
  queue = queue.filter((q) => q.emailId !== p.emailId);
  queue = [...queue, { ...p, id: nextId++ }];
  notify();
}

export function dismissCurrentLinkedTaskPrompt() {
  if (queue.length === 0) return;
  queue = queue.slice(1);
  notify();
}

export function clearLinkedTaskPromptsForEmail(emailId: number) {
  const before = queue.length;
  queue = queue.filter((q) => q.emailId !== emailId);
  if (queue.length !== before) notify();
}

// Synchronous read used by ClinAdmin's email-done detector. When the
// InboxTab has already queued a 'reply-language' prompt for this email
// (because the draft contained completion language), we don't want the
// detector to overwrite it with a generic 'email-done' prompt.
export function hasPendingPromptForEmail(emailId: number): boolean {
  return queue.some((q) => q.emailId === emailId);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = (): LinkedTaskPrompt | null => queue[0] ?? null;
const getServerSnapshot = (): LinkedTaskPrompt | null => null;

export function useCurrentLinkedTaskPrompt(): LinkedTaskPrompt | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
