import { useSyncExternalStore } from 'react';
import {
  listLeaveBlocks,
  upsertLeaveBlock,
  deleteLeaveBlock,
} from '@workspace/api-client-react';

// Clinician leave / time-off blocks. v1 minimal — add / list / delete.
//
// PERSISTENCE: Postgres via /api/leave-blocks. Hydrate-once +
// fire-and-forget pattern matching sidebarTasksStore. Each row is
// keyed on a client-generated id ("lv<timestamp>_<rand>") so the UI
// can update synchronously and the POST that follows is idempotent
// on conflict.
//
// Storage rule: this is the clinician's own scheduling metadata —
// nothing here originates from email content.

export type LeaveType = 'annual' | 'sick' | 'conference' | 'pd' | 'unpaid';

export interface LeaveBlock {
  id: string;
  startAt: string; // ISO datetime
  endAt: string;   // ISO datetime, exclusive
  leaveType: LeaveType;
  notes: string | null;
}

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  conference: 'Conference',
  pd: 'Professional development',
  unpaid: 'Unpaid leave',
};

let cache: LeaveBlock[] = [];
let hydrationStarted = false;
let hydrationDone = false;
const listeners = new Set<() => void>();

function emit() {
  cache = [...cache];
  listeners.forEach((l) => l());
}

// Per-block write chain — same reason as the other stores: prevent
// two rapid edits on the same id from being reordered on the wire.
const writeChains = new Map<string, Promise<unknown>>();
function chainWrite(id: string, run: () => Promise<unknown>) {
  const prev = writeChains.get(id) ?? Promise.resolve();
  const next = prev.then(run).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[leaveBlocksStore] persist failed for ${id}`, err);
  });
  writeChains.set(id, next);
}

function persist(b: LeaveBlock) {
  chainWrite(b.id, () =>
    upsertLeaveBlock(encodeURIComponent(b.id), {
      startAt: b.startAt,
      endAt: b.endAt,
      leaveType: b.leaveType,
      notes: b.notes,
    }),
  );
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listLeaveBlocks();
    const existingIds = new Set(cache.map((t) => t.id));
    for (const r of rows) {
      if (existingIds.has(r.id)) continue;
      cache.push({
        id: r.id,
        startAt: r.startAt,
        endAt: r.endAt,
        leaveType: r.leaveType,
        notes: r.notes ?? null,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[leaveBlocksStore] failed to hydrate', err);
  } finally {
    hydrationDone = true;
    emit();
  }
}

export function addLeaveBlock(input: {
  startAt: string;
  endAt: string;
  leaveType: LeaveType;
  notes?: string | null;
}): LeaveBlock {
  const block: LeaveBlock = {
    id: `lv${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    startAt: input.startAt,
    endAt: input.endAt,
    leaveType: input.leaveType,
    notes: input.notes ?? null,
  };
  cache = [...cache, block].sort((a, b) => a.startAt.localeCompare(b.startAt));
  listeners.forEach((l) => l());
  persist(block);
  return block;
}

export function removeLeaveBlock(id: string): void {
  const had = cache.some((b) => b.id === id);
  if (!had) return;
  cache = cache.filter((b) => b.id !== id);
  listeners.forEach((l) => l());
  chainWrite(id, () => deleteLeaveBlock(encodeURIComponent(id)));
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) void hydrate();
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;

