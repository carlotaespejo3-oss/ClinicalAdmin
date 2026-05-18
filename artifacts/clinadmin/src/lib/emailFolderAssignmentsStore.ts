import { useSyncExternalStore } from 'react';
import {
  listEmailFolderAssignments,
  assignEmailToFolder as apiAssign,
  unassignEmailFromFolder as apiUnassign,
} from '@workspace/api-client-react';
import { bumpFolderViews } from './outlookFoldersStore';

// (email → custom folder) mapping, fire-and-forget.
// Storage rule: pure reference data. The outlookEmailId is the only
// payload — no subject, sender or body is ever cached client-side
// or persisted server-side by this store. Folder counts and the
// "which emails are in this folder" list both come from this map.

export interface EmailFolderAssignment {
  outlookEmailId: string;
  customFolderId: string;
}

const listeners = new Set<() => void>();
let cache: Map<string, string> = new Map();
let hydrationStarted = false;

function snapshot(): EmailFolderAssignment[] {
  return [...cache.entries()].map(([outlookEmailId, customFolderId]) => ({
    outlookEmailId,
    customFolderId,
  }));
}

let cached: EmailFolderAssignment[] = [];

function emit() {
  cached = snapshot();
  listeners.forEach((l) => l());
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listEmailFolderAssignments();
    for (const r of rows) {
      // Don't overwrite local optimistic writes that landed first.
      if (!cache.has(r.outlookEmailId)) {
        cache.set(r.outlookEmailId, r.customFolderId);
      }
    }
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[emailFolderAssignmentsStore] hydrate failed', err);
  }
}

export function assignEmail(outlookEmailId: number | string, customFolderId: string): void {
  const id = String(outlookEmailId);
  cache.set(id, customFolderId);
  emit();
  bumpFolderViews();
  apiAssign({ outlookEmailId: id, customFolderId }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[emailFolderAssignmentsStore] assign failed', err);
  });
}

export function unassignEmail(outlookEmailId: number | string): void {
  const id = String(outlookEmailId);
  if (!cache.has(id)) return;
  cache.delete(id);
  emit();
  bumpFolderViews();
  apiUnassign(encodeURIComponent(id)).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[emailFolderAssignmentsStore] unassign failed', err);
  });
}

export function folderOf(outlookEmailId: number | string): string | undefined {
  return cache.get(String(outlookEmailId));
}

export function clearFolder(customFolderId: string): void {
  // Used after deleting a folder so its assignments disappear from
  // the local cache without waiting for the server cascade.
  const toClear: string[] = [];
  for (const [emailId, folderId] of cache.entries()) {
    if (folderId === customFolderId) toClear.push(emailId);
  }
  if (!toClear.length) return;
  for (const id of toClear) cache.delete(id);
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) void hydrate();
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cached;

export function useEmailFolderAssignments(): EmailFolderAssignment[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function countByFolder(assignments: EmailFolderAssignment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of assignments) {
    out.set(a.customFolderId, (out.get(a.customFolderId) ?? 0) + 1);
  }
  return out;
}
