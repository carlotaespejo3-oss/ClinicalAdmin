import { useSyncExternalStore } from 'react';

// In-memory overrides for the planner's synthetic "unclear gate" item.
//
// The unclear gate is computed by the planner (planner.ts) and isn't a
// row anywhere — it surfaces whenever the inbox has emails the AI
// classifier couldn't categorise. Yet the clinician can open it from
// the calendar modal and wants two operations on it:
//   - resize the time estimate (default is a placeholder 5 min)
//   - dismiss it for today ("I'll handle them later, off my runway")
//
// Both are per-day, client-only state. Persisting feels like overkill
// for a "for the rest of today" decision — if the clinician reloads,
// the gate is rebuilt fresh from current unclear-email count, which
// is the right behaviour. Mirrors the userPlannedItemsStore pattern.

export interface UnclearGateOverride {
  estMin?: number;
  dismissed?: boolean;
}

let overrides: Map<string, UnclearGateOverride> = new Map();
const listeners = new Set<() => void>();

// Clone-on-write so React (and usePlannerOutput's useMemo) sees a new
// reference whenever the contents change. Without this, every consumer
// would receive the same Map identity and skip the recompute.
function emit() {
  overrides = new Map(overrides);
  listeners.forEach((l) => l());
}

export function setUnclearGateEstMin(dateKey: string, estMin: number): void {
  const prev = overrides.get(dateKey) ?? {};
  overrides.set(dateKey, { ...prev, estMin });
  emit();
}

export function dismissUnclearGate(dateKey: string): void {
  const prev = overrides.get(dateKey) ?? {};
  overrides.set(dateKey, { ...prev, dismissed: true });
  emit();
}

export function getUnclearGateOverride(
  dateKey: string,
): UnclearGateOverride | undefined {
  return overrides.get(dateKey);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => overrides;

// Hook returns the live Map so the planner can read every date's
// override in one go. Consumers must treat it as read-only — every
// mutation rebinds `overrides` to a fresh Map (see emit), so identity
// is a reliable change signal for downstream memos.
export function useUnclearGateOverrides(): Map<string, UnclearGateOverride> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
