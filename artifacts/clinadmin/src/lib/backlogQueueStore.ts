import { useSyncExternalStore } from 'react';
import {
  listBacklogItems,
  upsertBacklogItem,
  deleteBacklogItem,
  upsertDismissedBacklogItem,
  restoreDismissedBacklogItem,
  listDismissedBacklogItems,
  clearDismissedBacklog,
} from '@workspace/api-client-react';
import type { DismissReason } from '@workspace/api-client-react';

// Inbox catch-up backlog — "start mode".
//
// When a new clinician connects Outlook with a large existing inbox,
// the pre-filter (inboxPreFilter.ts) + optional AI relevance pass
// produce a candidate set of emails that might still be open. Those
// candidates land here, separate from the live triage flow, so the
// daily planning view stays calm.
//
// DRIP-FEED DESIGN:
//   The store exposes two views of the same data:
//     · items        — the full ranked list (used by the "See all" modal)
//     · surfaced     — the top SURFACE_LIMIT pending items (used by
//                      the dashboard card)
//   Resolving an item (done/deferred/dismiss) shrinks `items`; the
//   next item automatically surfaces on the next render. The clinician
//   can also call `surfaceMore()` to bump the visible limit by
//   SURFACE_INCREMENT if they want to clear more in one sitting.
//
// PERSISTENCE: Postgres via /api/backlog-items. Hydrate-once +
// fire-and-forget pattern matching all other stores. `id` is client-
// generated ("bl<timestamp>_<rand>") so the UI updates synchronously.
//
// STORAGE RULE: minimal recognition metadata only — subject, sender,
// receivedAt, and the Outlook message-id reference. Never body content.

// ============================================================================
// Types
// ============================================================================

export type BacklogStatus = 'pending' | 'done' | 'deferred';

export interface BacklogItem {
  id: string;
  outlookMessageId: string;      // Graph message-id — reference only
  conversationId: string;        // for thread-level grouping in the modal
  subject: string;
  senderName: string;
  senderAddress: string;
  receivedAt: string;            // ISO datetime
  priorityScore: number;         // 0–100, higher = surface first
  status: BacklogStatus;
  linkedTaskId: string | null;   // set when status = 'deferred'
  createdAt: string;             // ISO datetime
  resolvedAt: string | null;     // ISO datetime, set when status ≠ 'pending'
}

export interface DismissedBacklogItem {
  id: string;
  outlookMessageId: string;
  conversationId: string;
  subject: string;
  senderName: string;
  senderAddress: string;
  receivedAt: string;
  dismissedAt: string;
  dismissReason: DismissReason;
  restoredAt: string | null;
}

// ============================================================================
// Config
// ============================================================================

// Number of pending items shown on the dashboard card initially.
// Chosen to feel manageable ("just a few things") rather than
// overwhelming. surfaceMore() bumps this by SURFACE_INCREMENT.
const SURFACE_LIMIT_DEFAULT = 3;
const SURFACE_INCREMENT = 3;

// ============================================================================
// Module state
// ============================================================================

// Active backlog.
let items: BacklogItem[] = [];
let hydrationStarted = false;
let hydrationDone = false;
let surfaceLimit = SURFACE_LIMIT_DEFAULT;
const listeners = new Set<() => void>();

// Dismissed items / audit log.
let dismissed: DismissedBacklogItem[] = [];
let dismissedHydrated = false;
const dismissedListeners = new Set<() => void>();

