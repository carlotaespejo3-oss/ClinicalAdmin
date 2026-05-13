// Morning Brief — answers two questions on the Home tab:
//   1. "What can't wait today?"  → 0–2 items, ruthlessly filtered.
//   2. "Is the week quietly building up behind me?" → one of three
//      trajectory states with a single sentence.
//
// Pure logic so it can be unit-tested without React. Inputs are the
// already-filtered live state (open emails, open tasks, recommended
// vs allocated minutes for the week). The component layer wires the
// hooks/stores and renders the result.

import { CAT } from './data';
import { getEmailPriority, getTaskPriority } from './utils';
import type { Email, ManualTask } from './types';

export type CannotWaitKind = 'email' | 'task';

export interface CannotWaitItem {
  kind: CannotWaitKind;
  id: number | string;
  title: string;
  reason: string;
  estMin: number;
  // For UI sorting / linking. Lower rank = more urgent.
  rank: number;
}

export type TrajectoryState = 'ON_TRACK' | 'DRIFTING' | 'OVERLOADED';

export interface WeekTrajectory {
  state: TrajectoryState;
  headline: string;
  detail: string;
  shortfallMin: number;
  recommendedMin: number;
  allocatedMin: number;
}

export interface MorningBrief {
  cannotWait: CannotWaitItem[];
  cannotWaitOverflow: number;
  cannotWaitTotal: number;
  trajectory: WeekTrajectory;
}

export interface MorningBriefInput {
  emails: Email[];
  manualTasks: ManualTask[];
  acknowledgedEmailIds: Set<number>;
  archivedEmailIds: Set<number>;
  // Email IDs whose linked doc task is being represented by the email
  // itself (combined block) — exclude the duplicate task from the
  // "cannot wait" pool.
  linkedDocEmailIds: Set<number>;
  recommendedMin: number;
  allocatedMin: number;
}

const MAX_CANNOT_WAIT = 2;

// Trajectory bands. Tuned for the clinician's stated brief: the goal is
// to spot when the week is "quietly building up", not to flag every
// 5-minute shortfall. ≥ 100% of recommended → on track. 70–100% →
// drifting (an extra hour catches you up). < 70% → overloaded.
const ON_TRACK_RATIO = 1.0;
const DRIFTING_FLOOR_RATIO = 0.7;

// Rank of a "cannot-wait" reason. Lower = more urgent. Used both for
// sorting the visible list and so callers can pick a colour band.
const RANK_SAFEGUARDING = 0;
const RANK_URGENT_CLINICAL = 1;
const RANK_OVERDUE = 2;
const RANK_DUE_TODAY = 3;
const RANK_HIGH_RISK_SOON = 4;

interface ReasonResult {
  reason: string;
  rank: number;
}

function emailReason(e: Email): ReasonResult | null {
  // Safeguarding / unsafe-to-answer-by-email always wins. The clinician
  // explicitly cannot let these sit.
  if (e.cat === CAT.UNSAFE) {
    return { reason: 'Needs clinical assessment', rank: RANK_SAFEGUARDING };
  }
  if (e.cat === CAT.URGENT) {
    return { reason: 'Urgent clinical', rank: RANK_URGENT_CLINICAL };
  }
  if (e.deadline != null && e.deadline < 0) {
    const days = -e.deadline;
    return { reason: `Overdue by ${days}d`, rank: RANK_OVERDUE };
  }
  if (e.deadline != null && e.deadline === 0) {
    return { reason: 'Due today', rank: RANK_DUE_TODAY };
  }
  // High-priority items due tomorrow are still "cannot wait" — if you
  // skip them today they're tomorrow's overdue.
  if (getEmailPriority(e) === 'High' && e.deadline != null && e.deadline <= 1) {
    return { reason: 'High risk · due tomorrow', rank: RANK_HIGH_RISK_SOON };
  }
  return null;
}

