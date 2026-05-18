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
import type { WeekSetup } from '@/pages/ClinAdmin';
import { CAT } from './data';
import {
  buildAvailability,
  type DayAvailability,
  type PlannerEmail,
  type PlannerInput,
  type PlannerTask,
} from './planner';

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

function mapEmail(
  email: Email,
  classification: AiClassification | undefined,
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
    estMin: email.estMin,
    deadlineDays: email.deadline,
    unclear,
  };
}

function mapManualTask(task: ManualTask): PlannerTask {
  return {
    id: task.id,
    title: task.title,
    category: mapTaskCategory(task),
    estMin: task.estMin,
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

// Expand a WeekSetup into a 14-day availability array. The same per-weekday
// minute pattern repeats across both weeks. If `weekSetup` is null we treat
// availability as zero everywhere — the planner will still produce a useful
// "no admin time scheduled" runway with deferral flags.
export function buildAvailabilityFromWeekSetup(
  today: Date,
  weekSetup: WeekSetup | null,
): DayAvailability[] {
  if (!weekSetup) return buildAvailability(today, {});
  const totalMins = Math.round(weekSetup.hours * 60);
  const overrides = weekSetup.minutesByDay ?? {};
  const evenSplit =
    weekSetup.days.length > 0 ? Math.round(totalMins / weekSetup.days.length) : 0;
  const minsByDay: Record<string, number> = {};
  for (const d of weekSetup.days) {
    minsByDay[d] = overrides[d] != null ? overrides[d] : evenSplit;
  }
  // buildAvailability takes hours; convert minutes per weekday to hours.
  const hoursByDay: Record<string, number> = {};
  for (const [d, m] of Object.entries(minsByDay)) hoursByDay[d] = m / 60;
  return buildAvailability(today, hoursByDay);
}

// ---- Top-level builder -----------------------------------------------------

export interface AdapterArgs {
  today: Date;
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
}

export function buildPlannerInput(args: AdapterArgs): PlannerInput {
  const excludeEmail = args.excludeEmailId ?? (() => false);
  const excludeTask = args.excludeTaskId ?? (() => false);

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
    plannerEmails.push(mapEmail(e, c));
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
    plannerTasks.push(mapManualTask(t));
  }

  if (args.extraTasks && args.extraTasks.length > 0) {
    for (const t of args.extraTasks) {
      if (excludeTask(t.id)) continue;
      plannerTasks.push(t);
    }
  }

  let availability = buildAvailabilityFromWeekSetup(args.today, args.weekSetup);
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

  return {
    today: args.today,
    emails: plannerEmails,
    tasks: plannerTasks,
    availability,
  };
}