// Per-item write chain — prevents two rapid writes on the same id
// being reordered on the wire (matches the pattern in all other stores).
const writeChains = new Map<string, Promise<unknown>>();
function chainWrite(id: string, run: () => Promise<unknown>) {
  const prev = writeChains.get(id) ?? Promise.resolve();
  const next = prev
    .then(run)
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[backlogQueueStore] persist failed for ${id}`, err);
    });
  writeChains.set(id, next);
}

// ============================================================================
// Derived state helpers
// ============================================================================

/** Items ranked for display: pending first (by priorityScore DESC), then
 *  resolved items. This is the full list used by the "See all" modal. */
function sortedItems(): BacklogItem[] {
  return [...items].sort((a, b) => {
    // Pending before resolved.
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    // Among pending: priorityScore DESC, receivedAt DESC.
    if (a.status === 'pending') {
      const scoreDiff = b.priorityScore - a.priorityScore;
      if (scoreDiff !== 0) return scoreDiff;
      return b.receivedAt.localeCompare(a.receivedAt);
    }
    // Among resolved: resolvedAt DESC (most recently done first).
    return (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '');
  });
}

/** The top N pending items for the dashboard card. */
function surfacedItems(): BacklogItem[] {
  return sortedItems()
    .filter((i) => i.status === 'pending')
    .slice(0, surfaceLimit);
}

/** Counts for the progress bar. */
function counts(): { total: number; pending: number; resolved: number } {
  const total = items.length;
  const pending = items.filter((i) => i.status === 'pending').length;
  return { total, pending, resolved: total - pending };
}

// ============================================================================
// Hydration
// ============================================================================

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listBacklogItems();
    const existingIds = new Set(items.map((i) => i.id));
    for (const r of rows) {
      if (existingIds.has(r.id)) continue;
      items.push({
        id: r.id,
        outlookMessageId: r.outlookMessageId,
        conversationId: r.conversationId,
        subject: r.subject,
        senderName: r.senderName,
        senderAddress: r.senderAddress,
        receivedAt: r.receivedAt,
        priorityScore: r.priorityScore,
        status: r.status as BacklogStatus,
        linkedTaskId: r.linkedTaskId ?? null,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt ?? null,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[backlogQueueStore] failed to hydrate backlog', err);
  } finally {
    hydrationDone = true;
    emit();
  }
}

async function hydrateDismissed(): Promise<void> {
  if (dismissedHydrated) return;
  dismissedHydrated = true;
  try {
    const rows = await listDismissedBacklogItems();
    dismissed = rows.map((r) => ({
      id: r.id,
      outlookMessageId: r.outlookMessageId,
      conversationId: r.conversationId,
      subject: r.subject,
      senderName: r.senderName,
      senderAddress: r.senderAddress,
      receivedAt: r.receivedAt,
      dismissedAt: r.dismissedAt,
      dismissReason: r.dismissReason as DismissReason,
      restoredAt: r.restoredAt ?? null,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[backlogQueueStore] failed to hydrate dismissed items', err);
  } finally {
    emitDismissed();
  }
}

// ============================================================================
// Internal emit helpers
// ============================================================================

function emit(): void {
  items = [...items]; // new ref so useSyncExternalStore detects the change
  listeners.forEach((l) => l());
}

function emitDismissed(): void {
  dismissed = [...dismissed];
  dismissedListeners.forEach((l) => l());
}

// ============================================================================
// Public write actions
// ============================================================================

/** Generate a unique backlog item id. */
function newId(): string {
  return `bl${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Add a batch of new items from a scan result. Items are deduped by
 *  outlookMessageId — if a message is already in the backlog (from a
 *  previous scan session) it is not re-added.
 *
 *  Also dedupes by conversationId so that if multiple messages in the
 *  same thread passed the filter, only the most recent (highest
 *  priorityScore) one is surfaced. This keeps the "see all" list
 *  thread-level, not message-level.
 */
export function addBacklogItems(
  newItems: Omit<BacklogItem, 'id' | 'status' | 'linkedTaskId' | 'createdAt' | 'resolvedAt'>[],
): void {
  const existingOutlookIds = new Set(items.map((i) => i.outlookMessageId));
  // Track the highest-scoring item per conversationId that we've already
  // decided to add in this batch — prevents duplicate threads from the
  // same scan run.
  const bestPerConversation = new Map<string, BacklogItem>();

  // First pass: dedupe existing + build per-conversation best.
  for (const existing of items) {
    const conv = existing.conversationId;
    const prev = bestPerConversation.get(conv);
    if (!prev || existing.priorityScore > prev.priorityScore) {
      bestPerConversation.set(conv, existing);
    }
  }

  const toAdd: BacklogItem[] = [];
  for (const n of newItems) {
    if (existingOutlookIds.has(n.outlookMessageId)) continue;
    const prev = bestPerConversation.get(n.conversationId);
    if (prev && prev.priorityScore >= n.priorityScore) continue; // lower-priority dupe

    const item: BacklogItem = {
      id: newId(),
      status: 'pending',
      linkedTaskId: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      ...n,
    };
    // If we're replacing a lower-priority item for this conversation,
    // remove it from the pending list (swap, not append).
    if (prev && prev.status === 'pending') {
      items = items.filter((i) => i.id !== prev.id);
      // Remove the old item from the server asynchronously.
      chainWrite(prev.id, () => deleteBacklogItem(encodeURIComponent(prev.id)));
    }
    bestPerConversation.set(n.conversationId, item);
    toAdd.push(item);
  }

  if (toAdd.length === 0) return;

  items = [...items, ...toAdd];
  emit();

  for (const item of toAdd) {
    const { id, ...body } = item;
    chainWrite(id, () => upsertBacklogItem(encodeURIComponent(id), body));
  }
}

/** Mark an item as done — the clinician handled it, no task needed. */
export function markBacklogItemDone(id: string): void {
  const now = new Date().toISOString();
  let updated: BacklogItem | undefined;
  items = items.map((i) => {
    if (i.id !== id) return i;
    updated = { ...i, status: 'done', resolvedAt: now };
    return updated;
  });
  if (!updated) return;
  emit();
  const { id: _, ...body } = updated;
  chainWrite(id, () => upsertBacklogItem(encodeURIComponent(id), body));
}

/** Defer an item — push it to the task list and record the linked task id. */
export function deferBacklogItem(id: string, linkedTaskId: string): void {
  const now = new Date().toISOString();
  let updated: BacklogItem | undefined;
  items = items.map((i) => {
    if (i.id !== id) return i;
    updated = { ...i, status: 'deferred', linkedTaskId, resolvedAt: now };
    return updated;
  });
  if (!updated) return;
  emit();
  const { id: _, ...body } = updated;
  chainWrite(id, () => upsertBacklogItem(encodeURIComponent(id), body));
}

/** Dismiss an item — moves it to the dismissed audit log and removes it
 *  from the active backlog. The `reason` should be 'manual' when the
 *  clinician explicitly dismisses; use 'ai:expired' / 'ai:noise' for
 *  AI-pass dismissals recorded after the pre-filter. */
export function dismissBacklogItem(
  id: string,
  reason: DismissReason,
): void {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  // Remove from active list.
  items = items.filter((i) => i.id !== id);
  emit();

  // Record in dismissed audit log.
  const dismissId = `bd${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const dismissedEntry: DismissedBacklogItem = {
    id: dismissId,
    outlookMessageId: item.outlookMessageId,
    conversationId: item.conversationId,
    subject: item.subject,
    senderName: item.senderName,
    senderAddress: item.senderAddress,
    receivedAt: item.receivedAt,
    dismissedAt: now,
    dismissReason: reason,
    restoredAt: null,
  };
  dismissed = [...dismissed, dismissedEntry];
  emitDismissed();

  // Persist: delete from backlog, add to dismissed log.
  chainWrite(id, () => deleteBacklogItem(encodeURIComponent(id)));
  chainWrite(dismissId, () =>
    upsertDismissedBacklogItem(encodeURIComponent(dismissId), {
      outlookMessageId: item.outlookMessageId,
      conversationId: item.conversationId,
      subject: item.subject,
      senderName: item.senderName,
      senderAddress: item.senderAddress,
      receivedAt: item.receivedAt,
      dismissedAt: now,
      dismissReason: reason,
    }),
  );
}

/** Restore a dismissed item back to the active backlog.
 *  Creates a new backlog item with a fresh id (the dismissed row is
 *  kept for the audit trail with restoredAt set). */
export function restoreBacklogItem(dismissedId: string): void {
  const entry = dismissed.find((d) => d.id === dismissedId);
  if (!entry || entry.restoredAt) return; // already restored or not found

  // Mark as restored in local cache.
  dismissed = dismissed.map((d) =>
    d.id === dismissedId
      ? { ...d, restoredAt: new Date().toISOString() }
      : d,
  );
  emitDismissed();

  // Re-add to active backlog (lowest priority — it was dismissed for a
  // reason; the clinician wants to review it but it's not urgent).
  const restoredItem: BacklogItem = {
    id: newId(),
    outlookMessageId: entry.outlookMessageId,
    conversationId: entry.conversationId,
    subject: entry.subject,
    senderName: entry.senderName,
    senderAddress: entry.senderAddress,
    receivedAt: entry.receivedAt,
    priorityScore: 0,  // surfaces last — the clinician chose to look again, not urgently
    status: 'pending',
    linkedTaskId: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  items = [...items, restoredItem];
  emit();

  // Persist.
  chainWrite(dismissedId, () =>
    restoreDismissedBacklogItem(encodeURIComponent(dismissedId)),
  );
  const { id, ...body } = restoredItem;
  chainWrite(id, () => upsertBacklogItem(encodeURIComponent(id), body));
}

/** Bump the number of items shown on the dashboard card. */
export function surfaceMoreBacklogItems(): void {
  surfaceLimit += SURFACE_INCREMENT;
  emit();
}

/** Erase the entire dismissed-items history (GDPR right-to-erase action
 *  in Settings). Does NOT affect the active backlog. */
export function clearDismissedHistory(): void {
  dismissed = [];
  dismissedHydrated = false; // allow re-hydration if the user navigates back
  emitDismissed();
  clearDismissedBacklog().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[backlogQueueStore] failed to clear dismissed history', err);
  });
}

// ============================================================================
// useSyncExternalStore subscriptions
// ============================================================================

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) void hydrate();
  return () => { listeners.delete(l); };
}

function subscribeDismissed(l: () => void): () => void {
  dismissedListeners.add(l);
  if (!dismissedHydrated) void hydrateDismissed();
  return () => { dismissedListeners.delete(l); };
}

// Snapshot types for the store — structured to give components
// exactly what they need without extra derivation in render.
interface BacklogSnapshot {
  items: BacklogItem[];          // full ranked list
  surfaced: BacklogItem[];       // top N pending (for dashboard card)
  total: number;
  pending: number;
  resolved: number;
  isHydrated: boolean;
}

function getSnapshot(): BacklogSnapshot {
  const c = counts();
  return {
    items: sortedItems(),
    surfaced: surfacedItems(),
    ...c,
    isHydrated: hydrationDone,
  };
}

let _lastSnapshot: BacklogSnapshot = getSnapshot();
function stableSnapshot(): BacklogSnapshot {
  // Avoid unnecessary re-renders: only replace the snapshot object when
  // something actually changed. useSyncExternalStore calls this on every
  // render pass; returning the same reference short-circuits the React
  // subtree.
  const next = getSnapshot();
  if (
    next.items === _lastSnapshot.items &&
    next.surfaced === _lastSnapshot.surfaced &&
    next.total === _lastSnapshot.total &&
    next.pending === _lastSnapshot.pending &&
    next.isHydrated === _lastSnapshot.isHydrated
  ) {
    return _lastSnapshot;
  }
  _lastSnapshot = next;
  return _lastSnapshot;
}

// ============================================================================
// Public React hooks
// ============================================================================

/** Subscribe to the active backlog. Returns a stable snapshot object that
 *  components can destructure without triggering unnecessary re-renders. */
export function useBacklogQueue(): BacklogSnapshot {
  return useSyncExternalStore(subscribe, stableSnapshot, stableSnapshot);
}

/** Subscribe to the dismissed-items audit log. Hydrates on first use
 *  (lazy — only called from the Settings "dismissed" view). */
export function useDismissedBacklogItems(): DismissedBacklogItem[] {
  return useSyncExternalStore(
    subscribeDismissed,
    () => dismissed,
    () => dismissed,
  );
}

export function isBacklogHydrated(): boolean {
  return hydrationDone;
}
