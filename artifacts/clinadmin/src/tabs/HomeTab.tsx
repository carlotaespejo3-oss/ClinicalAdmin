import { useState, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Sun, ShieldAlert, Check, ChevronDown } from 'lucide-react';
import { emails, weekData, CAT } from '@/lib/data';
import { ManualTask, SidebarTask, TabType } from '@/lib/types';
import { cn, getEmailPriority, getTaskPriority, PRIORITY_PILL, type Priority } from '@/lib/utils';
import { WeekSetup } from '@/pages/ClinAdmin';
import { useLinkedDocTasks } from '@/lib/linkedDocTasksStore';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { useArchivedEmails } from '@/lib/archivedStore';
import { usePlannerOutput } from '@/lib/usePlannerOutput';
import TodaysPlan from '@/components/TodaysPlan';
import TaskList from '@/components/TaskList';
import WeeklyTaskOverview from '@/components/WeeklyTaskOverview';
import UnclearTriageDialog from '@/components/UnclearTriageDialog';

interface Props {
  sidebarTasks: SidebarTask[];
  onToggleSidebarTask: (id: string) => void;
  manualTasks: ManualTask[];
  weekSetup: WeekSetup | null;
  onUpdateAvailability: (hours: number, days: string[], minutesByDay?: Record<string, number>) => void;
  onNavigate: (tab: TabType) => void;
  onOpenEmail: (emailId: number) => void;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
// Buffer minutes the planner assumes per week for unscheduled overhead
// (interruptions, context-switching). Mirrors the constant in TodayTab so
// the "Top up by X" recommendation matches across views.
const projectedExtra = 45;

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

export default function HomeTab({ sidebarTasks, manualTasks, weekSetup, onUpdateAvailability, onNavigate, onOpenEmail }: Props) {
  const linkedDocTasks = useLinkedDocTasks();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const plannerOutput = usePlannerOutput(manualTasks, weekSetup);

  // Day navigation in the Home dashboard — clinician can step through the
  // runway with prev/next chevrons to see how the AI organised the week.
  // Default = today (index 0). Clamps if the runway shrinks under us.
  const [dayIndex, setDayIndex] = useState(0);
  // Inline triage modal — clicking an "emails need classifying" row
  // opens the dialog right here on the dashboard so the clinician
  // doesn't have to bounce over to the inbox and back.
  const [triageOpen, setTriageOpen] = useState(false);
  const runwayLen = plannerOutput.runway.length;
  const safeDayIndex = Math.min(dayIndex, Math.max(0, runwayLen - 1));
  const currentDay = plannerOutput.runway[safeDayIndex] ?? plannerOutput.todaysPlan;

  const isLinkedDocTask = (t: ManualTask) =>
    !!t.linkedEmailId && linkedDocTasks.has(t.linkedEmailId);

  // Priority summary: bucket all actionable items into Urgent / Medium / Low.
  // Subscribes to acknowledged + archived so handling an email in the Inbox
  // immediately decrements the pill count here too — without this the pills
  // would feel stale ("Urgent: 8" even after you've actioned them all).
  const priorityCounts = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 } as Record<Priority, number>;
    for (const e of emails) {
      if (e.cat === CAT.NONE) continue;
      if (acknowledged.has(e.id)) continue;
      if (archived.has(e.id)) continue;
      counts[getEmailPriority(e)]++;
    }
    for (const t of manualTasks) {
      if (t.done) continue;
      if (isLinkedDocTask(t)) continue;
      counts[getTaskPriority(t)]++;
    }
    for (const t of sidebarTasks) {
      if (t.done) continue;
      counts[t.priority === 'high' ? 'High' : 'Low']++;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualTasks, sidebarTasks, linkedDocTasks, acknowledged, archived]);

  // ---- AI recommendation panel (mirrors TodayTab so the clinician can
  // top up hours straight from Home without bouncing to Detailed View) ----
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

  type UndoSnapshot = { hours: number; days: string[]; minutesByDay?: Record<string, number> };
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);

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
    };
  };

  const handleAddMinutesToDay = (day: string, minsToAdd: number = 30) => {
    const snapshot = captureSnapshot();
    const baseDays = weekSetup?.days ?? [];
    const newDays = baseDays.includes(day)
      ? baseDays
      : [...baseDays, day].sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
    const nextMinutes: Record<string, number> = {};
    for (const d of newDays) {
      const current = minutesPerDay[d] ?? 0;
      nextMinutes[d] = d === day ? current + minsToAdd : current;
    }
    const newTotalMins = Object.values(nextMinutes).reduce((a, b) => a + b, 0);
    const newHours = +(newTotalMins / 60).toFixed(2);
    onUpdateAvailability(newHours, newDays, nextMinutes);
    setUndoSnapshot(snapshot);
    showRecToast(`Added ${fmtMins(minsToAdd)} to every ${day} in your weekly schedule`);
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
    onUpdateAvailability(undoSnapshot.hours, undoSnapshot.days, undoSnapshot.minutesByDay);
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
  const youAre = status === 'red' ? 'Behind' : status === 'amber' ? 'Tight' : 'On track';

  return (
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* Greeting */}
      <div className="flex items-center gap-4 pb-1">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Sun size={26} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Good morning, Dr. Morgan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here's your plan for today. Follow it and you're on top of your admin.</p>
        </div>
      </div>

      {/* Priority summary bar */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="priority-summary-bar"
        aria-label="Priority summary"
      >
        {([
          { key: 'High' as const, label: 'Urgent' },
          { key: 'Medium' as const, label: 'Medium' },
          { key: 'Low' as const, label: 'Low' },
        ]).map(({ key, label }) => {
          const count = priorityCounts[key];
          const zero = count === 0;
          return (
            <span
              key={key}
              data-testid={`priority-summary-${label.toLowerCase()}`}
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border',
                zero
                  ? 'text-muted-foreground bg-slate-50 border-slate-200 opacity-60'
                  : PRIORITY_PILL[key],
              )}
            >
              <span className="tabular-nums">{count}</span>
              <span>{label}</span>
            </span>
          );
        })}
      </div>

      {/* Status + AI recommendation banner — left column is the at-a-glance
          status; right column lets the clinician top up hours directly so
          the week plan readjusts without bouncing to the Detailed View. */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="p-6 flex items-start gap-4" data-testid={`status-banner-${status}`}>
            <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', statusStyles.bg)}>
              <StatusIcon size={24} className={statusStyles.icon} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground font-medium">You're currently:</p>
              <p className={cn('text-xl font-bold', statusStyles.text)} data-testid="status-banner-headline">
                {youAre} — {plannerOutput.statusHeadline}
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

      {/* Today's plan + mini workload calendar — paired side-by-side on
          wide screens so the clinician can scan upcoming load without
          leaving the home view. Today's plan dominates (3/5); calendar
          sits beside it (2/5). Stacks on narrow screens. */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
        <div className="xl:col-span-3">
          <TodaysPlan
            todaysPlan={currentDay}
            overallStatus={plannerOutput.overallStatus}
            unclearCount={plannerOutput.unclearCount}
            dayIndex={safeDayIndex}
            totalDays={runwayLen}
            onPrevDay={() => setDayIndex(i => Math.max(0, i - 1))}
            onNextDay={() => setDayIndex(i => Math.min(runwayLen - 1, i + 1))}
            onJumpToday={() => setDayIndex(0)}
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
            onItemClick={(item) => {
              if (typeof item.refId === 'number') {
                onOpenEmail(item.refId);
                onNavigate('Emails');
              } else if (item.kind === 'task') {
                onNavigate('Tasks');
              }
            }}
          />
        </div>
        <div className="xl:col-span-2">
          {/* My tasks — the clinician's hand-curated list. Anything
              added here also flows into the planner and onto the
              Week ahead grid below + the full Calendar tab. */}
          <TaskList runway={plannerOutput.runway} />
        </div>
      </div>

      {/* Week ahead — the diary view. Replaces the old mini workload
          calendar: same purpose, but actually readable and you can
          add to it. */}
      <WeeklyTaskOverview runway={plannerOutput.runway} />

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
    </div>
  );
}
