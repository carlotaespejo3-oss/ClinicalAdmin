// 14-day rolling inbox planner — deterministic scheduling logic.
//
// This file is the *core* of the planner: a pure function that takes the
// current inbox, manual tasks, the clinician's availability over the next
// 14 days, and projected weekly arrivals, and produces:
//
//   - today's plan (an ordered list of items to do today)
//   - the 14-day runway (per-day workload vs available time)
//   - an overall status (green / amber / red)
//   - breach detection (anything that won't fit before its SLA)
//   - the projected workload reservation (capacity held back for emails
//     that haven't arrived yet)
//
// Step 1 of the spec: NO UI. UI consumers will live in components/tabs
// and call buildPlan(input). Tests in planner.test.ts cover the rules.
//
// Design notes
// - Pure: no React, no DOM, no fetch. Easy to test, easy to reason about.
// - The clinician's "today" is an explicit input — never read system
//   clock here. The UI passes new Date() at render time.
// - Pairs (linked email + doc task) always travel together — placed on
//   the same day or both deferred. No partial placement.
// - Low-priority allocation is a hard daily reservation (DAILY_LOW_*)
//   per spec: "Every day with any admin time must include at least 15
//   minutes of low priority email clearing, regardless of how many
//   urgent or medium items exist."
// - ONLY overdue items may dip into the protected low-quota slot —
//   their SLA is already violated, so any further delay is worse than
//   displacing 15 min of low-priority clearing. Urgent items have a
//   48h window and are postponed to the next admin day instead of
//   cannibalising today's low quota. Medium items may NOT dip either,
//   per spec: "always keep the Step 5 low priority allocation even if
//   it means deferring some medium priority items."

import type { AiCategory } from './types';

// ============================================================================
// Configuration
// ============================================================================

// SLA in days from today for each category. Drives derived deadlines when
// an email doesn't carry its own.
export const SLA_DAYS_BY_CATEGORY: Record<AiCategory, number> = {
  SAFEGUARDING: 1,
  URGENT_CLINICAL: 2,
  LEGAL: 2,
  CLINICAL: 7,
  PROFESSIONAL: 7,
  ADMIN: 14,
  CPD: 14,
  NONE: 14,
  UNCLEAR: 1,
};

// Daily non-negotiable low-priority allocation in minutes. Every day with
// any admin time gets this much reserved up-front for low-priority items.
export const DAILY_LOW_PRIORITY_RESERVATION_MIN = 15;

// Default projected weekly arrivals — clinician receives ~60 emails/week.
// Tiered buffer model (replaces the old flat 45-min/day reserve which
// felt punitive and created false anxiety):
//   - URGENT: 10 min reserved on each future admin day. Rationale —
//     ~5 high-priority emails/wk ÷ 5 working days ≈ 1 urgent email/day,
//     at ~10 min each. This is the only same-day reserve.
//   - MEDIUM: a single 30-min block somewhere in the week, placed on
//     whichever future admin day has the most spare capacity. Medium
//     emails have a 5-7 day SLA, so they don't need same-day time.
//   - LOW: NO extra reserve. Already covered by the existing daily
//     15-min low-priority allocation (see DAILY_LOW_PRIORITY_RESERVATION_MIN).
//     14-day SLA means arrivals this week can clear next week.
// Configurable per-call — pass a different ArrivalConfig to override.
export const DEFAULT_ARRIVAL_CONFIG: ArrivalConfig = {
  emailsPerWeek: 60,
  highPerWeek: 5,
  mediumPerWeek: 10,
  urgentDailyReserveMin: 10,
  mediumWeeklyReserveMin: 30,
};

// Number of days the planner looks ahead. Spec calls for a 14-day
// rolling view.
export const RUNWAY_DAYS = 14;

// ============================================================================
// Types — inputs
// ============================================================================

export interface ArrivalConfig {
  emailsPerWeek: number;
  highPerWeek: number;
  mediumPerWeek: number;
  /** Minutes reserved on EACH future admin day for one urgent arrival. */
  urgentDailyReserveMin: number;
  /** Minutes reserved ONCE per week (single block, busiest admin day) for medium arrivals. */
  mediumWeeklyReserveMin: number;
}

export interface PlannerEmail {
  id: number;
  subject: string;
  from: string;
  category: AiCategory;
  estMin: number;
  // Days from today until the SLA bites. Negative = overdue. If null,
  // derived from the category's SLA.
  deadlineDays: number | null;
  // True if the AI returned UNCLEAR — gates the plan until classified.
  unclear: boolean;
}

export interface PlannerTask {
  id: string;
  title: string;
  category: AiCategory;
  estMin: number;
  deadlineDays: number;
  // If set, this task is a linked-doc / paired follow-up to that email
  // and must travel on the same day as it.
  linkedEmailId: number | null;
}

