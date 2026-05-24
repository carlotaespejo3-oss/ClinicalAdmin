// currentBreachStore.ts
//
// Thin module-level signal — NOT a React store. No subscription, no
// useSyncExternalStore. Just a mutable variable written by HomeTab on
// every plannerOutput change and read synchronously by ClinAdmin's
// beforeunload handler.
//
// Why not a React store? The beforeunload event fires synchronously
// at the OS level — the browser is about to destroy the JS context.
// By the time the event fires, React's scheduler may not run. A plain
// module variable always has the latest value because HomeTab writes
// it in a useEffect that runs after every render.
//
// Pattern: write-on-render (HomeTab) → read-on-event (ClinAdmin).

import type { BreachInfo } from './planner';
import type { AiCategory } from './types';

export const CLINICAL_CATS = new Set<AiCategory>([
  'SAFEGUARDING',
  'URGENT_CLINICAL',
  'LEGAL',
  'CLINICAL',
  'PROFESSIONAL',
]);

let _clinical: BreachInfo[] = [];
let _admin: BreachInfo[] = [];

/** Called by HomeTab after every plannerOutput change. */
export function updateBreachSignal(breaches: BreachInfo[]): void {
  _clinical = breaches.filter((b) => CLINICAL_CATS.has(b.category));
  _admin = breaches.filter((b) => !CLINICAL_CATS.has(b.category));
}

export function getClinicalBreaches(): BreachInfo[] {
  return _clinical;
}

export function getAdminBreaches(): BreachInfo[] {
  return _admin;
}

/** True when there are un-deferred clinical/urgent breaches.
 *  Used synchronously inside the beforeunload handler — pass the
 *  deferred set at call time so the signal stays accurate. */
export function hasActiveClinicalBreaches(deferredIds: Set<number>): boolean {
  return _clinical.some((b) => !deferredIds.has(b.itemId as number));
}
