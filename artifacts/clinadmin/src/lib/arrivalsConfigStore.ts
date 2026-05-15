import { type ArrivalConfig } from './planner';
import {
  useArrivalsConfigCache,
  setArrivalsConfigInternal,
  resetArrivalsConfigInternal,
} from './clinicianSettingsStore';

// Backwards-compat shim. The arrivals planner config now lives in
// the shared clinicianSettings store (Postgres-backed, single GET
// for arrivals + style profile + signatures). Consumers keep the
// old API.

export function setArrivalsConfig(next: ArrivalConfig) {
  setArrivalsConfigInternal(next);
}

export function resetArrivalsConfig() {
  resetArrivalsConfigInternal();
}

export function useArrivalsConfig(): ArrivalConfig {
  return useArrivalsConfigCache();
}
