import { useEffect, useMemo } from 'react';
import { emails } from './data';
import type { ManualTask } from './types';
import type { WeekSetup } from '@/pages/ClinAdmin';
import { useAiClassifications } from './aiClassifyStore';
import { useLinkedDocTasks } from './linkedDocTasksStore';
import { useAcknowledgedEmails } from './acknowledgedStore';
import { useArchivedEmails } from './archivedStore';
import { useArrivalsConfig } from './arrivalsConfigStore';
import {
  useDeferralHistory,
  deferralCountMap,
  recordDeferralsForWeek,
  isoMondayOf,
} from './deferralStore';
import { useUserPlannedItems } from './userPlannedItemsStore';
import { usePromptedTasksState } from './promptedTasksStore';
import { useLeaveBlocks } from './leaveBlocksStore';
import { useAppSettingsCache } from './clinicianSettingsStore';
import {
  resolveAvailability,
  type WorkingPattern,
  type LeaveBlock as ResolverLeaveBlock,
} from './availability';
import { useUnclearGateOverrides } from './unclearGateOverridesStore';
import type { PotentialTaskKind } from './potentialTaskDetect';
import { buildPlannerInput } from './plannerAdapter';
import type { AiCategory } from './types';
import {
  buildPlan,
  type PlannerOutput,
  type PlanItem,
  type PlannerTask,
  type DailyPlan,
} from './planner';

