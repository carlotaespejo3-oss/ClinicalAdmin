// estMin learning — records how long clinicians actually spend on emails
// and derives per-category multipliers that the planner applies to future
// estimates. The multiplier is an exponential moving average (EMA) of the
// ratio (actualMin / estMin), clamped to [0.5, 3.0] to prevent outliers
// from ruining estimates.
//
// Persistence: stored in the clinician-settings Postgres row via
// setTimeTrackingInternal (same write-chain as other clinician settings).
//
// Pending-sample: purely in-memory. When elapsed time is suspicious
// (> 2× estimate or > 30 min) the timer defers recording and raises a
// pending sample so the UI can ask the clinician for the real duration.

import { useSyncExternalStore } from 'react';
import type { AiCategory } from './types';
import { getTimeTracking, setTimeTrackingInternal } from './clinicianSettingsStore';

const EMA_ALPHA = 0.3; // weight given to the newest sample
const MULTIPLIER_MIN = 0.5;
const MULTIPLIER_MAX = 3.0;
const MIN_ACTIVE_SEC = 30; // ignore interactions shorter than 30 s

export interface PendingSample {
  category: AiCategory;
  /** Raw elapsed active minutes — shown as the default in the prompt. */
  activeMin: number;
  estMin: number;
}

// ---- In-memory pending-sample store ------------------------------------

let pendingSample: PendingSample | null = null;
const pendingListeners = new Set<() => void>();

function emitPending() {
  pendingListeners.forEach((l) => l());
}

export function getPendingSample(): PendingSample | null {
  return pendingSample;
}

export function setPendingSample(sample: PendingSample) {
  pendingSample = sample;
  emitPending();
}

export function clearPendingSample() {
  pendingSample = null;
  emitPending();
}

export function usePendingSample(): PendingSample | null {
  return useSyncExternalStore(
    (l) => { pendingListeners.add(l); return () => { pendingListeners.delete(l); }; },
    getPendingSample,
    getPendingSample,
  );
}

// ---- EMA multiplier update --------------------------------------------

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Record one timing sample. Updates the EMA multiplier for the category
 * and persists. Safe to call from cleanup effects (fire-and-forget).
 */
export function recordSample(category: AiCategory, actualMin: number, estMin: number) {
  if (actualMin < MIN_ACTIVE_SEC / 60) return; // too short
  if (estMin <= 0) return;

  const current = getTimeTracking();
  const prev = current.categoryStats[category];
  const ratio = clamp(actualMin / estMin, MULTIPLIER_MIN, MULTIPLIER_MAX);
  const newMultiplier = prev
    ? clamp((1 - EMA_ALPHA) * prev.multiplier + EMA_ALPHA * ratio, MULTIPLIER_MIN, MULTIPLIER_MAX)
    : ratio;

  setTimeTrackingInternal({
    ...current,
    categoryStats: {
      ...current.categoryStats,
      [category]: {
        multiplier: newMultiplier,
        sampleCount: (prev?.sampleCount ?? 0) + 1,
      },
    },
  });
}

/**
 * Returns the current EMA multipliers keyed by category.
 * Categories with no data return 1.0 (no adjustment).
 */
export function getMultipliers(): Partial<Record<AiCategory, number>> {
  const stats = getTimeTracking().categoryStats;
  const out: Partial<Record<AiCategory, number>> = {};
  for (const [cat, s] of Object.entries(stats)) {
    if (s) out[cat as AiCategory] = s.multiplier;
  }
  return out;
}
