import { useSyncExternalStore } from 'react';
import {
  getWeeklyPlan,
  upsertWeeklyPlan,
  deleteWeeklyPlan,
} from '@workspace/api-client-react';
import type { WeekSetup } from '@/pages/ClinAdmin';

// Per-week planner snapshot store. Mirrors the other stores
// (hydrate-once + fire-and-forget) but keyed by `weekKey` instead
// of clinician-wide.
//
// Hydration is per-key: the first reader for week 2026-21 triggers
// one GET for that week; week 2026-22 hydrates independently when
// asked. Each key reaches one of three states:
//   undefined  — never touched, will hydrate on next read/subscribe
//   null       — hydrated, server has no snapshot for this week
//   WeekSetup  — hydrated, current value
// We expose null for both "loading" and "absent" because the only
// caller (ClinAdmin) treats both the same way: open the planner
// modal. If a future caller needs to distinguish, add an
// `isHydrated(weekKey)` helper rather than leaking undefined.
//
// Storage rule: WeekSetup contains hours/days/sessionLength chosen
// by the clinician plus the GeneratedPlan the planner produced.
// Plan blocks carry clinician-authored summaries derived from
// email metadata, never raw email body or sender content.

const cache = new Map<string, WeekSetup | null>();
const hydrationStarted = new Set<string>();
const listeners = new Set<() => void>();

// Snapshot identity for useSyncExternalStore. Bumped on every
// mutation so React re-runs the per-key getter and resubscribes
// downstream consumers.
let snapshotToken: object = {};

function emit() {
  snapshotToken = {};
  listeners.forEach((l) => l());
}

// Serialise outgoing writes per-week so two rapid edits to the
// same week can't be reordered by the network and overwrite newer
// state. Different weeks write independently because they map to
// different rows.
const writeChains = new Map<string, Promise<unknown>>();
function chainWrite(weekKey: string, run: () => Promise<unknown>) {
  const prev = writeChains.get(weekKey) ?? Promise.resolve();
  const next = prev.then(run).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[weeklyPlanStore] persist failed for ${weekKey}`, err);
  });
  writeChains.set(weekKey, next);
}

// One-time legacy migration helper. Pre-migration the planner
// wrote `clinadmin-week-${weekKey}` straight to localStorage; if
// that key still exists when the server has nothing for this
// week, we read it (without deleting yet), and the caller upserts
// to the server. The localStorage entry is removed only after the
// upsert succeeds, so a transient network failure can't lose the
// only copy of the clinician's saved week.
function readLegacyWeek(weekKey: string): { legacyKey: string; setup: WeekSetup } | null {
  if (typeof window === 'undefined') return null;
  try {
    const legacyKey = `clinadmin-week-${weekKey}`;
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { legacyKey, setup: parsed as WeekSetup };
  } catch {
    return null;
  }
}

async function hydrate(weekKey: string): Promise<void> {
  if (hydrationStarted.has(weekKey)) return;
  hydrationStarted.add(weekKey);
  try {
    const remote = await getWeeklyPlan(weekKey);
    // Local writes that arrived before hydration completed always
    // win — the user's clicks are more recent than the GET.
    if (cache.get(weekKey) === undefined) {
      const setup = (remote.setup ?? null) as WeekSetup | null;
      if (setup === null) {
        const legacy = readLegacyWeek(weekKey);
        if (legacy) {
          cache.set(weekKey, legacy.setup);
          chainWrite(weekKey, () =>
            upsertWeeklyPlan(
              weekKey,
              legacy.setup as unknown as Parameters<typeof upsertWeeklyPlan>[1],
            ).then(() => {
              // Only drop the legacy localStorage entry once the
              // server confirms it has the data. If the upsert
              // throws, chainWrite swallows it; the legacy key
              // stays in place so the next page load retries.
              try {
                localStorage.removeItem(legacy.legacyKey);
              } catch {
                /* noop */
              }
            }),
          );
        } else {
          cache.set(weekKey, null);
        }
      } else {
        cache.set(weekKey, setup);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[weeklyPlanStore] failed to hydrate ${weekKey}`, err);
    if (cache.get(weekKey) === undefined) cache.set(weekKey, null);
  } finally {
    emit();
  }
}

function ensureHydrationStarted(weekKey: string) {
  if (!hydrationStarted.has(weekKey)) void hydrate(weekKey);
}

export function getWeekSetup(weekKey: string): WeekSetup | null {
  ensureHydrationStarted(weekKey);
  return cache.get(weekKey) ?? null;
}

// True once the GET for this week has resolved (success or failure).
// Used by the planner shell to distinguish "still loading, don't
// pop the modal yet" from "hydrated and genuinely empty, prompt
// the clinician".
export function isWeekHydrated(weekKey: string): boolean {
  return cache.has(weekKey);
}

export function setWeekSetupInternal(weekKey: string, next: WeekSetup) {
  // Mark hydration done so a stale GET can't overwrite this write
  // if it lands later.
  hydrationStarted.add(weekKey);
  cache.set(weekKey, next);
  emit();
  chainWrite(weekKey, () =>
    upsertWeeklyPlan(weekKey, next as unknown as Parameters<typeof upsertWeeklyPlan>[1]),
  );
}

// Functional updater. Use this when the new value depends on the
// previous one (e.g. patching `plan` while keeping `hours`/`days`
// intact). Reading from the live cache instead of a captured
// closure prevents two rapid edits — say, "regenerate plan" and
// "change availability" — from clobbering each other when they
// fire in the same tick.
export function updateWeekSetupInternal(
  weekKey: string,
  updater: (prev: WeekSetup | null) => WeekSetup,
) {
  const prev = cache.get(weekKey) ?? null;
  setWeekSetupInternal(weekKey, updater(prev));
}

export function clearWeekSetupInternal(weekKey: string) {
  hydrationStarted.add(weekKey);
  cache.set(weekKey, null);
  emit();
  chainWrite(weekKey, () => deleteWeeklyPlan(weekKey));
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): object {
  return snapshotToken;
}

function getServerSnapshot(): object {
  return snapshotToken;
}

export function useWeekSetupCache(weekKey: string): WeekSetup | null {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return getWeekSetup(weekKey);
}

// Reactive companion to `isWeekHydrated`. Components that need to
// gate UX on "GET has resolved" (e.g. don't pop the planner modal
// while we're still loading) must subscribe via this hook so the
// transition from "unhydrated" to "hydrated and empty" actually
// re-runs their effects — `useWeekSetupCache` alone returns null
// for both states and would not trigger a dependency change.
export function useIsWeekHydrated(weekKey: string): boolean {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  ensureHydrationStarted(weekKey);
  return isWeekHydrated(weekKey);
}

// Test-only.
export function _resetForTests() {
  cache.clear();
  hydrationStarted.clear();
  writeChains.clear();
  snapshotToken = {};
  listeners.forEach((l) => l());
}
