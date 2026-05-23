import { useState, useMemo, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Sun, ShieldAlert, Check, ChevronDown, Clock, Plane } from 'lucide-react';
import { emails, weekData, CAT } from '@/lib/data';
import { ManualTask, SidebarTask, TabType, type AiCategory } from '@/lib/types';
import { cn, getEmailPriority, getTaskPriority, type Priority } from '@/lib/utils';
import { WeekSetup, AdminTimeBlock } from '@/pages/ClinAdmin';
import AddTimeBlockDialog from '@/components/AddTimeBlockDialog';
import { useLinkedDocTasks } from '@/lib/linkedDocTasksStore';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { useArchivedEmails } from '@/lib/archivedStore';
import { usePlannerOutput } from '@/lib/usePlannerOutput';
import { useAppSettingsCache } from '@/lib/clinicianSettingsStore';
import {
  useLeaveBlocks,
  currentLeaveStatus,
  itemsAtRiskBeforeLeave,
  LEAVE_TYPE_LABEL,
  type AtRiskInput,
} from '@/lib/leaveBlocksStore';
import TodaysPlan from '@/components/TodaysPlan';
import TaskList from '@/components/TaskList';
import WeeklyTaskOverview from '@/components/WeeklyTaskOverview';
import UnclearTriageDialog from '@/components/UnclearTriageDialog';
import CalendarTaskDetailModal from '@/components/CalendarTaskDetailModal';
import OnLeaveDashboard from '@/components/OnLeaveDashboard';
import CatchUpPlanCard from '@/components/CatchUpPlanCard';
import BacklogStrip from '@/components/BacklogStrip';
import type { PlanItem } from '@/lib/planner';
import {
  useQuickSession,
  startSession,
  endSession,
  type ActiveSession,
} from '@/lib/quickSessionStore';
import UnscheduledDayBanner from '@/components/UnscheduledDayBanner';
import QuickSessionModal from '@/components/QuickSessionModal';
import QuickSessionBar from '@/components/QuickSessionBar';
import QuickSessionSummaryModal from '@/components/QuickSessionSummaryModal';

