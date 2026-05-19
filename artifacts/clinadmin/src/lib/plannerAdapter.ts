// Adapter — turns the live ClinAdmin app state (emails, AI classifications,
// manual tasks, linked doc tasks, week-setup availability) into the
// `PlannerInput` shape the deterministic planner consumes.
//
// Kept separate from `planner.ts` so the planner stays pure and testable
// without dragging in app-specific data shapes. This file knows how to
// translate the legacy `cat` strings to the AI category taxonomy, how to
// fold in `requiresDocument` linked doc tasks, and how to expand a
// `WeekSetup` (Mon/Tue/Wed pattern) into 14 calendar days.

import type { Email, ManualTask, AiClassification, AiCategory } from './types';
import type { LinkedDocTask } from './linkedDocTasksStore';
import type { WeekSetup, AdminTimeBlock } from '@/pages/ClinAdmin';
import { CAT } from './data';
import {
  buildAvailability,
  type DayAvailability,
  type PlannerEmail,
  type PlannerInput,
  type PlannerTask,
} from './planner';
import { leaveMinutesForDay, type LeaveBlock } from './leaveBlocksStore';

// ---- Category mapping ------------------------------------------------------

// Map the legacy `email.cat` string (or `task.cat`) to an AiCategory. Used
// as a fallback when an AI classification isn't present yet.
const LEGACY_CAT_TO_AI: Record<string, AiCategory> = {
  [CAT.URGENT]: 'URGENT_CLINICAL',
  [CAT.UNSAFE]: 'URGENT_CLINICAL',
  [CAT.PROF]: 'PROFESSIONAL',
  [CAT.REVIEW]: 'CLINICAL',
  [CAT.MEETING]: 'PROFESSIONAL',
  [CAT.ADMIN]: 'ADMIN',
  [CAT.NONE]: 'NONE',
  [CAT.LEGAL]: 'LEGAL',
  [CAT.DONE]: 'NONE',
};

function legacyCatToAi(cat: string | undefined, fallback: AiCategory = 'ADMIN'): AiCategory {
  if (!cat) return fallback;
  return LEGACY_CAT_TO_AI[cat] ?? fallback;
}

// Resolve an email to its (final) AiCategory. Prefers the streamed
// classification; falls back to legacy `cat`. SAFEGUARDING is a
// content-driven flag — surfaces only via the AI classification, so the
// legacy fallback never returns it.
export function resolveEmailCategory(
  email: Email,
  classification: AiClassification | undefined,
): AiCategory {
  if (classification) return classification.category;
  return legacyCatToAi(email.cat);
}

function mapTaskCategory(task: ManualTask): AiCategory {
  // Manual tasks share the same legacy `cat` enum strings as emails, so
  // try the cat-string mapping first (it preserves LEGAL / PROFESSIONAL
  // semantics that risk alone can't express). Fall back to the risk
  // signal when cat is missing or maps to a generic ADMIN/NONE while
  // risk says otherwise — a `risk=high` task should always be URGENT.
  const fromCat = task.cat ? LEGACY_CAT_TO_AI[task.cat] : undefined;
  if (fromCat && fromCat !== 'ADMIN' && fromCat !== 'NONE') return fromCat;
  switch (task.risk) {
    case 'high':
      return 'URGENT_CLINICAL';
    case 'medium':
      return fromCat ?? 'CLINICAL';
    case 'low':
      return fromCat ?? 'ADMIN';
    case 'none':
      return fromCat ?? 'NONE';
    default:
      return fromCat ?? 'ADMIN';
  }
}

// ---- Email & task → planner shape ------------------------------------------

function applyMultiplier(estMin: number, category: AiCategory, multipliers: Partial<Record<AiCategory, number>>): number {
  const m = multipliers[category];
  if (!m || m === 1) return estMin;
  return Math.max(1, Math.round(estMin * m));
}

function mapEmail(
  email: Email,
  classification: AiClassification | undefined,
  multipliers: Partial<Record<AiCategory, number>>,
): PlannerEmail {
  const category = resolveEmailCategory(email, classification);
  // An email is "unclear" when the AI explicitly couldn't classify it —
  // category UNCLEAR or priority UNCLEAR. Without any classification at
  // all, we trust the seeded legacy cat (so demo data still flows).
  const unclear =
    classification != null &&
    (classification.category === 'UNCLEAR' || classification.priority === 'UNCLEAR');
  return {
    id: email.id,
    subject: email.subject,
    from: email.from,
    category,
    estMin: applyMultiplier(email.estMin, category, multipliers),
    deadlineDays: email.deadline,
    unclear,
  };
}