function taskReason(t: ManualTask): ReasonResult | null {
  // Urgency by category mirrors the email logic — a SAFEGUARDING /
  // URGENT_CLINICAL manual task cannot wait even if its formal
  // deadline is days away.
  if (t.cat === CAT.UNSAFE) {
    return { reason: 'Needs clinical assessment', rank: RANK_SAFEGUARDING };
  }
  if (t.cat === CAT.URGENT) {
    return { reason: 'Urgent clinical', rank: RANK_URGENT_CLINICAL };
  }
  if (t.deadline < 0) {
    return { reason: `Overdue by ${-t.deadline}d`, rank: RANK_OVERDUE };
  }
  if (t.deadline === 0) {
    return { reason: 'Due today', rank: RANK_DUE_TODAY };
  }
  if (getTaskPriority(t) === 'High' && t.deadline <= 1) {
    return { reason: 'High risk · due tomorrow', rank: RANK_HIGH_RISK_SOON };
  }
  return null;
}

function fmt(min: number): string {
  if (min <= 0) return '0min';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function trajectoryFor(recommendedMin: number, allocatedMin: number): WeekTrajectory {
  // Defensive: if there is no recommended workload yet (empty inbox,
  // no classifications), call it on track rather than dividing by zero.
  if (recommendedMin <= 0) {
    return {
      state: 'ON_TRACK',
      headline: 'Nothing pressing',
      detail: 'No outstanding workload detected for this week.',
      shortfallMin: 0,
      recommendedMin,
      allocatedMin,
    };
  }
  const ratio = allocatedMin / recommendedMin;
  const shortfall = Math.max(0, recommendedMin - allocatedMin);
  if (ratio >= ON_TRACK_RATIO) {
    return {
      state: 'ON_TRACK',
      headline: 'On track',
      detail: `Your booked admin (${fmt(allocatedMin)}) covers this week's projected ${fmt(recommendedMin)}.`,
      shortfallMin: 0,
      recommendedMin,
      allocatedMin,
    };
  }
  if (ratio >= DRIFTING_FLOOR_RATIO) {
    return {
      state: 'DRIFTING',
      headline: 'Quietly drifting',
      detail: `${fmt(shortfall)} short this week — one extra hour will catch you up.`,
      shortfallMin: shortfall,
      recommendedMin,
      allocatedMin,
    };
  }
  return {
    state: 'OVERLOADED',
    headline: 'Building up behind you',
    detail: `${fmt(shortfall)} short this week — workload is outpacing the time you've booked.`,
    shortfallMin: shortfall,
    recommendedMin,
    allocatedMin,
  };
}

export function buildMorningBrief(input: MorningBriefInput): MorningBrief {
  const openEmails = input.emails.filter(
    (e) =>
      e.cat !== CAT.NONE &&
      !input.acknowledgedEmailIds.has(e.id) &&
      !input.archivedEmailIds.has(e.id),
  );
  // Only the still-open emails contribute their combined block. If the
  // clinician already replied/archived the email but the linked doc is
  // outstanding, the task represents real remaining work and must NOT
  // be suppressed.
  const openEmailIds = new Set<number>(openEmails.map((e) => e.id));
  const openTasks = input.manualTasks.filter(
    (t) =>
      !t.done &&
      !(
        t.linkedEmailId != null &&
        input.linkedDocEmailIds.has(t.linkedEmailId) &&
        openEmailIds.has(t.linkedEmailId)
      ),
  );

  const items: CannotWaitItem[] = [];
  for (const e of openEmails) {
    const r = emailReason(e);
    if (r) {
      items.push({
        kind: 'email',
        id: e.id,
        title: e.subject || `Email from ${e.from}`,
        reason: r.reason,
        rank: r.rank,
        estMin: e.estMin,
      });
    }
  }
  for (const t of openTasks) {
    const r = taskReason(t);
    if (r) {
      items.push({
        kind: 'task',
        id: t.id,
        title: t.title,
        reason: r.reason,
        rank: r.rank,
        estMin: t.estMin,
      });
    }
  }
  // Sort by rank, then by estimated minutes descending (the chunkier
  // job tends to need the morning slot before fatigue sets in).
  items.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return b.estMin - a.estMin;
  });

  const total = items.length;
  const visible = items.slice(0, MAX_CANNOT_WAIT);
  const overflow = Math.max(0, total - visible.length);

  return {
    cannotWait: visible,
    cannotWaitOverflow: overflow,
    cannotWaitTotal: total,
    trajectory: trajectoryFor(input.recommendedMin, input.allocatedMin),
  };
}