export interface DayAvailability {
  date: string;          // ISO 'YYYY-MM-DD'
  dayLabel: string;      // 'Mon', 'Tue', ...
  displayLabel: string;  // 'Mon 11 May'
  minutesAvailable: number;
}

export interface PlannerInput {
  today: Date;
  emails: PlannerEmail[];
  tasks: PlannerTask[];
  availability: DayAvailability[];
  arrivals?: ArrivalConfig;
}

// ============================================================================
// Types — outputs
// ============================================================================

export type ItemReasonKind =
  | 'unclear_gate'
  | 'overdue'
  | 'due_today'
  | 'due_tomorrow'
  | 'high_priority'
  | 'medium_progressing'
  | 'low_daily'
  | 'linked_task';

export interface PlanItem {
  kind: 'email' | 'task' | 'unclear_gate';
  refId: number | string | null;
  title: string;
  detail: string;
  category: AiCategory;
  estMin: number;
  reason: ItemReasonKind;
  reasonText: string;
  daysOverdue?: number;
  linkedToEmailId?: number;
}

export type DayStatus = 'safe' | 'tight' | 'breach' | 'idle';

export interface DailyPlan {
  dayIndex: number;        // 0 = today
  date: string;
  dayLabel: string;
  displayLabel: string;
  minutesAvailable: number;
  items: PlanItem[];
  totalPlannedMin: number;
  bufferMin: number;
  status: DayStatus;
  flags: string[];
}

export type OverallStatus = 'green' | 'amber' | 'red';

export interface BreachInfo {
  itemId: number | string;
  title: string;
  category: AiCategory;
  deadlineDays: number;
  reason: 'already_overdue' | 'no_capacity_before_sla';
}

export interface ProjectedReservation {
  highCount: number;
  mediumCount: number;
  lowCount: number;
  /** Per-day urgent reserve setting (minutes). */
  urgentDailyReserveMin: number;
  /** Single weekly medium-arrival reserve (minutes). */
  mediumWeeklyReserveMin: number;
  /** Number of future admin days the urgent reserve was applied to. */
  adminDayCount: number;
  /** Actual total minutes held back across the week (sum of all reserves applied). */
  totalReserveMin: number;
}

export interface PlannerOutput {
  todayDate: string;
  unclearCount: number;
  unclearEmailIds: number[];
  todaysPlan: DailyPlan;
  runway: DailyPlan[];
  overallStatus: OverallStatus;
  statusHeadline: string;
  statusDetail: string;
  recommendation: string | null;
  breaches: BreachInfo[];
  deferredItems: PlanItem[];
  reservation: ProjectedReservation;
  weeklyCapacityMin: number;
  weeklyDemandMin: number;
}

// ============================================================================
// Helpers
// ============================================================================

const URGENT_CATEGORIES: ReadonlySet<AiCategory> = new Set<AiCategory>([
  'SAFEGUARDING', 'URGENT_CLINICAL', 'LEGAL',
]);
const MEDIUM_CATEGORIES: ReadonlySet<AiCategory> = new Set<AiCategory>([
  'CLINICAL', 'PROFESSIONAL',
]);
const LOW_CATEGORIES: ReadonlySet<AiCategory> = new Set<AiCategory>([
  'ADMIN', 'CPD', 'NONE',
]);

export type PriorityBand = 'urgent' | 'medium' | 'low' | 'unclear';

export function priorityBand(cat: AiCategory): PriorityBand {
  if (URGENT_CATEGORIES.has(cat)) return 'urgent';
  if (MEDIUM_CATEGORIES.has(cat)) return 'medium';
  if (LOW_CATEGORIES.has(cat)) return 'low';
  return 'unclear';
}

export function deriveDeadlineDays(input: {
  category: AiCategory;
  deadlineDays: number | null;
}): number {
  if (input.deadlineDays != null) return input.deadlineDays;
  return SLA_DAYS_BY_CATEGORY[input.category];
}

const CAT_RANK: Record<AiCategory, number> = {
  SAFEGUARDING: 0,
  URGENT_CLINICAL: 1,
  LEGAL: 2,
  CLINICAL: 3,
  PROFESSIONAL: 4,
  ADMIN: 5,
  CPD: 6,
  NONE: 7,
  UNCLEAR: 8,
};