function mapManualTask(task: ManualTask, multipliers: Partial<Record<AiCategory, number>>): PlannerTask {
  const category = mapTaskCategory(task);
  return {
    id: task.id,
    title: task.title,
    category,
    estMin: applyMultiplier(task.estMin, category, multipliers),
    deadlineDays: Math.max(0, task.deadline),
    linkedEmailId: task.linkedEmailId ?? null,
  };
}

function mapLinkedDocTask(task: LinkedDocTask): PlannerTask {
  return {
    id: task.id,
    title: task.title,
    // Linked doc tasks inherit urgency from their parent email via pair
    // grouping; standalone category is informational. CLINICAL is the
    // safest "do not push to low-quota" default.
    category: 'CLINICAL',
    estMin: task.estMin,
    deadlineDays: Math.max(0, task.deadline),
    linkedEmailId: task.linkedEmailId,
  };
}

// ---- Availability ----------------------------------------------------------

// Given a set of time blocks for a day and the current wall-clock time,
// returns how many minutes remain across all blocks. Blocks that have
// already ended contribute 0; blocks not yet started contribute their full
// duration; partially-elapsed blocks contribute only the tail.
export function computeRemainingMinFromBlocks(
  blocks: AdminTimeBlock[],
  now: Date,
): number {
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let remaining = 0;
  for (const block of blocks) {
    const [h, m] = block.start.split(':').map(Number);
    const blockStart = h * 60 + m;
    const blockEnd = blockStart + block.durationMin;
    if (nowMins >= blockEnd) continue;
    remaining += nowMins <= blockStart ? block.durationMin : blockEnd - nowMins;
  }
  return remaining;
}

// Expand a WeekSetup into a 14-day availability array. The same per-weekday
// minute pattern repeats across both weeks. If `weekSetup` is null we treat
// availability as zero everywhere — the planner will still produce a useful
// "no admin time scheduled" runway with deferral flags.
//
// When `now` is supplied and today has time blocks configured, today's
// `minutesAvailable` is replaced with the minutes that actually remain
// in those blocks at the current wall-clock time. This prevents the
// planner from scheduling work "today" when the admin window has
// already passed.
export function buildAvailabilityFromWeekSetup(
  today: Date,
  weekSetup: WeekSetup | null,
  now?: Date,
  runwayDays?: number,
): DayAvailability[] {
  if (!weekSetup) return buildAvailability(today, {});
  const totalMins = Math.round(weekSetup.hours * 60);
  const overrides = weekSetup.minutesByDay ?? {};
  const blocks = weekSetup.adminBlocksByDay ?? {};
  const evenSplit =
    weekSetup.days.length > 0 ? Math.round(totalMins / weekSetup.days.length) : 0;
  const minsByDay: Record<string, number> = {};
  for (const d of weekSetup.days) {
    if (blocks[d] && blocks[d].length > 0) {
      // When blocks are defined, total minutes = sum of block durations.
      minsByDay[d] = blocks[d].reduce((a, b) => a + b.durationMin, 0);
    } else {
      minsByDay[d] = overrides[d] != null ? overrides[d] : evenSplit;
    }
  }
  // buildAvailability takes hours; convert minutes per weekday to hours.
  const hoursByDay: Record<string, number> = {};
  for (const [d, m] of Object.entries(minsByDay)) hoursByDay[d] = m / 60;
  const availability = buildAvailability(today, hoursByDay, runwayDays ? { days: runwayDays } : undefined);

  // Time-of-day awareness: trim today's minutes to what's still left.
  if (now && availability.length > 0) {
    const todayLabel = availability[0].dayLabel;
    const todayBlocks = blocks[todayLabel];
    if (todayBlocks && todayBlocks.length > 0) {
      availability[0].minutesAvailable = computeRemainingMinFromBlocks(todayBlocks, now);
    }
  }

  return availability;
}

// ---- Top-level builder -----------------------------------------------------

