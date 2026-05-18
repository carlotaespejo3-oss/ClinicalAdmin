import { useSyncExternalStore } from 'react';
import {
  listCustomFolders,
  createCustomFolder as apiCreate,
  renameCustomFolder as apiRename,
  deleteCustomFolder as apiDelete,
} from '@workspace/api-client-react';

// Clinician-created folders for organising their inbox.
//
// Storage rule: folder definitions only — name, id, created_at. No
// email content. Hydrate-once + fire-and-forget like the other
// stores in this folder; see userTasksStore.ts for the full rationale.

export interface CustomFolder {
  id: string;
  name: string;
  createdAt: number;
}

const listeners = new Set<() => void>();
let cache: CustomFolder[] = [];
let hydrationStarted = false;

function emit() {
  cache = [...cache];
  listeners.forEach((l) => l());
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listCustomFolders();
    const existing = new Set(cache.map((f) => f.id));
    for (const r of rows) {
      if (existing.has(r.id)) continue;
      cache.push({
        id: r.id,
        name: r.name,
        createdAt: new Date(r.createdAt).getTime(),
      });
    }
    cache.sort((a, b) => a.name.localeCompare(b.name));
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[customFoldersStore] hydrate failed', err);
  }
}

export function addCustomFolder(name: string): CustomFolder {
  const created: CustomFolder = {
    id: `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    createdAt: Date.now(),
  };
  cache = [...cache, created].sort((a, b) => a.name.localeCompare(b.name));
  listeners.forEach((l) => l());
  apiCreate({ id: created.id, name: created.name }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[customFoldersStore] create failed', err);
  });
  return created;
}

export function renameCustomFolder(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  cache = cache
    .map((f) => (f.id === id ? { ...f, name: trimmed } : f))
    .sort((a, b) => a.name.localeCompare(b.name));
  listeners.forEach((l) => l());
  apiRename(encodeURIComponent(id), { name: trimmed }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[customFoldersStore] rename failed', err);
  });
}

export function deleteCustomFolder(id: string): void {
  cache = cache.filter((f) => f.id !== id);
  listeners.forEach((l) => l());
  apiDelete(encodeURIComponent(id)).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[customFoldersStore] delete failed', err);
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) void hydrate();
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;

export function useCustomFolders(): CustomFolder[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
