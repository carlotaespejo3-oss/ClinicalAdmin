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
// NOTE: the spec contradicts itself between two reservation budgets:
//   (a) 0.5h high + 0.5h medium + 0.2h buffer = 1.2h
//   (b) the display example: 1h30 high + 1h medium + 30min low = 3h
// (b) is more realistic for 5 high (~18min ea) + 10 medium (~6min ea)
// emails landing each week, so we default to it. Configurable per-call
// — pass a different ArrivalConfig to override.
export const DEFAULT_ARRIVAL_CONFIG: ArrivalConfig = {
  emailsPerWeek: 60,
  highPerWeek: 5,
  mediumPerWeek: 10,
  highReserveMin: 90,
  mediumReserveMin: 60,
  lowReserveMin: 30,
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
  highReserveMin: number;
  mediumReserveMin: number;
  lowReserveMin: number;
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
  highReserveMin: number;
  mediumReserveMin: number;
  lowReserveMin: number;
  totalReserveMin: number;
}

export interface PlannerOutput {
  todayDate: string;
  unclearCount: number;
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
  const unclearCount = input.emails.filter((e) => e.unclear).length;
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

  // 3 — Compute weekly capacity (week 1 = first 7 days) and projected
  //    incoming reservation. Reservation is held back from each day in
  //    proportion to that day's share of weekly capacity, so a busy day
  //    bears more of the buffer than a light day.
  const week1Days = runway.slice(0, 7);
  const weeklyCapacityMin = week1Days.reduce((a, d) => a + d.minutesAvailable, 0);
  const reservation: ProjectedReservation = {
    highCount: arrivals.highPerWeek,
    mediumCount: arrivals.mediumPerWeek,
    lowCount: Math.max(0, arrivals.emailsPerWeek - arrivals.highPerWeek - arrivals.mediumPerWeek),
    highReserveMin: arrivals.highReserveMin,
    mediumReserveMin: arrivals.mediumReserveMin,
    lowReserveMin: arrivals.lowReserveMin,
    totalReserveMin: arrivals.highReserveMin + arrivals.mediumReserveMin + arrivals.lowReserveMin,
  };
  if (weeklyCapacityMin > 0 && reservation.totalReserveMin > 0) {
    let remaining = Math.min(reservation.totalReserveMin, weeklyCapacityMin);
    for (const d of week1Days) {
      if (d.minutesAvailable === 0) continue;
      const share = Math.round(
        reservation.totalReserveMin * (d.minutesAvailable / weeklyCapacityMin),
      );
      const actual = Math.min(share, remaining, d.bookableMin);
      d.bookableMin -= actual;
      remaining -= actual;
    }
  }

  // 4 — Reserve daily low-priority allocation BEFORE any packing so it
  //    can never be cannibalised by medium work.
  for (const d of runway) {
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

  // Helper: try to place a pair on the earliest possible day.
  // `dipIntoLowQuota` lets an item consume the day's protected low-priority
  // slot when its bookable capacity alone isn't enough. Only overdue items
  // get this privilege — urgent items have a 48h SLA and may legitimately
  // be postponed to tomorrow's bookable capacity rather than cannibalising
  // today's daily low-priority clearance slot.
  const placePair = (pair: Pair, dipIntoLowQuota: boolean): boolean => {
    const need = pair.totalMin;
    let placedOnIdx = -1;
    for (let i = 0; i < runway.length; i++) {
      const d = runway[i];
      const cap = dipIntoLowQuota ? d.bookableMin + d.lowQuotaRemainingMin : d.bookableMin;
      if (cap >= need) {
        placedOnIdx = i;
        break;
      }
    }
    if (placedOnIdx === -1) return false;

    const day = runway[placedOnIdx];
    let toConsume = need;
    const fromBookable = Math.min(toConsume, day.bookableMin);
    day.bookableMin -= fromBookable;
    toConsume -= fromBookable;
    if (toConsume > 0) day.lowQuotaRemainingMin -= toConsume;

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
    const placed = placePair(pair, /* dipIntoLowQuota */ true);
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
  for (const pair of urgentPairs) {
    const placed = placePair(pair, /* dipIntoLowQuota */ false);
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
  //    the protected daily low quota).
  for (const pair of mediumPairs) {
    const placed = placePair(pair, /* dipIntoLowQuota */ false);
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
  const stillUnplacedLow: Pair[] = [];
  for (const pair of lowPairs) {
    let placed = false;
    if (pair.totalMin <= DAILY_LOW_PRIORITY_RESERVATION_MIN) {
      for (let i = 0; i < runway.length; i++) {
        const d = runway[i];
        if (d.lowQuotaRemainingMin >= pair.totalMin) {
          for (const wi of pair.items) {
            const item = planItemFromWork(wi);
            item.reason = 'low_daily';
            item.reasonText = 'Daily low-priority clearing';
            d.items.push(item);
            d.totalPlannedMin += wi.estMin;
          }
          d.lowQuotaRemainingMin -= pair.totalMin;
          placed = true;
          break;
        }
      }
    }
    if (!placed) stillUnplacedLow.push(pair);
  }
  for (const pair of stillUnplacedLow) {
    const placed = placePair(pair, false);
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
  for (const d of runway) {
    d.bufferMin = Math.max(0, d.minutesAvailable - d.totalPlannedMin);
    if (d.minutesAvailable === 0) {
      d.status = 'idle';
    } else if (d.totalPlannedMin > d.minutesAvailable) {
      d.status = 'breach';
    } else if (d.totalPlannedMin >= d.minutesAvailable * 0.95) {
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
  } else if (week1Days.some((d) => d.status === 'tight')) {
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
