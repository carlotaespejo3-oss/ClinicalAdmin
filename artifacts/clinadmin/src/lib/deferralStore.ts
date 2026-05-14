import { useSyncExternalStore } from 'react';

// Tracks which emails have been deferred from past planning windows
// (i.e. items the planner couldn't fit into a previous week's runway).
//
// Without this, a low-priority email deferred twice would silently
// become a 28-day-old unanswered email — it leaves the runway when
// it can't fit, and there is no signal next week that it has slipped
// before. Step 9 of the planner reads this history and annotates the
// PlanItem so the UI can warn "deferred 2× — received {date}".
//
// Granularity is per ISO-week (Monday): refreshing the page mid-week
// must NOT inflate counts. Each unique week the email appears in the
// planner's deferredItems list adds exactly one entry to its
// `weeksDeferred` array. The count is `weeksDeferred.length`.

const KEY = 'clinadmin-deferral-history-v1';
const listeners = new Set<() => void>();

export interface DeferralRecord {
  emailId: number;
  weeksDeferred: string[]; // ISO date strings of Mondays, ascending
}

let cache: Map<number, DeferralRecord> | null = null;

function load(): Map<number, DeferralRecord> {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    const arr = raw ? (JSON.parse(raw) as DeferralRecord[]) : [];
    cache = new Map(arr.map((r) => [r.emailId, r]));
  } catch {
    cache = new Map();
  }
  return cache;
}

function persist() {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(cache.values())));
  } catch {
    // ignore quota errors
  }
}

function emit() {
  cache = cache ? new Map(cache) : new Map();
  persist();
  listeners.forEach((l) => l());
}

// Returns the Monday-of-this-week as an ISO date string (YYYY-MM-DD).
// Uses local-time date components so two runs on the same calendar
// week always agree, regardless of UTC offset.
export function isoMondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0=Sun, 1=Mon, ..., 6=Sat. Want offset to Monday.
  const dow = d.getDay();
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offsetToMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Idempotent: recording the same emailId for the same Monday twice
// adds only one entry. Counts only ever increase across distinct weeks.
export function recordDeferralsForWeek(emailIds: number[], weekMondayISO: string): void {
  if (emailIds.length === 0) return;
  const map = load();
  let changed = false;
  for (const id of emailIds) {
    const existing = map.get(id);
    if (!existing) {
      map.set(id, { emailId: id, weeksDeferred: [weekMondayISO] });
      changed = true;
    } else if (!existing.weeksDeferred.includes(weekMondayISO)) {
      existing.weeksDeferred.push(weekMondayISO);
      changed = true;
    }
  }
  if (changed) emit();
}

// Drop history for an email when it's archived/acknowledged — once
// it's resolved, the deferral count is no longer meaningful, and we
// don't want stale data to resurface if the email ever returns to the
// inbox via "restore from archive".
export function clearDeferralsForEmail(id: number): void {
  const map = load();
  if (!map.has(id)) return;
  map.delete(id);
  emit();
}

export function clearAllDeferrals(): void {
  cache = new Map();
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();
const getServerSnapshot = () => load();

export function useDeferralHistory(): Map<number, DeferralRecord> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Convenience selector for the planner: a count of how many PRIOR
// planning windows the email was deferred in, excluding the current
// week. The current week is excluded because usePlannerOutput records
// today's deferredItems immediately on render; without exclusion,
// an email transiently unplaced (e.g. before the user adds capacity)
// would re-appear as "Deferred 1×" the instant it got scheduled in
// the same week — a false signal. Only weeks STRICTLY before
// currentWeekMondayISO count as "from a previous planning window".
export function deferralCountMap(
  history: Map<number, DeferralRecord>,
  currentWeekMondayISO: string,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, rec] of history) {
    let prior = 0;
    for (const w of rec.weeksDeferred) {
      if (w < currentWeekMondayISO) prior++;
    }
    if (prior > 0) out.set(id, prior);
  }
  return out;
}