// Shared planner subscription: both HomeTab (Today's Plan) and the Detailed
// View (Runway / Projected Workload) call this hook so they recompute from
// the same live stores. When an email is acknowledged / archived in the
// inbox, a manual task is marked done in Tasks, an AI classification
// streams in, a linked doc task is created/completed, OR the clinician
// adds a task/event from the "Week ahead" overview on Home, every consumer
// re-renders together — no stale slices, no per-tab desync.
export function usePlannerOutput(
  manualTasks: ManualTask[],
  weekSetup: WeekSetup | null,
): PlannerOutput {
  const classifications = useAiClassifications();
  const linkedDocTasks = useLinkedDocTasks();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const arrivals = useArrivalsConfig();
  const deferralHistory = useDeferralHistory();
  const userPlannedItems = useUserPlannedItems();
  const { tasks: promptedTasks } = usePromptedTasksState();
  const leaveBlocks = useLeaveBlocks();
  const unclearGateOverrides = useUnclearGateOverrides();
  const appSettings = useAppSettingsCache();
  // Recovery dial from settings. Each subfield falls back to its
  // documented default so a freshly-installed user (or one whose
  // JSON column predates these fields) gets the resolver behaviour
  // out of the box rather than a no-op recovery curve.
  const recoveryConfig = useMemo(
    () => ({
      rampMultipliers: appSettings.leavePlanner?.rampMultipliers ?? [0.5, 0.75, 1.0],
      recoveryReservedMin: appSettings.leavePlanner?.recoveryReservedMin ?? [60, 30, 0],
      triageReservedMin: appSettings.leavePlanner?.triageReservedMin ?? [20, 0, 0],
      preLeaveWindDown: appSettings.leavePlanner?.preLeaveWindDown ?? [0.75, 0.5],
      triggerAfterDaysOff: appSettings.leavePlanner?.triggerAfterDaysOff ?? 3,
    }),
    [appSettings.leavePlanner],
  );

  const weekMondayKey = isoMondayOf(new Date());

  const output = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);

    // User-added tasks: convert each date → deadlineDays from today.
    // ADMIN category by default — these are routine workload items the
    // clinician chose to plan. The user-supplied date is treated as the
    // deadline (must fit on or before).
    const extraTasks: PlannerTask[] = [];
    for (const it of userPlannedItems) {
      if (it.kind !== 'task') continue;
      const d = parseLocalDate(it.date);
      if (!d) continue;
      const deadlineDays = Math.round((d.getTime() - todayStart.getTime()) / 86400000);
      extraTasks.push({
        id: it.id,
        title: it.title,
        category: 'ADMIN',
        estMin: it.estMin,
        deadlineDays: Math.max(0, deadlineDays),
        linkedEmailId: null,
      });
    }

    // AI-prompted tasks the clinician accepted from inbox prompts
    // (phone calls, prescriptions, results to review, etc.). These
    // used to bypass the planner entirely — they appeared in the
    // My-tasks rail but Today's Plan never knew about them, so the
    // day looked emptier than it was and the work didn't compete for
    // capacity with email replies. Feed them in here so the planner
    // schedules them into the runway alongside everything else.
    //   · linkedEmailId carries the source email so the planner can
    //     pair the task with the email reply on the same day (and so
    //     the My-tasks row remains clickable through to the email).
    //   · deadlineDays defaults to 2 days when the AI couldn't pin a
    //     date — close enough to surface in Today's plan without
    //     forcing a same-day breach.
    for (const t of promptedTasks) {
      if (t.done) continue;
      extraTasks.push({
        id: t.id,
        title: t.title,
        category: promptedTaskCategory(t.kind),
        estMin: t.estMin,
        deadlineDays: Math.max(0, typeof t.dueDays === 'number' ? t.dueDays : 2),
        linkedEmailId: t.emailId,
      });
    }

    // Fixed events: tally minutes per date so the planner subtracts
    // them from bookable time on the day they fall.
    const busyMinutesByDate = new Map<string, number>();
    for (const it of userPlannedItems) {
      if (it.kind !== 'event') continue;
      busyMinutesByDate.set(
        it.date,
        (busyMinutesByDate.get(it.date) ?? 0) + it.durationMin,
      );
    }

    // The post-leave ramp-up that used to live here has been replaced
    // by the availability resolver (see below). Recovery days now
    // come through as recoveryReservedMin on each runway day, handled
    // inside planner.ts rather than via a busy-minutes injection — so
    // the packer never tries to place work on the protected slot in
    // the first place.

    const input = buildPlannerInput({
      today,
      emails,
      classifications,
      manualTasks,
      linkedDocTasks,
      weekSetup,
      excludeEmailId: (id) => acknowledged.has(id) || archived.has(id),
      extraTasks,
      busyMinutesByDate,
      leaveBlocks,
    });

    // Run the availability resolver over the same window the planner
    // is about to build. It produces:
    //   · dailyAvailability[i].minutesAvailable — what the planner
    //     should treat as bookable on day i (already accounting for
    //     leave, public holidays, pre-leave wind-down, recovery ramp).
    //   · dailyAvailability[i].recoveryReservedMin — the catch-up
    //     admin slot the packer must not consume (carried through
    //     buildPlan via DayAvailability and into the day status at
    //     step 9).
    //   · effectiveArrivalConfig — projected arrivals scaled down
    //     when this week is shortened by leave.
    //   · leaveContext — surfaced on the hook return so UI banners
    //     can render without re-doing the leave arithmetic.
    //
    // We overwrite the per-day fields on input.availability (rather
    // than rebuilding it) so the dayLabel / displayLabel computed by
    // buildPlannerInput is preserved exactly.
    let leaveContext: ReturnType<typeof resolveAvailability>['leaveContext'] = {};
    let effectiveArrivals = arrivals;
    if (weekSetup && weekSetup.days.length > 0 && input.availability.length > 0) {
      const workingPattern = workingPatternFromWeekSetup(weekSetup);
      const todayIso = input.availability[0].date;
      const resolverBlocks: ResolverLeaveBlock[] = leaveBlocks.map((b) => ({
        id: b.id,
        startAt: b.startAt,
        endAt: b.endAt,
        type: b.leaveType,
        notes: b.notes ?? undefined,
      }));
      const resolved = resolveAvailability({
        today: todayIso,
        workingPattern,
        leaveBlocks: resolverBlocks,
        publicHolidays: [],
        recoveryConfig,
        arrivalConfig: arrivals,
        runwayDays: input.availability.length,
      });
      // Replace per-day minutes + stamp recovery reserve. Length
      // matches by construction (runwayDays === availability.length).
      //
      // We must re-subtract busyMinutesByDate here. buildPlannerInput
      // already subtracted fixed events from minutesAvailable so the
      // packer doesn't overfill the day, but our overwrite with the
      // resolver's value discards that. The resolver knows about leave
      // / public holidays / recovery — it does NOT know about the
      // clinician's pinned events. Apply both: leave-aware capacity
      // minus event time. Recovery reserve is unaffected by events.
      for (let i = 0; i < input.availability.length; i++) {
        const r = resolved.dailyAvailability[i];
        if (!r) continue;
        const day = input.availability[i];
        const busy = busyMinutesByDate.get(day.date) ?? 0;
        day.minutesAvailable = Math.max(0, r.minutesAvailable - busy);
        day.recoveryReservedMin = r.recoveryReservedMin;
        day.triageReservedMin = r.triageReservedMin;
      }
      effectiveArrivals = resolved.effectiveArrivalConfig;
      leaveContext = resolved.leaveContext;
    }

    const planned = buildPlan({
      ...input,
      arrivals: effectiveArrivals,
      unclearGateOverrides,
      // Only counts weeks STRICTLY before this week. Records made
      // for the current week (by the effect below) are deliberately
      // ignored here — otherwise an item transiently in
      // deferredItems would show "Deferred 1×" the instant the user
      // adds capacity and it gets placed.
      deferralHistory: deferralCountMap(deferralHistory, weekMondayKey),
    });
    planned.leaveContext = leaveContext;

    // Inject events into the runway days they belong to. Events are
    // PINNED to their date — the planner never moves them, it only
    // gave back the time they consume. They appear FIRST on the day
    // (above scheduled work) and are sorted by startTime when present.
    const eventsByDate = new Map<string, PlanItem[]>();
    for (const it of userPlannedItems) {
      if (it.kind !== 'event') continue;
      const item: PlanItem = {
        kind: 'event',
        refId: it.id,
        title: it.title,
        detail: it.startTime ? `Starts ${it.startTime}` : 'Fixed in your diary',
        category: 'PROFESSIONAL',
        estMin: it.durationMin,
        reason: 'fixed_event',
        reasonText: it.startTime
          ? `Fixed at ${it.startTime} — won't be rescheduled`
          : "Fixed event — won't be rescheduled",
      };
      const arr = eventsByDate.get(it.date) ?? [];
      arr.push(item);
      eventsByDate.set(it.date, arr);
    }

    if (eventsByDate.size > 0) {
      planned.runway = planned.runway.map<DailyPlan>((day) => {
        const dayEvents = eventsByDate.get(day.date);
        if (!dayEvents || dayEvents.length === 0) return day;
        // Sort events by startTime (untimed last). Stable for equal keys.
        const sorted = [...dayEvents].sort((a, b) => {
          const ta = a.detail.startsWith('Starts ') ? a.detail.slice(7) : '99:99';
          const tb = b.detail.startsWith('Starts ') ? b.detail.slice(7) : '99:99';
          return ta.localeCompare(tb);
        });
        const items = [...sorted, ...day.items];
        const eventsMin = sorted.reduce((s, i) => s + i.estMin, 0);
        // Accounting note: events were subtracted from minutesAvailable
        // BEFORE buildPlan so the packer wouldn't overfill the day.
        // For the runway we publish, restore the full admin time and
        // count the events as planned work — that matches the
        // clinician's mental model ("my 4h day is full because I have
        // a 2h meeting and 2h of emails"). Without this restore the
        // event would be double-counted (reduce denominator AND add to
        // numerator), making the day look tighter than it is.
        const totalPlannedMin = day.totalPlannedMin + eventsMin;
        const minutesAvailable = day.minutesAvailable + eventsMin;
        // recoveryReservedMin AND triageReservedMin must enter the
        // status calc here the same way they do in planner.ts step
        // 9 — otherwise a recovery day with no items would read
        // 'safe' on the public runway even though the planner
        // internally treated both reserved slots as already
        // claimed. Mirror the planner's claimedMin shape exactly.
        const recoveryMin = day.recoveryReservedMin ?? 0;
        const triageMin = day.triageReservedMin ?? 0;
        const claimedMin = totalPlannedMin + recoveryMin + triageMin;
        const bufferMin = Math.max(0, minutesAvailable - claimedMin);
        // Same thresholds as planner.ts L876-892 + calendarHelpers
        // filterRunwayToTasks — keep them in lock-step so a re-filter
        // doesn't disagree about the day's status.
        let status: DailyPlan['status'];
        if (minutesAvailable === 0) {
          status = 'idle';
        } else if (claimedMin > minutesAvailable * 1.10) {
          status = 'breach';
        } else if (claimedMin >= minutesAvailable * 0.90) {
          status = 'tight';
        } else {
          status = 'safe';
        }
        return {
          ...day,
          items,
          totalPlannedMin,
          minutesAvailable,
          bufferMin,
          status,
        };
      });

      // Today's plan mirror — if today has events, show them on top
      // of Today's Plan too.
      const todayKey = planned.runway[0]?.date;
      if (todayKey && eventsByDate.has(todayKey)) {
        planned.todaysPlan = planned.runway[0];
      }
    }

    return planned;
  }, [
    classifications,
    linkedDocTasks,
    manualTasks,
    weekSetup,
    acknowledged,
    archived,
    arrivals,
    deferralHistory,
    weekMondayKey,
    userPlannedItems,
    promptedTasks,
    leaveBlocks,
    unclearGateOverrides,
    recoveryConfig,
  ]);

  // Side-effect: any email the planner couldn't fit into this week's
  // runway gets recorded against this ISO week. recordDeferralsForWeek
  // is idempotent for the same (emailId, weekMonday) pair, so render
  // churn during the week never inflates counts — only crossing into
  // a new ISO week with the item still unplaced increments it AND
  // makes it visible in the planner's `deferralHistory` input.
  const deferredEmailIds = output.deferredItems
    .filter((it) => it.kind === 'email' && typeof it.refId === 'number')
    .map((it) => it.refId as number);
  const deferredKey = deferredEmailIds.join(',');
  useEffect(() => {
    if (deferredEmailIds.length === 0) return;
    recordDeferralsForWeek(deferredEmailIds, weekMondayKey);
    // deferredEmailIds is captured via deferredKey in the deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredKey, weekMondayKey]);

  return output;
}

// Map an AI-prompted-task kind to a planner category band. Clinical
// kinds (a script, a phone call about a patient, results to review,
// a referral) land in CLINICAL so they share the medium-priority
// band with clinical emails; pure scheduling/admin kinds drop to
// ADMIN so they don't push genuine clinical work down the queue.
function promptedTaskCategory(kind: PotentialTaskKind): AiCategory {
  switch (kind) {
    case 'prescription':
    case 'phone_call':
    case 'results_review':
    case 'referral':
      return 'CLINICAL';
    case 'appointment':
    case 'follow_up':
    case 'deadline':
      return 'ADMIN';
  }
}

// Derive a 7-day WorkingPattern (in minutes) from the WeekSetup the
// rest of the app uses. weekSetup carries weekday labels ('Mon'..)
// and either a flat `hours` total split evenly across days or a
// per-day `minutesByDay` override. We always keep saturday/sunday at
// 0 — the planner has never modelled weekend work, and the resolver
// uses zero-minute days as "non-working" for stretch-finding.
function workingPatternFromWeekSetup(weekSetup: WeekSetup): WorkingPattern {
  const totalMins = Math.round(weekSetup.hours * 60);
  const evenSplit =
    weekSetup.days.length > 0 ? Math.round(totalMins / weekSetup.days.length) : 0;
  const minsByLabel = new Map<string, number>();
  for (const day of weekSetup.days) {
    const override = weekSetup.minutesByDay?.[day];
    minsByLabel.set(day, override != null ? override : evenSplit);
  }
  return {
    monday: minsByLabel.get('Mon') ?? 0,
    tuesday: minsByLabel.get('Tue') ?? 0,
    wednesday: minsByLabel.get('Wed') ?? 0,
    thursday: minsByLabel.get('Thu') ?? 0,
    friday: minsByLabel.get('Fri') ?? 0,
    saturday: 0,
    sunday: 0,
  };
}

// Parse a 'YYYY-MM-DD' local date string into a local Date at midnight.
// Returns null for malformed input.
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}