export interface AdapterArgs {
  today: Date;
  /** Current wall-clock time. When supplied and today has time blocks
   * configured, today's availability is trimmed to remaining minutes. */
  now?: Date;
  emails: Email[];
  classifications: Map<number, AiClassification>;
  manualTasks: ManualTask[];
  linkedDocTasks: Map<number, LinkedDocTask>;
  weekSetup: WeekSetup | null;
  // Filter predicates so the caller can exclude archived / acknowledged
  // / done items. Defaults: all emails included, only undone tasks.
  excludeEmailId?: (id: number) => boolean;
  excludeTaskId?: (id: string) => boolean;
  // Extra planner-shaped tasks to add on top (e.g. user-added tasks
  // from the "Week ahead" overview with explicit due dates).
  extraTasks?: PlannerTask[];
  // Per-date minutes to subtract from availability BEFORE buildPlan
  // runs. Used to make fixed events (clinic, meeting) eat the day's
  // bookable time so the planner schedules around them.
  busyMinutesByDate?: ReadonlyMap<string, number>;
  // Clinician leave / time-off. The adapter subtracts overlapping
  // leave minutes from each day's availability BEFORE buildPlan, so
  // the planner just sees reduced (often zero) admin time and
  // replans around the absence. v1 minimal — no recovery ramp or
  // pre-leave wind-down, those live in a future resolver pass.
  leaveBlocks?: readonly LeaveBlock[];
  /** Clinician SLA overrides — forwarded verbatim to PlannerInput. */
  slaDaysByCategory?: Partial<Record<import('./types').AiCategory, number>>;
  /** Planning horizon override — forwarded verbatim to PlannerInput. */
  runwayDays?: number;
  /** Per-category EMA multipliers from the estMin learning store.
   *  Applied to estMin before packing so the planner schedules
   *  with learned durations, not raw seed estimates. */
  timeMultipliers?: Partial<Record<import('./types').AiCategory, number>>;
}

export function buildPlannerInput(args: AdapterArgs): PlannerInput {
  const excludeEmail = args.excludeEmailId ?? (() => false);
  const excludeTask = args.excludeTaskId ?? (() => false);
  const multipliers = args.timeMultipliers ?? {};

  // Map emails. AI classification is authoritative when present; the legacy
  // `cat` string is only used as a fallback. We must therefore resolve the
  // category FIRST, then filter on the resolved value — otherwise a
  // seeded-NONE email that the AI classified as URGENT_CLINICAL would be
  // wrongly dropped, and a seeded-ADMIN email that the AI classified as
  // NONE would wrongly stay in the plan.
  const plannerEmails: PlannerEmail[] = [];
  for (const e of args.emails) {
    if (excludeEmail(e.id)) continue;
    const c = args.classifications.get(e.id);
    // NONE-category emails (acknowledge-only items) are NOT dropped —
    // the clinician still needs to see them on the daily plan so they
    // can review + click acknowledge. They flow into the low-priority
    // band and consume the daily low-quota slot like any other admin
    // item, just with a smaller estMin.
    // DONE is a legacy "completed" sentinel — no AI equivalent. Drop it
    // unconditionally; once an email is marked DONE it's not work.
    if (e.cat === CAT.DONE) continue;
    plannerEmails.push(mapEmail(e, c, multipliers));
  }

  // Map tasks. A linked doc task is the canonical pair-mate for its email,
  // BUT only while it's still active. A completed (or excluded) doc task
  // must (a) not appear in the plan and (b) not suppress its manual
  // fallback — otherwise live work disappears the moment a stale doc
  // task lingers in storage.
  const activeLinkedEmailIds = new Set<number>();
  const plannerTasks: PlannerTask[] = [];
  for (const [emailId, doc] of args.linkedDocTasks) {
    if (doc.done) continue;
    if (excludeTask(doc.id)) continue;
    plannerTasks.push(mapLinkedDocTask(doc));
    activeLinkedEmailIds.add(emailId);
  }
  for (const t of args.manualTasks) {
    if (t.done) continue;
    if (excludeTask(t.id)) continue;
    if (t.linkedEmailId != null && activeLinkedEmailIds.has(t.linkedEmailId)) continue;
    plannerTasks.push(mapManualTask(t, multipliers));
  }

  if (args.extraTasks && args.extraTasks.length > 0) {
    for (const t of args.extraTasks) {
      if (excludeTask(t.id)) continue;
      plannerTasks.push(t);
    }
  }

  let availability = buildAvailabilityFromWeekSetup(args.today, args.weekSetup, args.now, args.runwayDays);
  if (args.busyMinutesByDate && args.busyMinutesByDate.size > 0) {
    availability = availability.map((a) => {
      const busy = args.busyMinutesByDate!.get(a.date) ?? 0;
      if (busy <= 0) return a;
      return {
        ...a,
        minutesAvailable: Math.max(0, a.minutesAvailable - busy),
      };
    });
  }
  if (args.leaveBlocks && args.leaveBlocks.length > 0) {
    availability = availability.map((a) => {
      const leaveMin = leaveMinutesForDay(a.date, args.leaveBlocks!, a.minutesAvailable);
      if (leaveMin <= 0) return a;
      return {
        ...a,
        minutesAvailable: Math.max(0, a.minutesAvailable - leaveMin),
      };
    });
  }

  return {
    today: args.today,
    emails: plannerEmails,
    tasks: plannerTasks,
    availability,
    slaDaysByCategory: args.slaDaysByCategory,
    runwayDays: args.runwayDays,
  };
}
