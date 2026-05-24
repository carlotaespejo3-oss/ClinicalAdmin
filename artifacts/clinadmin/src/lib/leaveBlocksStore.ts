import { useSyncExternalStore } from 'react';
import {
  listLeaveBlocks,
  upsertLeaveBlock,
  deleteLeaveBlock,
} from '@workspace/api-client-react';
import type { AiCategory } from '@/lib/types';

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

const VALID_LEAVE_TYPES = new Set<string>(['annual', 'sick', 'conference', 'pd', 'unpaid']);

function isValidRow(r: { startAt?: unknown; endAt?: unknown; leaveType?: unknown }): boolean {
  if (typeof r.startAt !== 'string' || isNaN(Date.parse(r.startAt))) return false;
  if (typeof r.endAt   !== 'string' || isNaN(Date.parse(r.endAt)))   return false;
  if (typeof r.leaveType !== 'string' || !VALID_LEAVE_TYPES.has(r.leaveType)) return false;
  return true;
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listLeaveBlocks();
    const existingIds = new Set(cache.map((t) => t.id));
    for (const r of rows) {
      if (existingIds.has(r.id)) continue;
      // Auto-purge rows that were saved with a stale/invalid schema so
      // they don't crash components expecting valid dates and leaveType.
      if (!isValidRow(r)) {
        // eslint-disable-next-line no-console
        console.warn('[leaveBlocksStore] purging corrupt leave block', r.id, r);
        deleteLeaveBlock(encodeURIComponent(r.id)).catch(() => undefined);
        continue;
      }
      cache.push({
        id: r.id,
        startAt: r.startAt as string,
        endAt: r.endAt as string,
        leaveType: r.leaveType as LeaveType,
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
  cache = [...cache, block].sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''));
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
  // UTC midnight to next UTC midnight. parseDayBounds uses setUTCDate
  // for dayEnd so the boundary is always exactly 86_400_000 ms later —
  // UTC has no DST, so there are no 23h or 25h days to worry about.
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

// Step a 'YYYY-MM-DD' key by ±1 calendar day. UTC-anchored to match
// availability.ts's addDays — setUTCDate handles month/year rollovers
// correctly and is immune to DST because UTC has no DST.
function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(dayKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Format a YYYY-MM-DD key into the short weekday label the WeekSetup
// uses ('Mon', 'Tue', ...). We anchor to noon UTC (T12:00:00Z) before
// calling toLocaleDateString — noon UTC is well within every timezone's
// version of the same calendar day (offsets range ±14h; noon UTC lands
// between 10pm the previous day and 2am the next, so for all practical
// UTC offsets the local date matches the key). Using midnight UTC would
// risk returning the previous day's name for zones west of UTC.
function weekdayShort(dayKey: string): string {
  return new Date(dayKey + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
  });
}

// For each date in `dates`, decide whether it's a "return-from-leave" day
// and how many working days were lost to leave immediately before it.
//
// A date qualifies when:
//   - it is itself a working day per the schedule pattern
//   - it has no leave covering its full working window
//   - the immediately preceding working day(s) were fully on leave
//
// "Fully on leave" is decided with workingMinutesByWeekday when provided:
// a day counts as fully on leave when leaveMinutesForDay >= 95% of its
// working minutes (small fuzz tolerates rounding from the 8h-nominal
// share calculation). Without the map, any overlap counts — the v1
// heuristic, kept for tests / callers that don't track minutes.
//
// Walks backward up to 60 calendar days (any realistic clinical leave run).
//
// The returned Map only contains entries for qualifying dates — callers
// can treat absence as "not a return day".
export function computeReturnFromLeave(
  dates: readonly string[],
  blocks: readonly LeaveBlock[],
  workingWeekdays: ReadonlySet<string>,
  workingMinutesByWeekday?: ReadonlyMap<string, number>,
): Map<string, ReturnFromLeaveInfo> {
  const out = new Map<string, ReturnFromLeaveInfo>();
  if (workingWeekdays.size === 0 || blocks.length === 0) return out;

  // Resolve "is this day fully on leave?" using the minutes map when
  // present. A half-day morning block on a 4h admin day must NOT count
  // as a full leave day — otherwise the afternoon (still bookable)
  // would be wrongly attributed to leave and the next morning would
  // falsely appear as "day back".
  const fullyOnLeave = (dayKey: string): boolean => {
    const onDay = leaveBlocksForDay(dayKey, blocks);
    if (onDay.length === 0) return false;
    if (!workingMinutesByWeekday) return true; // v1 fallback
    const wkd = weekdayShort(dayKey);
    const workMin = workingMinutesByWeekday.get(wkd) ?? 0;
    if (workMin <= 0) return false; // not a working day
    const leaveMin = leaveMinutesForDay(dayKey, blocks, workMin);
    return leaveMin >= workMin * 0.95;
  };

  // "Is the current day a candidate return day?" Same logic but
  // inverted — a day that's NOT fully on leave (could be all clear,
  // could be half-day) is a candidate return day. We additionally
  // require no overlap at all here so the pill never lights up on a
  // day the clinician is themselves still partially on leave; if you
  // had a morning off, the afternoon isn't a "first day back".
  for (const dayKey of dates) {
    if (!workingWeekdays.has(weekdayShort(dayKey))) continue;
    if (leaveBlocksForDay(dayKey, blocks).length > 0) continue;
    let cursor = shiftDayKey(dayKey, -1);
    let daysAway = 0;
    const types: LeaveType[] = [];
    const blockIds: string[] = [];
    const seenTypes = new Set<LeaveType>();
    const seenIds = new Set<string>();
    for (let cap = 0; cap < 60; cap++) {
      const isWorking = workingWeekdays.has(weekdayShort(cursor));
      if (fullyOnLeave(cursor)) {
        if (isWorking) {
          daysAway++;
          for (const b of leaveBlocksForDay(cursor, blocks)) {
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
      // Working day not fully on leave — chain broken. A partial
      // (half-day) leave here is treated the same as a full normal
      // day: the clinician was at least partly working, so the next
      // working day isn't "back from leave" relative to it.
      break;
    }
    if (daysAway > 0) {
      out.set(dayKey, { daysAway, leaveTypes: types, precedingBlockIds: blockIds });
    }
  }
  return out;
}

// ---- Current leave status ---------------------------------------------------
//
// Used by Home dashboard to surface a banner so the clinician knows
// "you're on leave right now" or "you're back today" without having to
// hunt through the calendar.

export type CurrentLeaveState =
  | { state: 'on-leave-today'; block: LeaveBlock; dayBackKey: string | null }
  | { state: 'back-today'; daysAway: number; leaveTypes: LeaveType[] }
  | { state: 'leave-starts-soon'; block: LeaveBlock; daysUntil: number }
  | { state: 'none' };

// Resolve the clinician's leave state RELATIVE to a given local "today".
// Priorities (first match wins): on-leave-today > back-today >
// leave-starts-soon (next 7 days) > none. Pure — used by the Home
// banner; no React, no DOM.
export function currentLeaveStatus(
  today: Date,
  blocks: readonly LeaveBlock[],
  workingWeekdays: ReadonlySet<string>,
  workingMinutesByWeekday?: ReadonlyMap<string, number>,
): CurrentLeaveState {
  if (blocks.length === 0) return { state: 'none' };
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // 1. On leave today? Match the first block that touches today.
  // For partial-day leave (e.g. morning only) we DO NOT raise the
  // on-leave banner — the afternoon is still bookable and the
  // "planner has paused admin time" copy would be misleading. Gate
  // the banner on leave covering ~all of today's working minutes,
  // using the same 95% threshold as computeReturnFromLeave so the
  // two surfaces stay in lockstep. Without a minutes map we keep
  // the v1 behaviour (any overlap → on-leave) so existing callers
  // and tests don't regress.
  const onToday = leaveBlocksForDay(todayKey, blocks);
  if (onToday.length > 0) {
    let coversFullDay = true;
    if (workingMinutesByWeekday) {
      const wkd = weekdayShort(todayKey);
      const workMin = workingMinutesByWeekday.get(wkd) ?? 0;
      if (workMin > 0) {
        const leaveMin = leaveMinutesForDay(todayKey, blocks, workMin);
        coversFullDay = leaveMin >= workMin * 0.95;
      }
      // workMin === 0 → not a working day at all; leave on a non-working
      // day still legitimately raises the banner (e.g. weekend trip).
    }
    if (coversFullDay) {
      // Pick the block whose endAt is latest — that's the one whose
      // "day back" is most informative for a chained run.
      const block = [...onToday].sort((a, b) => b.endAt.localeCompare(a.endAt))[0];
      const dayBackKey = nextWorkingDayAfter(block.endAt, workingWeekdays, blocks);
      return { state: 'on-leave-today', block, dayBackKey };
    }
    // Partial-day overlap: fall through. We do NOT raise back-today
    // either (the clinician is still partly on leave); the next
    // checks naturally land on 'leave-starts-soon' for tomorrow's
    // leave or 'none' if today is just a half-day.
  }

  // 2. Back today? Compute the return-from-leave entry for today.
  if (workingWeekdays.has(weekdayShort(todayKey))) {
    const map = computeReturnFromLeave([todayKey], blocks, workingWeekdays, workingMinutesByWeekday);
    const back = map.get(todayKey);
    if (back) {
      return { state: 'back-today', daysAway: back.daysAway, leaveTypes: back.leaveTypes };
    }
  }

  // 3. Leave starting in the next 7 calendar days? Pick the earliest
  // upcoming block whose start is within the window.
  const horizonMs = today.getTime() + 7 * 86_400_000;
  let upcoming: LeaveBlock | null = null;
  for (const b of blocks) {
    const start = new Date(b.startAt).getTime();
    if (start > today.getTime() && start <= horizonMs) {
      if (!upcoming || start < new Date(upcoming.startAt).getTime()) upcoming = b;
    }
  }
  if (upcoming) {
    // Days-until is a calendar-day delta, not a raw 24h count — a leave
    // block starting at 23:59 today is "0 days away", not "in 24 hours".
    // We anchor both sides to UTC midnight (matching parseDayBounds and
    // availability.ts) so the subtraction is always an exact multiple of
    // 86_400_000 ms with no DST jitter.
    const startMidnight = new Date(upcoming.startAt.slice(0, 10) + 'T00:00:00Z');
    const todayMidnight = new Date(todayKey + 'T00:00:00Z');
    const daysUntil = Math.round((startMidnight.getTime() - todayMidnight.getTime()) / 86_400_000);
    return { state: 'leave-starts-soon', block: upcoming, daysUntil };
  }

  return { state: 'none' };
}

// ---- Day-within-leave context ---------------------------------------------
//
// For multi-day leave blocks, returns the 1-based "day N of M" position
// of `dayKey` inside the longest block that covers it. Used by the
// Calendar pill so a 5-day annual holiday reads "On leave · Annual ·
// day 3 of 5" instead of looking like a generic disconnected pill.
// Counts CALENDAR days (not working days) so a Mon–Fri week of leave
// reads "Day 3 of 5" on Wednesday — matches what the clinician sees in
// the calendar grid.

export interface DayWithinLeaveInfo {
  block: LeaveBlock;
  index: number; // 1-based
  total: number;
}

export function dayWithinLeave(
  dayKey: string,
  blocks: readonly LeaveBlock[],
): DayWithinLeaveInfo | null {
  const onDay = leaveBlocksForDay(dayKey, blocks);
  if (onDay.length === 0) return null;
  let best: DayWithinLeaveInfo | null = null;
  for (const b of onDay) {
    // Use UTC getters — startAt/endAt are UTC-midnight ISO timestamps
    // so toISOString().slice(0,10) gives the correct UTC date string.
    const startKey = b.startAt.slice(0, 10);
    // endAt is exclusive; subtract one minute to land on the last covered
    // day, then take the UTC date.
    const e = new Date(new Date(b.endAt).getTime() - 60_000);
    const endKey = e.toISOString().slice(0, 10);
    const totalMs = parseDayBounds(endKey)!.dayStart.getTime() - parseDayBounds(startKey)!.dayStart.getTime();
    const total = Math.round(totalMs / 86_400_000) + 1;
    const indexMs = parseDayBounds(dayKey)!.dayStart.getTime() - parseDayBounds(startKey)!.dayStart.getTime();
    const index = Math.round(indexMs / 86_400_000) + 1;
    if (total <= 1) continue; // single-day blocks don't need "day 1 of 1"
    if (!best || total > best.total) {
      best = { block: b, index, total };
    }
  }
  return best;
}

// ---- Items at risk before leave -------------------------------------------
//
// For each item with a deadline, decide whether that deadline lands
// inside an upcoming leave block within `horizonDays`. Used by Home to
// warn "X tasks will fall due while you're away" — the clinician can
// then choose to do them early, defer formally, or accept the breach.
//
// Generic over the item shape — caller passes whichever store records
// it needs (manual tasks, sidebar tasks, linked-doc tasks); each entry
// supplies its title plus a deadline expressed either as a number of
// days-from-today OR as a YYYY-MM-DD date. Pure.

export interface AtRiskInput {
  id: string;
  title: string;
  /** Days from today; 0 = today, negative = overdue. Mutually exclusive with deadlineDate. */
  deadlineDays?: number;
  /** 'YYYY-MM-DD' local. Mutually exclusive with deadlineDays. */
  deadlineDate?: string;
  /**
   * The item's clinical category. When present, items in the LOW priority band
   * (ADMIN, CPD, NONE, UNCLEAR) are excluded from pre-leave warnings — a 4-week
   * leave would otherwise surface every routine email as "at risk", which is noise.
   * Leave category undefined to include all items regardless of band (legacy behaviour).
   */
  category?: AiCategory;
}

// Priority bands used to sort and filter at-risk items.
// HIGH  → always surface, most urgent first.
// MEDIUM → surface, lower rank than HIGH.
// LOW   → filtered out when category is known (routine work can wait / be delegated).
const HIGH_BAND = new Set<AiCategory>(['SAFEGUARDING', 'URGENT_CLINICAL', 'LEGAL']);
const MEDIUM_BAND = new Set<AiCategory>(['CLINICAL', 'PROFESSIONAL']);
const LOW_BAND = new Set<AiCategory>(['ADMIN', 'CPD', 'NONE', 'UNCLEAR']);

function bandRank(cat: AiCategory | undefined): number {
  if (!cat) return 1; // unknown → treat as medium so it still surfaces
  if (HIGH_BAND.has(cat)) return 0;
  if (MEDIUM_BAND.has(cat)) return 1;
  return 2; // LOW_BAND
}

export interface AtRiskResult {
  item: AtRiskInput;
  block: LeaveBlock;
  // The local YYYY-MM-DD date the deadline falls on.
  deadlineKey: string;
}

export function itemsAtRiskBeforeLeave(
  today: Date,
  blocks: readonly LeaveBlock[],
  items: readonly AtRiskInput[],
  horizonDays = 14,
  maxItems = 5,
): AtRiskResult[] {
  if (blocks.length === 0 || items.length === 0) return [];
  // Anchor to UTC midnight so deadline comparisons use the same epoch
  // reference as parseDayBounds and availability.ts. UTC days are always
  // exactly 86_400_000 ms, so adding deadlineDays * 86_400_000 is exact.
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayMid = new Date(todayStr + 'T00:00:00Z');
  const horizonMs = todayMid.getTime() + horizonDays * 86_400_000;
  const out: AtRiskResult[] = [];

  for (const it of items) {
    // When the category is known, skip LOW-band items entirely. A 4-week
    // leave would otherwise surface every routine admin email as "at risk"
    // — clinical deadlines and legal items are what the clinician actually
    // needs to clear before going away.
    if (it.category && LOW_BAND.has(it.category)) continue;

    let deadlineMid: Date | null = null;
    if (typeof it.deadlineDays === 'number') {
      deadlineMid = new Date(todayMid.getTime() + it.deadlineDays * 86_400_000);
    } else if (it.deadlineDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.deadlineDate);
      if (m) deadlineMid = new Date(it.deadlineDate + 'T00:00:00Z');
    }
    if (!deadlineMid) continue;
    if (deadlineMid.getTime() < todayMid.getTime()) continue; // already overdue — separate problem
    if (deadlineMid.getTime() > horizonMs) continue;

    // deadlineMid is UTC-midnight anchored — use toISOString to get the
    // UTC date string, matching parseDayBounds and leaveBlocksForDay.
    const deadlineKey = deadlineMid.toISOString().slice(0, 10);

    // Does the deadline day fall within an upcoming leave block?
    // Only count blocks that START AFTER today — leave already in
    // progress isn't the "finish-line" we're warning about.
    for (const b of blocks) {
      const blockStart = new Date(b.startAt).getTime();
      if (blockStart <= today.getTime()) continue;
      const onDay = leaveBlocksForDay(deadlineKey, [b]);
      if (onDay.length > 0) {
        out.push({ item: it, block: b, deadlineKey });
        break; // first matching block wins
      }
    }
  }

  // Sort: clinical urgency band first (HIGH → MEDIUM → LOW/unknown),
  // then deadline soonest-first within each band. This surfaces a
  // safeguarding deadline before a routine clinical one even if the
  // latter is slightly sooner, so the "3 things to sort before you go"
  // list reads in priority order rather than calendar order.
  out.sort((a, b) => {
    const bandDiff = bandRank(a.item.category) - bandRank(b.item.category);
    if (bandDiff !== 0) return bandDiff;
    return a.deadlineKey.localeCompare(b.deadlineKey);
  });

  return out.slice(0, maxItems);
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
  // endAt is exclusive and stored as a UTC-midnight ISO timestamp
  // (e.g. "2026-06-13T00:00:00Z" = leave covers up to, not including,
  // June 13th → first candidate day IS June 13th).
  // For robustness with legacy or partial-day endAt values that are not
  // exactly UTC midnight, subtract one minute so we anchor on the last
  // covered day, then shift forward one day to the first candidate.
  const endMs = new Date(endAtIso).getTime();
  const endDateStr = endAtIso.slice(0, 10);
  const isExactMidnight = endMs === new Date(endDateStr + 'T00:00:00Z').getTime();
  // Exact UTC midnight: the endAt date itself is the first candidate.
  // Non-midnight (legacy): subtract a minute, take UTC date, shift +1.
  let cursor: string;
  if (isExactMidnight) {
    cursor = endDateStr;
  } else {
    cursor = shiftDayKey(new Date(endMs - 60_000).toISOString().slice(0, 10), 1);
  }
  for (let cap = 0; cap < 60; cap++) {
    const working = workingWeekdays.has(weekdayShort(cursor));
    const onLeave = leaveBlocksForDay(cursor, blocks).length > 0;
    if (working && !onLeave) return cursor;
    cursor = shiftDayKey(cursor, 1);
  }
  return null;
}

// Parse 'YYYY-MM-DD' to the half-open UTC-midnight bounds of that
// calendar day. UTC-anchored (T00:00:00Z) to match availability.ts
// throughout — leave blocks are stored as UTC-midnight ISO timestamps,
// so day boundaries must use the same epoch reference or overlap checks
// can mis-attribute a day by one hour for BST clinicians. setUTCDate
// handles month/year rollovers without DST interference (UTC has no DST).
function parseDayBounds(s: string): { dayStart: Date; dayEnd: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dayStart = new Date(s + 'T00:00:00Z');
  const dayEnd = new Date(s + 'T00:00:00Z');
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return { dayStart, dayEnd };
}