function fmtH(min: number): string {
  if (min < 60) return `${Math.round(min)}min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

// Build a 14-day availability array starting at `today`. `hoursByDay`
// maps day labels (Mon/Tue/...) to total daily admin hours. Days not
// in the map default to 0.
export function buildAvailability(
  today: Date,
  hoursByDay: Record<string, number>,
  options: { days?: number } = {},
): DayAvailability[] {
  const days = options.days ?? RUNWAY_DAYS;
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const out: DayAvailability[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dayLabel = dayLabels[d.getDay()];
    const minutes = Math.round((hoursByDay[dayLabel] ?? 0) * 60);
    out.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      dayLabel,
      displayLabel: `${dayLabel} ${d.getDate()} ${months[d.getMonth()]}`,
      minutesAvailable: minutes,
    });
  }
  return out;
}

// ----- Internal mutable form during packing ----------------------------------

interface DailyPlanInternal extends DailyPlan {
  bookableMin: number;
  lowQuotaRemainingMin: number;
}

interface WorkItem {
  source: 'email' | 'task';
  id: number | string;
  title: string;
  detail: string;
  category: AiCategory;
  estMin: number;
  deadlineDays: number;
  linkedEmailId: number | null;
  // Pair id: groups linked email+task so they're scheduled together.
  // For an unlinked email it's the email id; for an unlinked task,
  // the task id; for a linked task and its email, the email id.
  pairId: number | string;
}

interface Pair {
  items: WorkItem[];
  minDeadline: number;
  minCatRank: number;
  totalMin: number;
  band: PriorityBand;
}

function makeWorkItems(input: PlannerInput): WorkItem[] {
  const items: WorkItem[] = [];
  for (const e of input.emails) {
    if (e.unclear) continue; // gated separately
    items.push({
      source: 'email',
      id: e.id,
      title: e.subject || `Email from ${e.from}`,
      detail: e.from,
      category: e.category,
      estMin: e.estMin,
      deadlineDays: deriveDeadlineDays(e),
      linkedEmailId: null,
      pairId: e.id,
    });
  }
  for (const t of input.tasks) {
    items.push({
      source: 'task',
      id: t.id,
      title: t.title,
      detail: '',
      category: t.category,
      estMin: t.estMin,
      deadlineDays: t.deadlineDays,
      linkedEmailId: t.linkedEmailId,
      pairId: t.linkedEmailId != null ? t.linkedEmailId : t.id,
    });
  }
  return items;
}

function buildPairs(items: WorkItem[]): Pair[] {
  const groups = new Map<number | string, WorkItem[]>();
  for (const item of items) {
    const arr = groups.get(item.pairId) ?? [];
    arr.push(item);
    groups.set(item.pairId, arr);
  }
  return Array.from(groups.values()).map((groupItems) => {
    // Sort within a pair: email (lead) before task. Stable.
    groupItems.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'email' ? -1 : 1;
      return 0;
    });
    const minDeadline = Math.min(...groupItems.map((i) => i.deadlineDays));
    const minCatRank = Math.min(...groupItems.map((i) => CAT_RANK[i.category]));
    const totalMin = groupItems.reduce((a, b) => a + b.estMin, 0);
    // Pair's band is the most urgent band of any item in it (so a clinical
    // email with an urgent-ish task lands in urgent).
    const bands = groupItems.map((i) => priorityBand(i.category));
    const band: PriorityBand = bands.includes('urgent')
      ? 'urgent'
      : bands.includes('medium')
        ? 'medium'
        : bands.includes('low')
          ? 'low'
          : 'unclear';
    return { items: groupItems, minDeadline, minCatRank, totalMin, band };
  });
}

function reasonForItem(wi: WorkItem): { kind: ItemReasonKind; text: string } {
  if (wi.linkedEmailId != null) {
    return { kind: 'linked_task', text: 'Linked to the email above' };
  }
  if (wi.deadlineDays < 0) {
    const d = -wi.deadlineDays;
    return {
      kind: 'overdue',
      text: `Overdue by ${d} day${d === 1 ? '' : 's'}`,
    };
  }
  if (wi.deadlineDays === 0) return { kind: 'due_today', text: 'Due today' };
  if (wi.deadlineDays === 1) return { kind: 'due_tomorrow', text: 'Due tomorrow' };
  const band = priorityBand(wi.category);
  if (band === 'urgent') {
    return { kind: 'high_priority', text: `Urgent — within ${wi.deadlineDays} days` };
  }
  if (band === 'medium') {
    return { kind: 'medium_progressing', text: `Due within ${wi.deadlineDays} days` };
  }
  return { kind: 'low_daily', text: `Routine — clears within ${wi.deadlineDays} days` };
}

function planItemFromWork(wi: WorkItem): PlanItem {
  const r = reasonForItem(wi);
  return {
    kind: wi.source,
    refId: wi.id,
    title: wi.title,
    detail: wi.detail,
    category: wi.category,
    estMin: wi.estMin,
    reason: r.kind,
    reasonText: r.text,
    daysOverdue: wi.deadlineDays < 0 ? -wi.deadlineDays : undefined,
    linkedToEmailId: wi.linkedEmailId ?? undefined,
  };
}

// ============================================================================
// Main entry point
// ============================================================================

export function buildPlan(input: PlannerInput): PlannerOutput {
  const arrivals = input.arrivals ?? DEFAULT_ARRIVAL_CONFIG;

  // 1 — Initialise runway
  const runway: DailyPlanInternal[] = input.availability.map((a, i) => ({
    dayIndex: i,
    date: a.date,
    dayLabel: a.dayLabel,
    displayLabel: a.displayLabel,
    minutesAvailable: a.minutesAvailable,
    items: [],
    totalPlannedMin: 0,
    bufferMin: 0,
    status: a.minutesAvailable > 0 ? 'safe' : 'idle',
    flags: [],
    bookableMin: a.minutesAvailable,
    lowQuotaRemainingMin: 0,
  }));

  // 2 — UNCLEAR gate: if any unclear emails exist, that's the first
  //    item on today's plan. Doesn't consume real capacity — it's a
  //    "do this before everything else" prompt.
  const unclearEmailIds = input.emails.filter((e) => e.unclear).map((e) => e.id);
  const unclearCount = unclearEmailIds.length;
  if (unclearCount > 0 && runway.length > 0) {
    runway[0].items.push({
      kind: 'unclear_gate',
      refId: null,
      title:
        unclearCount === 1
          ? '1 email needs classifying'
          : `${unclearCount} emails need classifying`,
      detail: 'Triage these first — one of them could be urgent.',
      category: 'UNCLEAR',
      estMin: 5,
      reason: 'unclear_gate',
      reasonText: 'Classify before continuing',
    });
  }

  // 3 — Compute weekly capacity (week 1 = first 7 days) and apply the
  //    tiered arrivals reservation:
  //      (a) URGENT — 10 min on each future admin day (one urgent ~per day)
  //      (b) MEDIUM — a single 30-min block on the LIGHTEST future admin day
  //      (c) LOW    — nothing extra; the daily 15-min low allocation handles it
  //
  //    Today (day 0) is intentionally EXCLUDED. Holding capacity back today
  //    for hypothetical arrivals just means real work that's already in the
  //    inbox sits on tomorrow instead of clearing now. Even URGENT has a 48h
  //    SLA — anything arriving late today can be triaged first thing tomorrow.
  //
  //    Each day's carve-out is capped at half that day's bookable capacity
  //    so a sparse week (e.g. clinician only works Tue/Wed/Thu) doesn't have
  //    its single active day fully drained by hypothetical arrivals.
  const week1Days = runway.slice(0, 7);
  const weeklyCapacityMin = week1Days.reduce((a, d) => a + d.minutesAvailable, 0);
  const futureWeek1Days = week1Days.slice(1);

  let urgentReservedMin = 0;
  let mediumReservedMin = 0;
  let adminDayCount = 0;

  // (a) Per-day urgent reserve.
  if (arrivals.urgentDailyReserveMin > 0) {
    for (const d of futureWeek1Days) {
      if (d.bookableMin === 0) continue;
      adminDayCount++;
      const cap = Math.floor(d.bookableMin / 2);
      const actual = Math.min(arrivals.urgentDailyReserveMin, cap);
      d.bookableMin -= actual;
      urgentReservedMin += actual;
    }
  } else {
    for (const d of futureWeek1Days) {
      if (d.bookableMin > 0) adminDayCount++;
    }
  }

  // (b) Single weekly medium block — placed on the LIGHTEST future admin
  //     day with any remaining bookable capacity AFTER the urgent reserve.
  //
  //     Clinical reasoning (intentionally inverted from "put it on the
  //     busiest day because it has more slack"): an admin day that's
  //     already packed is cognitively loaded — a medium-priority email
  //     arriving onto it gets rushed or skipped. The lightest day is
  //     where the clinician actually has breathing room, so reserving
  //     the medium buffer there protects real attention rather than
  //     paper capacity. The cap at bookableMin/2 still prevents a very
  //     sparse day from being fully drained.
  if (arrivals.mediumWeeklyReserveMin > 0) {
    let lightestDay: DailyPlanInternal | null = null;
    for (const d of futureWeek1Days) {
      if (d.bookableMin === 0) continue;
      if (!lightestDay || d.bookableMin < lightestDay.bookableMin) lightestDay = d;
    }
    if (lightestDay) {
      const cap = Math.floor(lightestDay.bookableMin / 2);
      const actual = Math.min(arrivals.mediumWeeklyReserveMin, cap);
      lightestDay.bookableMin -= actual;
      mediumReservedMin += actual;
    }
  }

  const reservation: ProjectedReservation = {
    highCount: arrivals.highPerWeek,
    mediumCount: arrivals.mediumPerWeek,
    lowCount: Math.max(0, arrivals.emailsPerWeek - arrivals.highPerWeek - arrivals.mediumPerWeek),
    urgentDailyReserveMin: arrivals.urgentDailyReserveMin,
    mediumWeeklyReserveMin: arrivals.mediumWeeklyReserveMin,
    adminDayCount,
    totalReserveMin: urgentReservedMin + mediumReservedMin,
  };

  // 4 — Reserve daily low-priority allocation BEFORE any packing so it
  //    can never be cannibalised by medium work. Today (day 0) is
  //    excluded — today should clear whatever real work exists; the
  //    daily low-priority drumbeat still applies to days 1-13.
  for (let i = 0; i < runway.length; i++) {
    const d = runway[i];
    if (i === 0) continue;
    if (d.bookableMin > 0) {
      const reserve = Math.min(DAILY_LOW_PRIORITY_RESERVATION_MIN, d.bookableMin);
      d.lowQuotaRemainingMin = reserve;
      d.bookableMin -= reserve;
    }
  }

  // 5 — Build & group work items into pairs (linked email + task)
  const pairs = buildPairs(makeWorkItems(input));

  // Sort each band by deadline asc, then category rank.
  const sortPairs = (a: Pair, b: Pair) => {
    if (a.minDeadline !== b.minDeadline) return a.minDeadline - b.minDeadline;
    if (a.minCatRank !== b.minCatRank) return a.minCatRank - b.minCatRank;
    return b.totalMin - a.totalMin;
  };
  // Per spec Step 2: ANY overdue item — irrespective of category band —
  // is handled before normal-priority flow. Pull them out into their own
  // bucket first, then partition the remainder by band.
  const overduePairs = pairs.filter((p) => p.minDeadline < 0).sort(sortPairs);
  const remainingPairs = pairs.filter((p) => p.minDeadline >= 0);
  const urgentPairs = remainingPairs.filter((p) => p.band === 'urgent').sort(sortPairs);
  const mediumPairs = remainingPairs.filter((p) => p.band === 'medium').sort(sortPairs);
  const lowPairs = remainingPairs.filter((p) => p.band === 'low').sort(sortPairs);

  const breaches: BreachInfo[] = [];
  const deferredItems: PlanItem[] = [];

  // Helper: place a pair on the best day within its deadline window.
  //
  // Two placement strategies, picked per call:
  //
  //   'earliest'  — pick the first day in [0..minDeadline] that fits.
  //                 Used for SAFEGUARDING / URGENT_CLINICAL / LEGAL
  //                 (the urgentPairs bucket) and for overdue items.
  //                 Clinical safety trumps schedule aesthetics: a
  //                 safeguarding email that fits today must NOT be
  //                 pushed to Wednesday just because Wednesday looks
  //                 lighter.
  //
  //   'balanced'  — pick the LEAST-PLANNED day in the same window.
  //                 Used for MEDIUM (CLINICAL / PROFESSIONAL) work
  //                 where the SLA gives genuine room to breathe and
  //                 spreading prevents a wall of items on day 0.
  //
  // Overdue items still set `dipIntoLowQuota=true` so they may consume
  // the protected daily low-quota slot when nothing else is available.
  //
  // We try in order:
  //   1) within deadline window, using bookableMin
  //   2) within deadline window, using day's remaining TOTAL capacity
  //      (taps minutes notionally held back for projected arrivals)
  //   3) past deadline, earliest day with bookable capacity (will
  //      record a breach below since placedOnIdx > pair.minDeadline)
  //   4) past deadline, earliest day with remaining total capacity
  type PlaceStrategy = 'earliest' | 'balanced';
  const placePair = (
    pair: Pair,
    dipIntoLowQuota: boolean,
    strategy: PlaceStrategy,
  ): boolean => {
    const need = pair.totalMin;
    const windowEnd = Math.min(pair.minDeadline, runway.length - 1);

    const pickLeastPlanned = (
      startIdx: number,
      endIdx: number,
      capFn: (d: DailyPlanInternal) => number,
    ): number => {
      let bestIdx = -1;
      let bestPlanned = Infinity;
      for (let i = startIdx; i <= endIdx; i++) {
        const d = runway[i];
        if (capFn(d) < need) continue;
        if (d.totalPlannedMin < bestPlanned) {
          bestPlanned = d.totalPlannedMin;
          bestIdx = i;
        }
      }
      return bestIdx;
    };
    const pickEarliest = (
      startIdx: number,
      endIdx: number,
      capFn: (d: DailyPlanInternal) => number,
    ): number => {
      for (let i = startIdx; i <= endIdx; i++) {
        if (capFn(runway[i]) >= need) return i;
      }
      return -1;
    };

    const bookableCap = (d: DailyPlanInternal) =>
      dipIntoLowQuota ? d.bookableMin + d.lowQuotaRemainingMin : d.bookableMin;
    const remainingTotalCap = (d: DailyPlanInternal) => {
      const reservedFloor = dipIntoLowQuota ? 0 : d.lowQuotaRemainingMin;
      return d.minutesAvailable - d.totalPlannedMin - reservedFloor;
    };

    let placedOnIdx = -1;
    if (windowEnd >= 0) {
      // Overdue items always force earliest, regardless of caller's
      // strategy — they're past SLA, clear ASAP.
      const effective: PlaceStrategy = dipIntoLowQuota ? 'earliest' : strategy;
      if (effective === 'earliest') {
        placedOnIdx = pickEarliest(0, windowEnd, bookableCap);
        if (placedOnIdx === -1) {
          placedOnIdx = pickEarliest(0, windowEnd, remainingTotalCap);
        }
      } else {
        placedOnIdx = pickLeastPlanned(0, windowEnd, bookableCap);
        if (placedOnIdx === -1) {
          placedOnIdx = pickLeastPlanned(0, windowEnd, remainingTotalCap);
        }
      }
    }
    // Past-deadline fallback. Overdue items have windowEnd < 0, so we
    // start scanning from day 0 (clamped). The breach is recorded
    // further below when placedOnIdx > pair.minDeadline.
    const pastStart = Math.max(0, windowEnd + 1);
    if (placedOnIdx === -1) {
      placedOnIdx = pickEarliest(pastStart, runway.length - 1, bookableCap);
    }
    if (placedOnIdx === -1) {
      placedOnIdx = pickEarliest(pastStart, runway.length - 1, remainingTotalCap);
    }
    if (placedOnIdx === -1) return false;

    const day = runway[placedOnIdx];
    let toConsume = need;
    const fromBookable = Math.min(toConsume, day.bookableMin);
    day.bookableMin -= fromBookable;
    toConsume -= fromBookable;
    if (toConsume > 0 && dipIntoLowQuota) {
      const fromQuota = Math.min(toConsume, day.lowQuotaRemainingMin);
      day.lowQuotaRemainingMin -= fromQuota;
      toConsume -= fromQuota;
    }
    // Remaining minutes (if any) come from the reserved-for-arrivals
    // pool. We don't track that pool per-day separately; the per-day
    // `minutesAvailable - totalPlannedMin` invariant stays correct
    // because we add to totalPlannedMin below regardless.


    for (const wi of pair.items) {
      day.items.push(planItemFromWork(wi));
      day.totalPlannedMin += wi.estMin;
    }

    // Breach if the placement day is past the pair's tightest deadline,
    // or if any item was already overdue when planning began.
    const lead = pair.items[0];
    if (lead.deadlineDays < 0) {
      breaches.push({
        itemId: lead.id,
        title: lead.title,
        category: lead.category,
        deadlineDays: lead.deadlineDays,
        reason: 'already_overdue',
      });
    } else if (placedOnIdx > pair.minDeadline) {
      breaches.push({
        itemId: lead.id,
        title: lead.title,
        category: lead.category,
        deadlineDays: lead.deadlineDays,
        reason: 'no_capacity_before_sla',
      });
    }
    return true;
  };

  // 6a — Pack ALL overdue pairs first (any band). Per spec they are
  //    treated as urgent regardless of original priority. Overdue items
  //    are the ONLY band allowed to dip into the day's protected low
  //    quota — their SLA is already violated, so any further delay is
  //    worse than displacing 15 minutes of low-priority clearing.
  for (const pair of overduePairs) {
    const placed = placePair(pair, /* dipIntoLowQuota */ true, 'earliest');
    if (!placed) {
      const lead = pair.items[0];
      breaches.push({
        itemId: lead.id,
        title: lead.title,
        category: lead.category,
        deadlineDays: lead.deadlineDays,
        reason: 'already_overdue',
      });
      for (const wi of pair.items) deferredItems.push(planItemFromWork(wi));
    }
  }

  // 6 — Pack URGENT pairs (safeguarding / urgent_clinical / legal,
  //    items due today/tomorrow). Urgent has a 48h window, so postponing
  //    to the next available admin day is acceptable — it does NOT dip
  //    into the protected daily low-quota slot.
  //
  //    Strategy: 'earliest', NOT 'balanced'. For SAFEGUARDING /
  //    URGENT_CLINICAL / LEGAL, clinical safety trumps schedule
  //    aesthetics — if it fits today, it lands today. The balanced
  //    spread is reserved for medium work where the SLA gives room.
  for (const pair of urgentPairs) {
    const placed = placePair(pair, /* dipIntoLowQuota */ false, 'earliest');
    if (!placed) {
      // Couldn't fit anywhere in 14 days — that's a breach + defer.
      const lead = pair.items[0];
      breaches.push({
        itemId: lead.id,
        title: lead.title,
        category: lead.category,
        deadlineDays: lead.deadlineDays,
        reason: lead.deadlineDays < 0 ? 'already_overdue' : 'no_capacity_before_sla',
      });
      for (const wi of pair.items) deferredItems.push(planItemFromWork(wi));
    }
  }

  // 7 — Pack MEDIUM pairs into bookable capacity only (must not consume
  //    the protected daily low quota). Strategy: 'balanced' — these
  //    are CLINICAL / PROFESSIONAL items with genuine SLA breathing
  //    room, so spreading them across the deadline window prevents a
  //    wall of items piling onto day 0.
  for (const pair of mediumPairs) {
    const placed = placePair(pair, /* dipIntoLowQuota */ false, 'balanced');
    if (!placed) {
      const lead = pair.items[0];
      breaches.push({
        itemId: lead.id,
        title: lead.title,
        category: lead.category,
        deadlineDays: lead.deadlineDays,
        reason: 'no_capacity_before_sla',
      });
      for (const wi of pair.items) deferredItems.push(planItemFromWork(wi));
    }
  }

  // 8 — Pack LOW pairs. Small low items (≤ daily quota) try the protected
  //    low-quota slot first so they get steady daily clearance. Anything
  //    that doesn't fit there falls through to bookable capacity. If
  //    placement fails entirely AND the item's deadline lies within the
  //    14-day runway, record an explicit breach (low items also have an
  //    SLA — typically 14 days for ADMIN/CPD/NONE).
  //
  //    For low items we deliberately SPREAD across days (emptiest day
  //    first, within the deadline window) instead of pack-tight. Real
  //    work still packs tight on early days, but acknowledge-only and
  //    daily-clearing items distribute across the week so that later
  //    days don't look empty while earlier days bunch a wall of tiny
  //    1–3 minute items. This gives the clinician a steady daily
  //    clearance rhythm rather than 11 items piled on one day.
  const stillUnplacedLow: Pair[] = [];
  for (const pair of lowPairs) {
    let placed = false;
    if (pair.totalMin <= DAILY_LOW_PRIORITY_RESERVATION_MIN) {
      // Candidate days: any day with quota space, on or before the
      // pair's deadline. Prefer the LEAST-PLANNED day so low items
      // spread visually across the runway.
      const maxIdx = Math.min(pair.minDeadline, runway.length - 1);
      let bestIdx = -1;
      let bestPlanned = Infinity;
      for (let i = 0; i <= maxIdx; i++) {
        const d = runway[i];
        if (d.lowQuotaRemainingMin < pair.totalMin) continue;
        if (d.totalPlannedMin < bestPlanned) {
          bestPlanned = d.totalPlannedMin;
          bestIdx = i;
        }
      }
      if (bestIdx !== -1) {
        const d = runway[bestIdx];
        for (const wi of pair.items) {
          const item = planItemFromWork(wi);
          item.reason = 'low_daily';
          item.reasonText = 'Daily low-priority clearing';
          d.items.push(item);
          d.totalPlannedMin += wi.estMin;
        }
        d.lowQuotaRemainingMin -= pair.totalMin;
        placed = true;
      }
    }
    if (!placed) stillUnplacedLow.push(pair);
  }
  for (const pair of stillUnplacedLow) {
    const placed = placePair(pair, /* dipIntoLowQuota */ false, 'balanced');
    if (!placed) {
      const lead = pair.items[0];
      // Only record a breach when the runway actually extends past the
      // deadline — otherwise the item is genuinely "deferred to next
      // planning window" and is not a within-runway breach.
      if (lead.deadlineDays <= runway.length - 1) {
        breaches.push({
          itemId: lead.id,
          title: lead.title,
          category: lead.category,
          deadlineDays: lead.deadlineDays,
          reason: 'no_capacity_before_sla',
        });
      }
      for (const wi of pair.items) deferredItems.push(planItemFromWork(wi));
    }
  }

  // 9 — Finalise day status, totals, and flags.
  //
  // Thresholds (recalibrated alongside the tiered arrivals buffer — the
  // old 95%/100% bands were too sensitive once the inflated weekly
  // reserve was removed and weeks legitimately run lighter). Boundaries
  // are inclusive on the lower edge of each band:
  //   safe   — planned work <  90% of available
  //   tight  — planned work in [90%, 110%] of available
  //   breach — planned work >  110% of available
  // The 10% slack on either side stops the indicator flickering on small
  // estimation errors (a 5-min email can't be the difference between
  // green and amber on a 60-min day).
  for (const d of runway) {
    d.bufferMin = Math.max(0, d.minutesAvailable - d.totalPlannedMin);
    if (d.minutesAvailable === 0) {
      d.status = 'idle';
    } else if (d.totalPlannedMin > d.minutesAvailable * 1.10) {
      d.status = 'breach';
    } else if (d.totalPlannedMin >= d.minutesAvailable * 0.90) {
      d.status = 'tight';
    } else {
      d.status = 'safe';
    }
  }

  // Flag idle days where a non-placed item's deadline lands on or before
  // that day — signalling "no admin time scheduled but work is due".
  // Uses the breaches list (which carries deadlineDays) so the flag is
  // accurate, not blanket.
  for (const d of runway) {
    if (d.minutesAvailable > 0) continue;
    const approaching = breaches.filter(
      (b) => b.deadlineDays >= 0 && b.deadlineDays <= d.dayIndex,
    ).length;
    if (approaching > 0) {
      d.flags.push(
        `${approaching} email${approaching === 1 ? '' : 's'} approaching deadline — no admin time scheduled`,
      );
    }
  }

  // 10 — Compute weekly demand & overall status
  const weeklyDemandMin = runway
    .slice(0, 7)
    .reduce((a, d) => a + d.totalPlannedMin, 0);

  let overallStatus: OverallStatus;
  let statusHeadline: string;
  let statusDetail: string;
  let recommendation: string | null = null;

  const overdueBreaches = breaches.filter((b) => b.reason === 'already_overdue');
  const futureBreaches = breaches.filter((b) => b.reason === 'no_capacity_before_sla');
  const safeguardingOverdue = overdueBreaches.some((b) => b.category === 'SAFEGUARDING');

  if (overdueBreaches.length > 0) {
    overallStatus = 'red';
    statusHeadline = `${overdueBreaches.length} ${overdueBreaches.length === 1 ? 'email is' : 'emails are'} already overdue`;
    statusDetail = safeguardingOverdue
      ? 'Handle these today before anything else. One involves a safeguarding concern.'
      : 'Handle these today before anything else.';
  } else if (futureBreaches.length > 0) {
    overallStatus = 'red';
    statusHeadline = `${futureBreaches.length} ${futureBreaches.length === 1 ? 'email will' : 'emails will'} breach this week`;
    const shortMin = Math.max(0, weeklyDemandMin - weeklyCapacityMin);
    statusDetail =
      shortMin > 0
        ? `You have ${fmtH(weeklyDemandMin)} of work and ${fmtH(weeklyCapacityMin)} available.`
        : "Some work won't fit before its deadline.";
    recommendation =
      'Add capacity, defer low-priority emails, or delegate admin items to reception.';
  } else if (
    // Weekly slack-based amber/red, using the same 90% / 110% bands as
    // per-day status so the headline and the day chips stay consistent.
    // SLA breaches above already short-circuit to red; this branch only
    // fires when nothing actually breaches a deadline but the week is
    // genuinely full.
    weeklyCapacityMin > 0 && weeklyDemandMin > weeklyCapacityMin * 1.10
  ) {
    overallStatus = 'red';
    statusHeadline = 'Your week is over capacity';
    statusDetail = `You have ${fmtH(weeklyDemandMin)} of work and ${fmtH(weeklyCapacityMin)} available.`;
    recommendation =
      'Add capacity, defer low-priority emails, or delegate admin items to reception.';
  } else if (
    week1Days.some((d) => d.status === 'tight') ||
    (weeklyCapacityMin > 0 && weeklyDemandMin >= weeklyCapacityMin * 0.90)
  ) {
    overallStatus = 'amber';
    statusHeadline = 'Your week is tight';
    statusDetail =
      'You can clear everything but there is no margin. If 2 or more urgent emails arrive, you will need extra time.';
    recommendation = 'Add 30 minutes mid-week as a buffer.';
  } else {
    overallStatus = 'green';
    statusHeadline = 'You are on track';
    const nextAdminDay = runway.find(
      (d) => d.dayIndex > 0 && d.minutesAvailable > 0,
    );
    statusDetail = nextAdminDay
      ? `Your inbox is manageable this week. Complete today's plan and you are safe until ${nextAdminDay.dayLabel}.`
      : 'Your inbox is manageable this week.';
  }

  // Strip internal-only fields from runway for the public output.
  const cleanRunway: DailyPlan[] = runway.map(
    ({ bookableMin: _b, lowQuotaRemainingMin: _lq, ...rest }) => rest,
  );

  return {
    todayDate: runway[0]?.date ?? '',
    unclearCount,
    unclearEmailIds,
    todaysPlan: cleanRunway[0],
    runway: cleanRunway,
    overallStatus,
    statusHeadline,
    statusDetail,
    recommendation,
    breaches,
    deferredItems,
    reservation,
    weeklyCapacityMin,
    weeklyDemandMin,
  };
}