export function useLeaveBlocks(): LeaveBlock[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isLeaveHydrated(): boolean {
  return hydrationDone;
}

// ---- Resolver helpers (pure) -----------------------------------------------

// Compute minutes of overlap between [dayStart, dayEnd) and a leave
// block [block.startAt, block.endAt). Used to reduce minutesAvailable
// on the affected day — full-day leave drives availability to 0;
// half-days reduce proportionally based on share of the working
// window.
//
// `workingMinutes` is the clinician's normal admin minutes for the
// day BEFORE leave is applied — we scale by the leave's share of a
// notional 8-hour (480-min) working day, capped at the day's actual
// availability. Rationale: a 4h sick day on a 2h admin day shouldn't
// be allowed to push availability negative.
export function leaveMinutesForDay(
  dayKey: string, // 'YYYY-MM-DD' local
  blocks: readonly LeaveBlock[],
  workingMinutes: number,
): number {
  if (workingMinutes <= 0 || blocks.length === 0) return 0;
  // Local midnight to next local midnight. We construct dayEnd via the
  // calendar (year/month/day+1) rather than dayStart + 24h so DST
  // transitions don't shift the boundary by an hour. On the spring/
  // autumn DST days the local day length is 23h/25h respectively;
  // adding 86_400_000 ms would land at 23:00 or 01:00 of the next
  // local day and misattribute an hour of overlap. parseDayKey returns
  // an exclusive next-midnight too.
  const bounds = parseDayBounds(dayKey);
  if (!bounds) return 0;
  const { dayStart, dayEnd } = bounds;

  let overlapMs = 0;
  for (const b of blocks) {
    const s = new Date(b.startAt).getTime();
    const e = new Date(b.endAt).getTime();
    const lo = Math.max(s, dayStart.getTime());
    const hi = Math.min(e, dayEnd.getTime());
    if (hi > lo) overlapMs += hi - lo;
  }
  if (overlapMs <= 0) return 0;
  const overlapMin = Math.round(overlapMs / 60000);
  // Treat overlap as a share of an 8-hour working day. If the leave
  // covers the whole calendar day (>= 8h), zero the day out.
  const NOMINAL_WORK_DAY_MIN = 8 * 60;
  if (overlapMin >= NOMINAL_WORK_DAY_MIN) return workingMinutes;
  const share = overlapMin / NOMINAL_WORK_DAY_MIN;
  return Math.min(workingMinutes, Math.round(workingMinutes * share));
}

// Returns the leave block(s) that touch a given local day. Used by
// the calendar UI to render the "On leave" pill.
export function leaveBlocksForDay(
  dayKey: string,
  blocks: readonly LeaveBlock[],
): LeaveBlock[] {
  const bounds = parseDayBounds(dayKey);
  if (!bounds) return [];
  const { dayStart, dayEnd } = bounds;
  return blocks.filter((b) => {
    const s = new Date(b.startAt).getTime();
    const e = new Date(b.endAt).getTime();
    return e > dayStart.getTime() && s < dayEnd.getTime();
  });
}

// ---- Return-from-leave helpers ---------------------------------------------
//
// Surfaces "the first day you're back from leave" so the clinician sees
// the backlog landing on that day instead of being ambushed by it. Pure
// derivations from leave blocks + the working-day pattern — no planner
// changes, no PlannerOutput shape change. The Calendar / LeavePanel
// consume these for advisory pills only.

export interface ReturnFromLeaveInfo {
  // Count of preceding *working* days that were fully on leave. Weekends
  // (or other non-working weekdays per the clinician's pattern) sitting
  // between the leave and the return day are transparent — they don't
  // count toward daysAway but don't break the chain either.
  daysAway: number;
  // The distinct leave types that contributed to the run, deduped in
  // the order encountered walking backwards. Useful so the UI can say
  // "Back from annual leave" vs a generic label.
  leaveTypes: LeaveType[];
  // IDs of the leave blocks that contributed. Lets the LeavePanel
  // cross-reference "day back" against the block the user is hovering.
  precedingBlockIds: string[];
}

// Step a 'YYYY-MM-DD' key by ±1 calendar day in local time (DST-safe via
// the Date calendar constructor).
function shiftDayKey(dayKey: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays, 0, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Format a YYYY-MM-DD key into the short weekday label the WeekSetup
// uses ('Mon', 'Tue', ...). Matches the en-GB short weekday format used
// elsewhere in the app so callers can pass `new Set(weekSetup.days)`
// straight through.
function weekdayShort(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', {
    weekday: 'short',
  });
}