interface Props {
  sidebarTasks: SidebarTask[];
  onToggleSidebarTask: (id: string) => void;
  manualTasks: ManualTask[];
  weekSetup: WeekSetup | null;
  onUpdateAvailability: (hours: number, days: string[], minutesByDay?: Record<string, number>, adminBlocksByDay?: Record<string, AdminTimeBlock[]>) => void;
  onNavigate: (tab: TabType) => void;
  onOpenEmail: (emailId: number) => void;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
// Buffer minutes the planner assumes per week for unscheduled overhead
// (interruptions, context-switching).
const projectedExtra = 45;

function formatDayKey(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

export default function HomeTab({ sidebarTasks, manualTasks, weekSetup, onUpdateAvailability, onNavigate, onOpenEmail }: Props) {
  const { profile } = useAppSettingsCache();
  const linkedDocTasks = useLinkedDocTasks();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  // Must be above usePlannerOutput so we can pass session capacity in.
  const { session: activeSession } = useQuickSession();
  const plannerOutput = usePlannerOutput(
    manualTasks,
    weekSetup,
    // Pass session capacity so the planner redistributes today's workload
    // across the session window instead of deferring everything to later days.
    activeSession?.durationMin ?? 0,
  );
  const leaveBlocks = useLeaveBlocks();

  // Leave context for the dashboard banner. Pure derivation from the
  // leave store + the current weekday pattern; advisory, never
  // behaviour-changing. We pass per-weekday working minutes so a
  // half-day leave isn't misreported as "fully on leave today" — must
  // stay in lockstep with CalendarTab + usePlannerOutput.
  const workingMinutesByWeekday = useMemo(() => {
    if (!weekSetup || weekSetup.days.length === 0) return undefined;
    const totalMins = Math.round(weekSetup.hours * 60);
    const evenSplit = Math.round(totalMins / weekSetup.days.length);
    const m = new Map<string, number>();
    for (const day of weekSetup.days) {
      const override = weekSetup.minutesByDay?.[day];
      m.set(day, override != null ? override : evenSplit);
    }
    return m;
  }, [weekSetup]);
  const leaveStatus = useMemo(
    () => currentLeaveStatus(
      new Date(),
      leaveBlocks,
      new Set(weekSetup?.days ?? []),
      workingMinutesByWeekday,
    ),
    [leaveBlocks, weekSetup?.days, workingMinutesByWeekday],
  );

  // Pre-leave finish-line warning: items whose deadline lands inside
  // an upcoming leave block within the next 14 days. We feed manual
  // tasks (they carry a `deadline` in days-from-today via the planner
  // pipeline) — sidebar tasks have no deadline so they're excluded.
  // We pass `cat` as category so itemsAtRiskBeforeLeave can filter out
  // LOW-band items (ADMIN/CPD/NONE) — routine work can wait, clinical
  // and legal deadlines cannot.
  const atRiskItems = useMemo(() => {
    const inputs: AtRiskInput[] = manualTasks
      .filter((t) => !t.done)
      .map((t) => ({
        id: t.id,
        title: t.title,
        deadlineDays: t.deadline,
        category: t.cat as AiCategory,
      }));
    return itemsAtRiskBeforeLeave(new Date(), leaveBlocks, inputs, 14);
  }, [manualTasks, leaveBlocks]);

  // ---- Quick session (unscheduled day) ----
  // (activeSession is declared above, before usePlannerOutput)
  const [showSessionModal, setShowSessionModal] = useState(false);

  interface SessionSummary {
    session: ActiveSession;
    actualMin: number;
    emailsHandled: number;
    tasksCompleted: number;
  }
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);

  // Detect if today is an unscheduled weekday (not in weekSetup.days).
  const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  const todayAbbr = DOW_ABBR[new Date().getDay()];
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(todayAbbr);
  const isUnscheduledToday =
    weekSetup != null &&
    isWeekday &&
    !weekSetup.days.includes(todayAbbr) &&
    leaveStatus.state !== 'on-leave-today' &&
    !activeSession;

  const handleSessionEnd = useCallback(() => {
    const s = endSession();
    if (!s) return;
    const actualMin = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
    const emailsHandled = Math.max(
      0,
      (acknowledged.size - s.snapshot.acknowledgedCount) +
      (archived.size - s.snapshot.archivedCount),
    );
    const tasksCompleted = Math.max(
      0,
      manualTasks.filter((t) => t.done).length - s.snapshot.doneTaskCount,
    );
    setSessionSummary({ session: s, actualMin, emailsHandled, tasksCompleted });
  }, [acknowledged.size, archived.size, manualTasks]);

  const handleAddDayToSchedule = () => {
    if (!sessionSummary || !weekSetup) return;
    const { session } = sessionSummary;
    const newDays = [...weekSetup.days, session.dayAbbr].sort(
      (a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b),
    );
    const sessionMins = session.durationMin;
    const newMinutes: Record<string, number> = {
      ...(weekSetup.minutesByDay ?? {}),
      [session.dayAbbr]: sessionMins,
    };
    const newTotalMins = newDays.reduce((s, d) => s + (newMinutes[d] ?? 0), 0);
    const newHours = +(newTotalMins / 60).toFixed(2);
    onUpdateAvailability(newHours, newDays, newMinutes, weekSetup.adminBlocksByDay);
    setSessionSummary(null);
  };

  // Day navigation in the Home dashboard — clinician can step through the
  // runway with prev/next chevrons to see how the AI organised the week.
  // Default = today (index 0). Clamps if the runway shrinks under us.
  const [dayIndex, setDayIndex] = useState(0);
  // Day vs Week view for the plan card. Week mode shows all runway days
  // as parallel columns and collapses the side-by-side My-tasks layout
  // so the plan can take the full row width.
  const [planView, setPlanView] = useState<'day' | 'week'>('day');
  // Inline triage modal — clicking an "emails need classifying" row
  // opens the dialog right here on the dashboard so the clinician
  // doesn't have to bounce over to the inbox and back.
  const [triageOpen, setTriageOpen] = useState(false);
  // Unified task detail / edit popup — opened from Today's Plan,
  // My Tasks, and Week Ahead so they all behave like the calendar.
  const [selectedTask, setSelectedTask] = useState<{ item: PlanItem; date: string } | null>(null);
  const runwayLen = plannerOutput.runway.length;
  const safeDayIndex = Math.min(dayIndex, Math.max(0, runwayLen - 1));
  const currentDay = plannerOutput.runway[safeDayIndex] ?? plannerOutput.todaysPlan;

  const isLinkedDocTask = (t: ManualTask) =>
    !!t.linkedEmailId && linkedDocTasks.has(t.linkedEmailId);

  // "Pending, by priority" — counts pending INBOX EMAILS only, bucketed
  // Urgent / Medium / Low. Matches the InboxTab's pending definition
  // exactly (acknowledged OR archived → out of inbox) so the two views
  // never disagree. Tasks deliberately excluded — the card is framed
  // around email handling and "My tasks" has its own surface below.
  const priorityCounts = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 } as Record<Priority, number>;
    for (const e of emails) {
      if (e.cat === CAT.NONE) continue;
      if (acknowledged.has(e.id)) continue;
      if (archived.has(e.id)) continue;
      counts[getEmailPriority(e)]++;
    }
    return counts;
  }, [acknowledged, archived]);

  // ---- AI recommendation panel (lets the clinician top up hours
  // straight from Home) ----
  const emailMins = emails.reduce((a, e) => a + e.estMin, 0);
  const taskMins = manualTasks
    .filter(t => !t.done && !isLinkedDocTask(t))
    .reduce((a, t) => a + t.estMin, 0);
  const recommendedMins = Math.round(Math.max(emailMins + taskMins + projectedExtra, 284) * 1.1 / 10) * 10;

  const activeDays = weekSetup ? weekSetup.days : weekData.map(d => d.day);

  const minutesPerDay = useMemo<Record<string, number>>(() => {
    if (!weekSetup) {
      return Object.fromEntries(weekData.map(d => [d.day, d.planned]));
    }
    const totalMins = Math.round(weekSetup.hours * 60);
    const overrides = weekSetup.minutesByDay ?? {};
    const evenSplit = weekSetup.days.length > 0 ? Math.round(totalMins / weekSetup.days.length) : 0;
    const result: Record<string, number> = {};
    for (const d of weekSetup.days) {
      result[d] = overrides[d] != null ? overrides[d] : evenSplit;
    }
    return result;
  }, [weekSetup]);

  const allocatedMins = weekSetup
    ? activeDays.reduce((sum, d) => sum + (minutesPerDay[d] ?? 0), 0)
    : weekData.reduce((a, d) => a + d.planned, 0);
  const isAtRisk = allocatedMins < recommendedMins;
  const shortfall = recommendedMins - allocatedMins;

  // Pick the two best days to top up — least-loaded active days first,
  // then any inactive admin days so the clinician can opt-in.
  const recommendedDays = useMemo(() => {
    const sortedActive = [...activeDays].sort((a, b) => {
      const ma = minutesPerDay[a] ?? 0;
      const mb = minutesPerDay[b] ?? 0;
      if (ma !== mb) return ma - mb;
      return ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b);
    });
    const inactive = ALL_DAYS.filter(d => !activeDays.includes(d));
    return [...sortedActive, ...inactive].slice(0, 2);
  }, [activeDays, minutesPerDay]);

  const [showWhyRec, setShowWhyRec] = useState(false);
  const [recToast, setRecToast] = useState<string | null>(null);

  type UndoSnapshot = { hours: number; days: string[]; minutesByDay?: Record<string, number>; adminBlocksByDay?: Record<string, AdminTimeBlock[]> };
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);

  // Pending quick-add: set when the user clicks +30min / +1h so we can
  // ask for a start time before committing the block.
  const [pendingAdd, setPendingAdd] = useState<{ day: string; durationMin: number } | null>(null);

  const showRecToast = (msg: string) => {
    setRecToast(msg);
    window.setTimeout(() => setRecToast(prev => {
      if (prev === msg) {
        setUndoSnapshot(null);
        return null;
      }
      return prev;
    }), 2800);
  };

  const captureSnapshot = (): UndoSnapshot | null => {
    if (!weekSetup) return null;
    return {
      hours: weekSetup.hours,
      days: [...weekSetup.days],
      minutesByDay: weekSetup.minutesByDay ? { ...weekSetup.minutesByDay } : undefined,
      adminBlocksByDay: weekSetup.adminBlocksByDay ? { ...weekSetup.adminBlocksByDay } : undefined,
    };
  };

  // Opens the start-time picker dialog instead of adding immediately.
  const handleAddMinutesToDay = (day: string, minsToAdd: number = 30) => {
    setPendingAdd({ day, durationMin: minsToAdd });
  };

  const handleBlockConfirmed = (block: AdminTimeBlock) => {
    if (!pendingAdd) return;
    const { day, durationMin } = pendingAdd;
    setPendingAdd(null);

    const snapshot = captureSnapshot();
    const baseDays = weekSetup?.days ?? [];
    const newDays = baseDays.includes(day)
      ? baseDays
      : [...baseDays, day].sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));

    // Merge the new block into adminBlocksByDay, sorted by start.
    const existingBlocks = weekSetup?.adminBlocksByDay?.[day] ?? [];
    const newBlocks = [...existingBlocks, block].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    const nextAdminBlocks: Record<string, AdminTimeBlock[]> = {
      ...(weekSetup?.adminBlocksByDay ?? {}),
      [day]: newBlocks,
    };

    // Recompute minutesByDay from block durations so both are in sync.
    const nextMinutes: Record<string, number> = {};
    for (const d of newDays) {
      const blocks = d === day ? newBlocks : (weekSetup?.adminBlocksByDay?.[d] ?? []);
      if (blocks.length > 0) {
        nextMinutes[d] = blocks.reduce((s, b) => s + b.durationMin, 0);
      } else {
        nextMinutes[d] = minutesPerDay[d] ?? 0;
      }
    }

    const newTotalMins = Object.values(nextMinutes).reduce((a, b) => a + b, 0);
    const newHours = +(newTotalMins / 60).toFixed(2);
    onUpdateAvailability(newHours, newDays, nextMinutes, nextAdminBlocks);
    setUndoSnapshot(snapshot);
    showRecToast(`Added ${fmtMins(durationMin)} block to ${day} at ${block.start}`);
  };

  const handleRebalance = () => {
    const snapshot = captureSnapshot();
    const baseHours = weekSetup?.hours ?? 0;
    const baseDays = weekSetup?.days ?? [];
    const days = baseDays.length > 0 ? baseDays : ['Tue', 'Wed', 'Thu'];
    const recommendedHoursRaw = recommendedMins / 60;
    const targetHours = Math.max(baseHours, Math.ceil(recommendedHoursRaw * 2) / 2);
    onUpdateAvailability(targetHours, days, undefined);
    setUndoSnapshot(snapshot);
    const perDay = Math.round((targetHours * 60) / days.length);
    showRecToast(`Rebalanced to ${fmtMins(perDay)} per day across ${days.length} day${days.length !== 1 ? 's' : ''}`);
  };

  const handleUndoRec = () => {
    if (!undoSnapshot) return;
    onUpdateAvailability(undoSnapshot.hours, undoSnapshot.days, undoSnapshot.minutesByDay, undoSnapshot.adminBlocksByDay);
    setUndoSnapshot(null);
    setRecToast(null);
  };

  // ---- Status banner ----
  const status = plannerOutput.overallStatus;
  const statusStyles = {
    red:   { bg: 'bg-red-100',   icon: 'text-red-600',   text: 'text-red-600',   Ico: ShieldAlert    },
    amber: { bg: 'bg-amber-100', icon: 'text-amber-500', text: 'text-amber-600', Ico: AlertTriangle  },
    green: { bg: 'bg-green-100', icon: 'text-green-600', text: 'text-green-600', Ico: CheckCircle2   },
  }[status];
  const StatusIcon = statusStyles.Ico;

  // ---- "Emails handled for you this week" hero ----
  // Union of three sets, deduped on emailId, scoped to "this week":
  //   - safelyDeferred: planner pushed beyond this week's runway AND
  //     NOT in a breach. Every deferred item in planner output is
  //     co-pushed with a breach when its SLA can't be met
  //     (no_capacity_before_sla / already_overdue), so we filter
  //     those out — unsafe deferrals are problems, not "handled".
  //   - archived this week: clinician archived (acknowledged-no-action
  //     OR done) since the start of this week. ArchiveEntry carries
  //     `at` so we can scope properly.
  //   - acknowledged: the acknowledgedStore is a Set<emailId> with no
  //     timestamps, so we fall back to "all currently acknowledged".
  //     If clinician scoping becomes important here we'd need to add
  //     `at` to that store too — flagged for later.
  // Hours saved = sum of email.estMin for the union, rounded to hours.
  //
  // Time-of-day values (startOfWeekMs, isMonday) intentionally NOT
  // memoised — they must re-evaluate each render so a tab left open
  // across midnight or Sun→Mon rollover picks up the new week / new
  // copy variant without needing a manual refresh.
  const now = new Date();
  const startOfWeekDate = new Date(now);
  startOfWeekDate.setHours(0, 0, 0, 0);
  // Monday as start-of-week. JS getDay(): Sun=0, Mon=1, ..., Sat=6.
  const dow = startOfWeekDate.getDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  startOfWeekDate.setDate(startOfWeekDate.getDate() - daysSinceMonday);
  const startOfWeekMs = startOfWeekDate.getTime();
  const isMonday = now.getDay() === 1;

  const breachedEmailIds = useMemo(() => {
    const s = new Set<number>();
    for (const b of plannerOutput.breaches) {
      if (typeof b.itemId === 'number') s.add(b.itemId);
    }
    return s;
  }, [plannerOutput.breaches]);

  const handledThisWeek = useMemo(() => {
    const ids = new Set<number>();
    for (const item of plannerOutput.deferredItems) {
      if (
        item.kind === 'email' &&
        typeof item.refId === 'number' &&
        !breachedEmailIds.has(item.refId)
      ) {
        ids.add(item.refId);
      }
    }
    for (const [id, entry] of archived) {
      if (entry.at >= startOfWeekMs) ids.add(id);
    }
    for (const id of acknowledged) ids.add(id);
    return ids;
  }, [plannerOutput.deferredItems, breachedEmailIds, archived, acknowledged, startOfWeekMs]);

  const weeklyHandledCount = handledThisWeek.size;
  const timeSavedLabel = useMemo(() => {
    let mins = 0;
    for (const e of emails) {
      if (handledThisWeek.has(e.id)) mins += e.estMin;
    }
    if (mins < 60) return `≈${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m >= 30 ? `≈${h}.5h` : `≈${h}h`;
  }, [handledThisWeek]);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* Greeting */}
      <div className="flex items-center gap-4 pb-1">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Sun size={26} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Good morning, {profile.fullName}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here's your plan for today. Follow it and you're on top of your admin.</p>
        </div>
      </div>

      {/* Quick-session countdown bar — shown while a session is active,
          regardless of any other state. Stays above all dashboard content
          so the clinician always sees the timer. */}
      {activeSession && (
        <QuickSessionBar session={activeSession} onEnd={handleSessionEnd} />
      )}

      {/* Unscheduled-day prompt — shown when today isn't in the
          clinician's weekly schedule and no session is running. */}
      {isUnscheduledToday && (
        <UnscheduledDayBanner
          dayAbbr={todayAbbr}
          onStartSession={() => setShowSessionModal(true)}
        />
      )}

      {/* On-leave-today short-circuits the whole dashboard body. The
          rest of the page (banners, weekly handled card, status,
          today's plan, my tasks, week ahead) is hidden in favour of
          a single calm panel — the planner has nothing useful to
          say while the clinician is off, and an empty plan looks
          alarming. Other tabs are unchanged so navigation still works. */}
      {leaveStatus.state === 'on-leave-today' && (
        <OnLeaveDashboard
          block={leaveStatus.block}
          dayBackKey={leaveStatus.dayBackKey}
        />
      )}

      {leaveStatus.state !== 'on-leave-today' && (<>

      {/* Leave-context surfaces. The on-leave-today variant is folded
          into OnLeaveDashboard above. Back-today gets the richer
          CatchUpPlanCard (auto-generated catch-up plan: pile,
          time math, leave-excused breaches). Leave-starts-soon
          keeps the slim sky banner. */}
      {leaveStatus.state === 'back-today' && (() => {
        const pendingEmails = emails.filter(
          (e) => e.cat !== CAT.NONE && !acknowledged.has(e.id) && !archived.has(e.id),
        );
        const pendingCount =
          priorityCounts.High + priorityCounts.Medium + priorityCounts.Low;
        const pendingEmailMin = pendingEmails.reduce((s, e) => s + e.estMin, 0);
        const pendingTaskMin = manualTasks
          .filter((t) => !t.done && !isLinkedDocTask(t))
          .reduce((s, t) => s + t.estMin, 0);
        const totalEstimateMin = pendingEmailMin + pendingTaskMin;
        const weekCapacityMin = plannerOutput.runway.reduce(
          (s, d) => s + d.minutesAvailable,
          0,
        );
        // 14-day rule excused only for routine categories. Anything
        // clinical/safeguarding/urgent/legal/professional that won't
        // fit is NOT excused — those still need clinician action.
        const ROUTINE = new Set(['ADMIN', 'CPD', 'NONE']);
        const routineBreachCount = plannerOutput.breaches.filter((b) =>
          ROUTINE.has(b.category),
        ).length;
        const urgentBreachCount =
          plannerOutput.breaches.length - routineBreachCount;
        return (
          <CatchUpPlanCard
            daysAway={leaveStatus.daysAway}
            pendingCount={pendingCount}
            pendingByPriority={priorityCounts}
            totalEstimateMin={totalEstimateMin}
            weekCapacityMin={weekCapacityMin}
            routineBreachCount={routineBreachCount}
            urgentBreachCount={urgentBreachCount}
            onNavigateInbox={() => onNavigate('Emails')}
          />
        );
      })()}

      {leaveStatus.state === 'leave-starts-soon' && (
        <div
          className="rounded-xl border border-sky-200 bg-sky-50 text-sky-900 px-5 py-3.5 flex items-start gap-3"
          data-testid="home-leave-banner-leave-starts-soon"
        >
          <Plane size={18} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0 text-sm leading-snug">
            <p className="font-bold">
              {LEAVE_TYPE_LABEL[leaveStatus.block.leaveType]} starts{' '}
              {leaveStatus.daysUntil === 0
                ? 'later today'
                : leaveStatus.daysUntil === 1
                ? 'tomorrow'
                : `in ${leaveStatus.daysUntil} days`}
              .
            </p>
            <p className="text-xs mt-0.5">
              Anything you can finish this week won't pile up while you're away.
            </p>
          </div>
        </div>
      )}

      {/* Pre-leave finish-line warning — distinct from the leave-context
          banner above. Shows the highest-priority clinical/legal tasks
          whose deadlines land during upcoming leave so the clinician
          can sort them before going away. Routine admin items are
          filtered out — they can wait or be delegated. Advisory only. */}
      {atRiskItems.length > 0 && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 flex items-start gap-3"
          data-testid="home-leave-at-risk-banner"
        >
          <AlertTriangle size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 text-sm leading-snug text-amber-900">
            <p className="font-bold">
              {atRiskItems.length === 1
                ? '1 thing to sort before you go'
                : `${atRiskItems.length} things to sort before you go`}
            </p>
            <p className="text-xs text-amber-800 mt-0.5 mb-1.5">
              Clinical or time-sensitive deadlines that fall during your leave.
            </p>
            <ul className="text-xs space-y-0.5">
              {atRiskItems.map((r) => (
                <li key={r.item.id} className="truncate">
                  <strong>{formatDayKey(r.deadlineKey)}</strong> — {r.item.title}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Backlog catch-up strip — shown when there are pending catch-up
          items from a previous inbox scan AND the clinician is not in
          the "back today" state (CatchUpPlanCard covers that case). */}
      {leaveStatus.state !== 'back-today' && (
        <BacklogStrip onNavigateToBacklog={() => onNavigate('Backlog Recovery')} />
      )}

      {/* Weekly handled + priority triage card. Sits above the status
          banner so the clinician sees what's been handled and what's
          pending before the week-plan reassurance copy. */}
      <div
        className="bg-white border border-border/50 rounded-xl p-7"
        data-testid="weekly-handled-card"
      >
        {/* Hero — handled count + hours saved */}
        {weeklyHandledCount === 0 && isMonday ? (
          <div data-testid="weekly-handled-monday-variant">
            <p className="text-[44px] font-medium leading-tight tracking-tight text-foreground">
              Fresh week
            </p>
            <p className="text-[15px] text-muted-foreground mt-1">
              Let&apos;s get into it. Your plan for the week is below.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline flex-wrap gap-x-3">
              <span
                className="text-[72px] font-medium leading-none tracking-tight text-foreground tabular-nums"
                data-testid="weekly-hours-saved"
              >
                {timeSavedLabel}
              </span>
              <span className="text-[22px] font-medium text-foreground">
                of admin time cleared this week
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-2.5 text-[14px] text-muted-foreground">
              <Check size={14} strokeWidth={2} />
              <span data-testid="weekly-handled-count">
                {weeklyHandledCount} email{weeklyHandledCount !== 1 ? 's' : ''} sorted
              </span>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-border/50 mt-6 pt-5">
          <p className="text-[14px] text-muted-foreground mb-3">
            Pending, by priority
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { key: 'High' as const, label: 'Urgent', cls: 'bg-red-50 text-red-700' },
              { key: 'Medium' as const, label: 'Medium', cls: 'bg-amber-50 text-amber-800' },
              { key: 'Low' as const, label: 'Low', cls: 'bg-slate-100 text-muted-foreground' },
            ]).map(({ key, label, cls }) => {
              const count = priorityCounts[key];
              const numberCls = key === 'Low' ? 'text-foreground' : '';
              return (
                <span
                  key={key}
                  data-testid={`pending-pill-${label.toLowerCase()}`}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-[5px] text-[13px]',
                    cls,
                  )}
                >
                  <span className={cn('font-medium tabular-nums', numberCls)}>{count}</span>
                  <span className="font-normal">{label}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Status + AI recommendation banner — left column is the at-a-glance
          status; right column lets the clinician top up hours directly so
          the week plan readjusts inline. */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="p-6 flex items-start gap-4" data-testid={`status-banner-${status}`}>
            <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', statusStyles.bg)}>
              <StatusIcon size={24} className={statusStyles.icon} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground font-medium">You're currently:</p>
              <p className={cn('text-xl font-bold', statusStyles.text)} data-testid="status-banner-headline">
                {plannerOutput.statusHeadline}
              </p>
              <p className="text-sm text-foreground" data-testid="status-banner-detail">
                {plannerOutput.statusDetail}
              </p>
              <p className="text-xs text-muted-foreground">
                You have <strong>{fmtMins(allocatedMins)}</strong> admin booked this week
                {activeDays.length > 0 && <> across <strong>{activeDays.join(', ')}</strong></>}.
              </p>
              {plannerOutput.recommendation && (
                <p className={cn('text-sm font-medium', statusStyles.text)} data-testid="status-banner-recommendation">
                  {plannerOutput.recommendation}
                </p>
              )}
            </div>
          </div>

          <div className="p-6 bg-slate-50/60 border-l border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">AI recommendation</p>
            {isAtRisk ? (
              <>
                <p className="text-lg font-bold text-foreground leading-tight mb-1">
                  Top up your week by {fmtMins(Math.max(shortfall, 30))}
                </p>
                <div className="flex items-center gap-2 mb-4">
                  <p className="text-sm text-muted-foreground">
                    {recommendedDays[0]
                      ? <>Best option: add a 30-min slot to {recommendedDays[0]} afternoon. Tap once for +30min, twice for +1h.</>
                      : <>Top up your week to cover the shortfall.</>}
                  </p>
                  <span className="text-amber-500 text-xl">↷</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {recommendedDays[0] && (
                    <div className="inline-flex rounded-lg overflow-hidden border border-primary shadow-sm" data-testid="button-rec-add-group-primary">
                      <button
                        onClick={() => handleAddMinutesToDay(recommendedDays[0], 30)}
                        className="bg-primary text-white text-xs font-bold px-3 py-2 hover:bg-primary/90 transition-colors"
                        data-testid="button-rec-add-30-primary"
                      >
                        +30min {recommendedDays[0]}
                      </button>
                      <button
                        onClick={() => handleAddMinutesToDay(recommendedDays[0], 60)}
                        className="bg-primary/80 text-white text-xs font-bold px-3 py-2 border-l border-white/30 hover:bg-primary/90 transition-colors"
                        data-testid="button-rec-add-60-primary"
                        aria-label={`Add 1 hour to ${recommendedDays[0]}`}
                      >
                        +1h
                      </button>
                    </div>
                  )}
                  {recommendedDays[1] && (
                    <div className="inline-flex rounded-lg overflow-hidden border border-border" data-testid="button-rec-add-group-secondary">
                      <button
                        onClick={() => handleAddMinutesToDay(recommendedDays[1], 30)}
                        className="bg-white text-foreground text-xs font-bold px-3 py-2 hover:bg-accent transition-colors"
                        data-testid="button-rec-add-30-secondary"
                      >
                        +30min {recommendedDays[1]}
                      </button>
                      <button
                        onClick={() => handleAddMinutesToDay(recommendedDays[1], 60)}
                        className="bg-slate-50 text-foreground text-xs font-bold px-3 py-2 border-l border-border hover:bg-accent transition-colors"
                        data-testid="button-rec-add-60-secondary"
                        aria-label={`Add 1 hour to ${recommendedDays[1]}`}
                      >
                        +1h
                      </button>
                    </div>
                  )}
                  <button
                    onClick={handleRebalance}
                    className="bg-white border border-border text-foreground text-xs font-bold px-4 py-2 rounded-lg hover:bg-accent transition-colors"
                    data-testid="button-rec-rebalance"
                  >
                    Rebalance my week
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-foreground leading-tight mb-1">You're well-planned for this week</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Your {fmtMins(allocatedMins)} allocation covers all current and projected workload.
                </p>
              </>
            )}
            {recToast && (
              <div
                className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full animate-in fade-in"
                data-testid="rec-toast"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Check size={11} /> {recToast}
                </span>
                {undoSnapshot && (
                  <>
                    <span className="text-green-300">·</span>
                    <button
                      type="button"
                      onClick={handleUndoRec}
                      className="text-green-700 hover:text-green-800 underline underline-offset-2 font-bold"
                      data-testid="button-rec-undo"
                    >
                      Undo
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              onClick={() => setShowWhyRec(v => !v)}
              className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
              data-testid="button-rec-why"
            >
              See why this is recommended
              <ChevronDown size={12} className={cn("transition-transform", showWhyRec && "rotate-180")} />
            </button>
            {showWhyRec && (
              <div className="mt-3 p-3 bg-white border border-border rounded-xl text-xs text-muted-foreground space-y-1">
                <p><strong className="text-foreground">Emails:</strong> {fmtMins(emailMins)} across {emails.length} items in your inbox.</p>
                <p><strong className="text-foreground">Tasks:</strong> {fmtMins(taskMins)} across {manualTasks.length} clinical/admin tasks.</p>
                <p><strong className="text-foreground">Buffer:</strong> {fmtMins(projectedExtra)} projected overhead based on your history.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Today's/Week's plan + My tasks. In Day mode the two sit
          side-by-side (3/5 + 2/5) on wide screens. In Week mode the
          plan takes the full row and My tasks drops beneath so the
          parallel-column grid has room to breathe. */}
      {(() => {
        const plan = (
          <TodaysPlan
            todaysPlan={currentDay}
            overallStatus={plannerOutput.overallStatus}
            unclearCount={plannerOutput.unclearCount}
            dayIndex={safeDayIndex}
            totalDays={runwayLen}
            onPrevDay={() => setDayIndex(i => Math.max(0, i - 1))}
            onNextDay={() => setDayIndex(i => Math.min(runwayLen - 1, i + 1))}
            onJumpToday={() => setDayIndex(0)}
            viewMode={planView}
            onChangeViewMode={setPlanView}
            runway={plannerOutput.runway}
            // Pass the full list so the gate banner can render every unclear
            // email as its own clickable row — the clinician can work through
            // them one after another (each classification removes its row via
            // live recalc).
            unclearEmails={plannerOutput.unclearEmailIds
              .map(id => {
                const e = emails.find(x => x.id === id);
                return e ? { id: e.id, subject: e.subject, from: e.from } : null;
              })
              .filter((e): e is { id: number; subject: string; from: string } => e !== null)}
            onTriageUnclear={() => setTriageOpen(true)}
            onItemClick={(item, dateIso) => {
              // Email items still jump to the Inbox — they're managed
              // there. Tasks and events open the shared detail popup
              // so the dashboard matches the calendar's behaviour.
              if (typeof item.refId === 'number') {
                onOpenEmail(item.refId);
                onNavigate('Emails');
                return;
              }
              setSelectedTask({ item, date: dateIso });
            }}
          />
        );
        const tasks = (
          // My tasks — the clinician's hand-curated list. Anything
          // added here also flows into the planner and onto the
          // Week ahead grid below + the full Calendar tab.
          <TaskList
            runway={plannerOutput.runway}
            onOpenEmail={onOpenEmail}
            onOpenTaskDetail={(item, dateIso) =>
              setSelectedTask({ item, date: dateIso })
            }
          />
        );
        if (planView === 'week') {
          return (
            <div className="space-y-5">
              {plan}
              {tasks}
            </div>
          );
        }
        return (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
            <div className="xl:col-span-3">{plan}</div>
            <div className="xl:col-span-2">{tasks}</div>
          </div>
        );
      })()}

      {/* Week ahead — the diary view. Replaces the old mini workload
          calendar: same purpose, but actually readable and you can
          add to it. */}
      <WeeklyTaskOverview
        runway={plannerOutput.runway}
        onOpenEmail={onOpenEmail}
        onOpenTaskDetail={(item, dateIso) => setSelectedTask({ item, date: dateIso })}
      />

      </>)}

      {selectedTask && (
        <CalendarTaskDetailModal
          item={selectedTask.item}
          scheduledDate={selectedTask.date}
          onClose={() => setSelectedTask(null)}
          initialMode="details"
        />
      )}

      {/* Inline unclear-email triage. Opens from Today's Plan when
          the clinician clicks an "emails need classifying" row. Keeps
          them on Home — no inbox round-trip. */}
      <UnclearTriageDialog
        open={triageOpen}
        emailIds={plannerOutput.unclearEmailIds}
        onClose={() => setTriageOpen(false)}
        onOpenInInbox={(id) => {
          onOpenEmail(id);
          onNavigate('Emails');
        }}
      />

      {pendingAdd && (
        <AddTimeBlockDialog
          day={pendingAdd.day}
          durationMin={pendingAdd.durationMin}
          existingBlocks={weekSetup?.adminBlocksByDay?.[pendingAdd.day] ?? []}
          onConfirm={handleBlockConfirmed}
          onCancel={() => setPendingAdd(null)}
        />
      )}

      {/* Quick-session duration picker */}
      {showSessionModal && (
        <QuickSessionModal
          dayAbbr={todayAbbr}
          onStart={(durationMin) => {
            startSession(durationMin, {
              acknowledgedCount: acknowledged.size,
              archivedCount: archived.size,
              doneTaskCount: manualTasks.filter((t) => t.done).length,
            });
            setShowSessionModal(false);
          }}
          onCancel={() => setShowSessionModal(false)}
        />
      )}

      {/* Post-session summary */}
      {sessionSummary && (
        <QuickSessionSummaryModal
          result={sessionSummary}
          alreadyScheduled={
            weekSetup?.days.includes(sessionSummary.session.dayAbbr) ?? false
          }
          onAddToSchedule={handleAddDayToSchedule}
          onClose={() => setSessionSummary(null)}
        />
      )}
    </div>
  );
}
