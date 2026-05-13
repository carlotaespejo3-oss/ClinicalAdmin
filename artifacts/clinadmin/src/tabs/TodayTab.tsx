import { useState, useMemo } from 'react';
import { AlertTriangle, ChevronRight, ChevronDown, CheckCircle2, CalendarDays, Mail, ClipboardList, ShieldCheck, Check, ShieldAlert, Flag } from 'lucide-react';
import { weekData, emails, CAT } from '@/lib/data';
import { ManualTask, TabType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { WeekSetup } from '@/pages/ClinAdmin';
import { usePlannerOutput } from '@/lib/usePlannerOutput';
import { useLinkedDocTasks } from '@/lib/linkedDocTasksStore';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { useArchivedEmails } from '@/lib/archivedStore';
import Runway14Day from '@/components/Runway14Day';
import ProjectedWorkload from '@/components/ProjectedWorkload';

interface Props {
  manualTasks: ManualTask[];
  weekSetup: WeekSetup | null;
  onOpenWeeklySetup: () => void;
  onUpdateAvailability: (hours: number, days: string[], minutesByDay?: Record<string, number>) => void;
  onNavigate: (tab: TabType) => void;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const projectedExtra = 45;

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

export default function TodayTab({ manualTasks, weekSetup, onOpenWeeklySetup, onUpdateAvailability, onNavigate }: Props) {
  const linkedDocTasks = useLinkedDocTasks();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const plannerOutput = usePlannerOutput(manualTasks, weekSetup);

  const isLinkedDocTask = (t: ManualTask) =>
    !!t.linkedEmailId && linkedDocTasks.has(t.linkedEmailId);

  // "Active" emails = ones still actually sitting in the inbox needing
  // attention. Anything acknowledged or archived has already been dealt
  // with and shouldn't count toward "deferred".
  const activeEmails = emails.filter(e =>
    e.cat !== CAT.NONE && !acknowledged.has(e.id) && !archived.has(e.id)
  );
  const todayEmailCount = plannerOutput.todaysPlan.items.filter(i => i.kind === 'email').length;
  const safelyDeferred = Math.max(activeEmails.length - todayEmailCount, 0);

  const emailMins = emails.reduce((a, e) => a + e.estMin, 0);
  const taskMins = manualTasks
    .filter(t => !t.done && !isLinkedDocTask(t))
    .reduce((a, t) => a + t.estMin, 0);
  const recommendedMins = Math.round(Math.max(emailMins + taskMins + projectedExtra, 284) * 1.1 / 10) * 10;

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
  const perDayRecommended = activeDays.length > 0 ? Math.round(recommendedMins / activeDays.length) : 0;
  const isAtRisk = allocatedMins < recommendedMins;
  const shortfall = recommendedMins - allocatedMins;

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

  const handleAddHourToDay = (day: string) => {
    const snapshot = captureSnapshot();
    const baseDays = weekSetup?.days ?? [];
    const newDays = baseDays.includes(day)
      ? baseDays
      : [...baseDays, day].sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
    const nextMinutes: Record<string, number> = {};
    for (const d of newDays) {
      const current = minutesPerDay[d] ?? 0;
      nextMinutes[d] = d === day ? current + 60 : current;
    }
    const newTotalMins = Object.values(nextMinutes).reduce((a, b) => a + b, 0);
    const newHours = +(newTotalMins / 60).toFixed(2);
    onUpdateAvailability(newHours, newDays, nextMinutes);
    setUndoSnapshot(snapshot);
    showRecToast(`Added 1h to every ${day} in your weekly schedule`);
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

  // Status banner styles (mirrored from HomeTab so the detailed view has
  // its own copy of the at-a-glance status).
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

      {/* Status + AI recommendation banner */}
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
                <p className="text-lg font-bold text-foreground leading-tight mb-1">Add 1 extra hour this week</p>
                <div className="flex items-center gap-2 mb-4">
                  <p className="text-sm text-muted-foreground">
                    {recommendedDays[0]
                      ? <>Best option: Add 1h {recommendedDays[0]} afternoon.</>
                      : <>Top up your week to cover the shortfall.</>}
                  </p>
                  <span className="text-amber-500 text-xl">↷</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {recommendedDays[0] && (
                    <button
                      onClick={() => handleAddHourToDay(recommendedDays[0])}
                      className="bg-primary text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                      data-testid="button-rec-add-hour-primary"
                    >
                      Add 1h {recommendedDays[0]}
                    </button>
                  )}
                  {recommendedDays[1] && (
                    <button
                      onClick={() => handleAddHourToDay(recommendedDays[1])}
                      className="bg-white border border-border text-foreground text-xs font-bold px-4 py-2 rounded-lg hover:bg-accent transition-colors"
                      data-testid="button-rec-add-hour-secondary"
                    >
                      Add 1h {recommendedDays[1]}
                    </button>
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

      {/* 14-day runway + projected workload — paired side-by-side on wide
          screens. Stack on narrow ones. The runway dominates (3/5) and
          the reservation breakdown sits beside it as a slim explainer. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3">
          <Runway14Day
            runway={plannerOutput.runway}
            onAddTimeToDay={handleAddHourToDay}
          />
        </div>
        <div className="lg:col-span-2">
          <ProjectedWorkload
            reservation={plannerOutput.reservation}
            weeklyCapacityMin={plannerOutput.weeklyCapacityMin}
          />
        </div>
      </div>

      {/* This Week — per-day allocation bars */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <CalendarDays size={18} className="text-blue-600" />
            </div>
            <h3 className="text-base font-bold">This Week</h3>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-1 rounded-full uppercase tracking-wide">
            Planned workload
          </span>
        </div>

        <div className="px-6 py-5 space-y-4">
          {activeDays.map(day => {
            const dayMins = minutesPerDay[day] ?? 0;
            const maxBar = Math.max(dayMins, perDayRecommended, 90);
            const plannedPct = Math.min((dayMins / maxBar) * 100, 100);
            const recPct = Math.min((perDayRecommended / maxBar) * 100, 100);
            const isOver = dayMins >= perDayRecommended;
            return (
              <div key={day} data-testid={`week-day-${day.toLowerCase()}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-bold text-foreground">{day}</span>
                  <span className="text-xs text-muted-foreground" data-testid={`week-day-${day.toLowerCase()}-mins`}>{fmtMins(dayMins)} planned</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${plannedPct}%` }}
                    />
                    {!isOver && (
                      <div
                        className="h-full bg-primary/15 border-l-2 border-dashed border-primary/30"
                        style={{ width: `${recPct - plannedPct}%` }}
                      />
                    )}
                  </div>
                  {!isOver && (
                    <span className="text-[10px] font-bold text-amber-600 whitespace-nowrap">
                      +{fmtMins(perDayRecommended - dayMins)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {activeDays.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No admin days set —{' '}
              <button onClick={onOpenWeeklySetup} className="text-primary font-semibold hover:underline">
                set up your week
              </button>
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total planned</span>
            <span className="font-semibold">{fmtMins(allocatedMins)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Recommended</span>
            <span className={cn("font-semibold", isAtRisk ? "text-amber-600" : "text-green-600")}>{fmtMins(recommendedMins)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Difference</span>
            <span className={cn("font-semibold", isAtRisk ? "text-amber-600" : "text-green-600")}>
              {isAtRisk ? `–${fmtMins(shortfall)}` : `+${fmtMins(allocatedMins - recommendedMins)}`}
            </span>
          </div>
          <button
            onClick={() => onNavigate('Weekly Plan')}
            className="mt-2 text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
          >
            See full weekly plan <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Bottom stats — 4 cards. Counts are derived from the live planner
          output, so deferring or completing items elsewhere updates these
          immediately. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0">
            <Mail size={20} className="text-teal-600" />
          </div>
          <div>
            <p className="text-2xl font-bold" data-testid="stat-deferred">{safelyDeferred}</p>
            <p className="text-sm font-semibold text-foreground">Emails safely deferred</p>
            <p className="text-xs text-muted-foreground">Scheduled for next week or later.</p>
          </div>
        </div>

        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <ClipboardList size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{manualTasks.filter(t => !t.done).length}</p>
            <p className="text-sm font-semibold text-foreground">Tasks scheduled</p>
            <p className="text-xs text-muted-foreground">Reports / letters / admin tasks.</p>
          </div>
        </div>

        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <ShieldCheck size={20} className="text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold">0</p>
            <p className="text-sm font-semibold text-foreground">Unsafe deferrals</p>
            <p className="text-xs text-muted-foreground">You're safe if you follow the plan.</p>
          </div>
        </div>

        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Flag size={20} className="text-slate-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">0</p>
            <p className="text-sm font-semibold text-foreground">Missed deadlines</p>
            <p className="text-xs text-muted-foreground">You're on top of everything.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