// For each date in `dates`, decide whether it's a "return-from-leave" day
// and how many working days were lost to leave immediately before it.
//
// A date qualifies when:
//   - it is itself a working day per the schedule pattern
//   - it has no leave block touching it
//   - the immediately preceding working day(s) were fully on leave
//
// Walks backward up to 60 calendar days (any realistic clinical leave run).
//
// The returned Map only contains entries for qualifying dates — callers
// can treat absence as "not a return day".
export function computeReturnFromLeave(
  dates: readonly string[],
  blocks: readonly LeaveBlock[],
  workingWeekdays: ReadonlySet<string>,
): Map<string, ReturnFromLeaveInfo> {
  const out = new Map<string, ReturnFromLeaveInfo>();
  if (workingWeekdays.size === 0 || blocks.length === 0) return out;
  for (const dayKey of dates) {
    if (!workingWeekdays.has(weekdayShort(dayKey))) continue;
    if (leaveBlocksForDay(dayKey, blocks).length > 0) continue;
    // v1 "fully on leave" heuristic: ANY block overlap with the day
    // counts. This matches today's LeavePanel which only creates
    // full-day 09–17 blocks. When half-day support lands the inner
    // walk-back below will need to compare leaveMinutesForDay against
    // the day's working minutes instead, so an afternoon-only block
    // doesn't falsely flag the next morning as day-back.
    let cursor = shiftDayKey(dayKey, -1);
    let daysAway = 0;
    const types: LeaveType[] = [];
    const blockIds: string[] = [];
    const seenTypes = new Set<LeaveType>();
    const seenIds = new Set<string>();
    for (let cap = 0; cap < 60; cap++) {
      const onPrev = leaveBlocksForDay(cursor, blocks);
      const isWorking = workingWeekdays.has(weekdayShort(cursor));
      if (onPrev.length > 0) {
        if (isWorking) {
          daysAway++;
          for (const b of onPrev) {
            if (!seenIds.has(b.id)) {
              seenIds.add(b.id);
              blockIds.push(b.id);
            }
            if (!seenTypes.has(b.leaveType)) {
              seenTypes.add(b.leaveType);
              types.push(b.leaveType);
            }
          }
        }
        cursor = shiftDayKey(cursor, -1);
        continue;
      }
      if (!isWorking) {
        // Non-working day with no leave — transparent (weekend between
        // a Friday leave and Monday return shouldn't break the chain).
        cursor = shiftDayKey(cursor, -1);
        continue;
      }
      // Working day with no leave — chain broken.
      break;
    }
    if (daysAway > 0) {
      out.set(dayKey, { daysAway, leaveTypes: types, precedingBlockIds: blockIds });
    }
  }
  return out;
}

// First working day at-or-after `endAtIso`. Used by LeavePanel to show
// "Day back: <weekday date>" next to each leave block so the clinician
// can see when the backlog will land. Returns null if no working day is
// found within the next 60 calendar days (defensive cap matching the
// computeReturnFromLeave look-back).
export function nextWorkingDayAfter(
  endAtIso: string,
  workingWeekdays: ReadonlySet<string>,
  blocks: readonly LeaveBlock[],
): string | null {
  if (workingWeekdays.size === 0) return null;
  // endAt is exclusive. Start from the local calendar day that contains
  // endAt minus one minute (so an endAt of 17:00 Friday still anchors on
  // Friday) and step forward from there.
  const anchor = new Date(new Date(endAtIso).getTime() - 60_000);
  let cursor = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(anchor.getDate()).padStart(2, '0')}`;
  cursor = shiftDayKey(cursor, 1);
  for (let cap = 0; cap < 60; cap++) {
    const working = workingWeekdays.has(weekdayShort(cursor));
    const onLeave = leaveBlocksForDay(cursor, blocks).length > 0;
    if (working && !onLeave) return cursor;
    cursor = shiftDayKey(cursor, 1);
  }
  return null;
}

// Parse 'YYYY-MM-DD' to the half-open local-midnight bounds of that
// calendar day. DST-safe — both endpoints are constructed via the
// Date calendar constructor so the boundary lands on real local
// midnight even when the day is 23h or 25h long.
function parseDayBounds(s: string): { dayStart: Date; dayEnd: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return {
    dayStart: new Date(y, mo - 1, d, 0, 0, 0, 0),
    dayEnd: new Date(y, mo - 1, d + 1, 0, 0, 0, 0),
  };
}
