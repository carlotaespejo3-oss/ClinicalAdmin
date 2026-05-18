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
