import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, ChevronRight, CheckCircle2, CalendarDays, Mail, ClipboardList, ShieldCheck, Check, Users, CalendarClock, Sun, CalendarCheck, ChevronDown, Flag, Settings2, Minus, Plus, RotateCcw, ShieldAlert, FileText, ExternalLink } from 'lucide-react';
import { weekData, emails, CAT } from '@/lib/data';
import { Email, ManualTask, SidebarTask, TabType } from '@/lib/types';
import { cn, getEmailPriority, getTaskPriority, getEmailWhy, getTaskWhy, PRIORITY_PILL, PRIORITY_RANK, type Priority } from '@/lib/utils';
import { WeekSetup } from '@/pages/ClinAdmin';

interface Props {
  sidebarTasks: SidebarTask[];
  onToggleSidebarTask: (id: string) => void;
  manualTasks: ManualTask[];
  weekSetup: WeekSetup | null;
  onOpenWeeklySetup: () => void;
  onUpdateAvailability: (hours: number, days: string[], minutesByDay?: Record<string, number>) => void;
  onNavigate: (tab: TabType) => void;
  onOpenEmail: (emailId: number) => void;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

const projectedExtra = 45;


export default function HomeTab({ sidebarTasks, onToggleSidebarTask, manualTasks, weekSetup, onOpenWeeklySetup, onUpdateAvailability, onNavigate, onOpenEmail }: Props) {
  // Derived from live task state so completion in Tasks tab propagates here.
  // Note: emailMins is computed on every render so the rules-based estimator
  // (which mutates email.estMin in place when classifications stream in) is
  // reflected as soon as the surrounding tree re-renders.
  const emailMins = emails.reduce((a, e) => a + e.estMin, 0);
  const taskMins = manualTasks.filter(t => !t.done).reduce((a, t) => a + t.estMin, 0);
  const recommendedMins = Math.round(Math.max(emailMins + taskMins + projectedExtra, 284) * 1.1 / 10) * 10;
  const [showWhyRec, setShowWhyRec] = useState(false);
  // Local "handled today" tracking for visual progress only — the real
  // source of truth lives in the Emails / Tasks tabs.
  const [handledEmailIds, setHandledEmailIds] = useState<Set<number>>(new Set());
  const [handledTaskIds, setHandledTaskIds] = useState<Set<string>>(new Set());

  const buildInitialDraft = (): Record<string, number> => {
    if (!weekSetup) {
      return { Tue: 80, Wed: 80, Thu: 80 };
    }
    const total = Math.round(weekSetup.hours * 60);
    const overrides = weekSetup.minutesByDay ?? {};
    const evenSplit = weekSetup.days.length > 0 ? Math.round(total / weekSetup.days.length) : 0;
    const result: Record<string, number> = {};
    for (const d of weekSetup.days) {
      result[d] = overrides[d] != null ? overrides[d] : evenSplit;
    }
    return result;
  };

  const [draftMinutesByDay, setDraftMinutesByDay] = useState<Record<string, number>>(buildInitialDraft);
  const [savedFlash, setSavedFlash] = useState(false);
  const [recToast, setRecToast] = useState<string | null>(null);
  type UndoSnapshot = {
    hours: number;
    days: string[];
    minutesByDay?: Record<string, number>;
  };
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

  useEffect(() => {
    setDraftMinutesByDay(buildInitialDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekSetup?.hours, weekSetup?.days, weekSetup?.minutesByDay]);

  const draftDays = ALL_DAYS.filter(d => draftMinutesByDay[d] != null && draftMinutesByDay[d] > 0);
  const draftTotalMins = draftDays.reduce((a, d) => a + (draftMinutesByDay[d] ?? 0), 0);
  const draftHours = +(draftTotalMins / 60).toFixed(2);

  const dirty = (() => {
    if (!weekSetup) return draftDays.length > 0;
    const totalMins = Math.round(weekSetup.hours * 60);
    const overrides = weekSetup.minutesByDay ?? {};
    const evenSplit = weekSetup.days.length > 0 ? Math.round(totalMins / weekSetup.days.length) : 0;
    return ALL_DAYS.some(d => {
      const draft = draftMinutesByDay[d] ?? 0;
      const current = weekSetup.days.includes(d)
        ? (overrides[d] != null ? overrides[d] : evenSplit)
        : 0;
      return draft !== current;
    });
  })();

  const toggleDraftDay = (d: string) => {
    setDraftMinutesByDay(prev => {
      const next = { ...prev };
      if (next[d] != null) {
        delete next[d];
        return next;
      }
      const activeCount = Object.keys(prev).length;
      const total = Object.values(prev).reduce((a, b) => a + b, 0);
      const def = activeCount > 0 ? Math.max(15, Math.round(total / activeCount)) : 60;
      next[d] = def;
      return next;
    });
  };

  const adjustDayMins = (d: string, delta: number) => {
    setDraftMinutesByDay(prev => {
      const cur = prev[d] ?? 0;
      const nextVal = Math.max(0, Math.min(600, cur + delta));
      if (nextVal === 0) {
        const { [d]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [d]: nextVal };
    });
  };

  const spreadEvenly = () => {
    const days = ALL_DAYS.filter(d => draftMinutesByDay[d] != null);
    if (days.length === 0) return;
    const total = days.reduce((a, d) => a + draftMinutesByDay[d], 0);
    // Keep 15-min granularity but preserve the total: floor each share to a
    // 15-min block, then distribute the remaining 15-min increments one by
    // one across the earliest weekdays.
    const baseChunks = Math.floor(total / days.length / 15);
    const base = Math.max(15, baseChunks * 15);
    const distributed: Record<string, number> = Object.fromEntries(days.map(d => [d, base]));
    let remaining = total - base * days.length;
    let i = 0;
    while (remaining >= 15 && i < days.length * 8) {
      distributed[days[i % days.length]] += 15;
      remaining -= 15;
      i++;
    }
    setDraftMinutesByDay(distributed);
  };

  const saveAvailability = () => {
    const days = ALL_DAYS.filter(d => draftMinutesByDay[d] != null && draftMinutesByDay[d] > 0);
    const minsMap = Object.fromEntries(days.map(d => [d, draftMinutesByDay[d]]));
    const totalMins = days.reduce((a, d) => a + draftMinutesByDay[d], 0);
    const hours = +(totalMins / 60).toFixed(2);
    onUpdateAvailability(hours, days, days.length > 0 ? minsMap : undefined);
    setSavedFlash(true);
    setUndoSnapshot(null);
    setRecToast(null);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const resetDraft = () => {
    if (!weekSetup) return;
    setDraftMinutesByDay(buildInitialDraft());
  };

  // ---- Derive today's plan from real data ----
  // Pick top priority emails by Priority (High → Low), then by deadline asc.
  // Skip pure no-action emails entirely.
  const todayEmails = useMemo(() => {
    return [...emails]
      .filter(e => e.cat !== CAT.NONE)
      .sort((a, b) => {
        const pa = PRIORITY_RANK[getEmailPriority(a)];
        const pb = PRIORITY_RANK[getEmailPriority(b)];
        if (pa !== pb) return pa - pb;
        const da = a.deadline ?? 99;
        const db = b.deadline ?? 99;
        return da - db;
      })
      .slice(0, 3);
  }, []);

  // Pick most urgent uncompleted manual tasks by deadline.
  const todayTasks = useMemo(() => {
    return [...manualTasks].filter(t => !t.done).sort((a, b) => a.deadline - b.deadline).slice(0, 2);
  }, [manualTasks]);

  const handleEmailClick = (id: number) => {
    setHandledEmailIds(prev => new Set(prev).add(id));
    onOpenEmail(id);
    onNavigate('Emails');
  };

  const handleTaskClick = (id: string) => {
    setHandledTaskIds(prev => new Set(prev).add(id));
    onNavigate('Tasks');
  };

  // ---- Stats ----
  const planMins = todayEmails.reduce((a, e) => a + e.estMin, 0) + todayTasks.reduce((a, t) => a + t.estMin, 0);
  const sidebarMins = sidebarTasks.filter(t => !t.done).reduce((a, t) => a + t.estMin, 0);
  const totalMins = planMins + sidebarMins;

  const totalItems = todayEmails.length + todayTasks.length + sidebarTasks.length;
  const totalDone =
    todayEmails.filter(e => handledEmailIds.has(e.id)).length +
    todayTasks.filter(t => handledTaskIds.has(t.id)).length +
    sidebarTasks.filter(t => t.done).length;

  // Priority summary: bucket all actionable items (open emails + uncompleted
  // manual & sidebar tasks) into Urgent / Medium / Low. Memoised so it stays
  // reactive as items are handled or completed elsewhere in the app.
  const priorityCounts = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 } as Record<Priority, number>;
    for (const e of emails) {
      if (e.cat === CAT.NONE) continue;
      counts[getEmailPriority(e)]++;
    }
    for (const t of manualTasks) {
      if (t.done) continue;
      counts[getTaskPriority(t)]++;
    }
    for (const t of sidebarTasks) {
      if (t.done) continue;
      counts[t.priority === 'high' ? 'High' : 'Low']++;
    }
    return counts;
  }, [manualTasks, sidebarTasks]);

  const activeDays = weekSetup ? weekSetup.days : weekData.map(d => d.day);

  // Build the per-day minute breakdown. If the user has explicit overrides
  // (set via the AI recommendation buttons), use them; otherwise fall back
  // to an even split of total weekly hours across active days.
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

  // Pick which days to suggest topping up. Prefer currently active admin
  // days with the lowest allocation (so adding 1h moves the needle on a
  // day the clinician already plans to work). Fall back to any inactive
  // weekdays only if there are fewer than 2 active days.
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
    const baseDays = weekSetup?.days ?? draftDays;
    const newDays = baseDays.includes(day)
      ? baseDays
      : [...baseDays, day].sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));

    // Start from the current visible per-day breakdown so existing
    // allocations are preserved, then add 60 to the target day.
    const nextMinutes: Record<string, number> = {};
    for (const d of newDays) {
      const current = minutesPerDay[d] ?? 0;
      nextMinutes[d] = d === day ? current + 60 : current;
    }
    const newTotalMins = Object.values(nextMinutes).reduce((a, b) => a + b, 0);
    const newHours = +(newTotalMins / 60).toFixed(2);
    onUpdateAvailability(newHours, newDays, nextMinutes);
    setUndoSnapshot(snapshot);
    showRecToast(`Added 1h to ${day}`);
  };

  const handleRebalance = () => {
    const snapshot = captureSnapshot();
    const baseHours = weekSetup?.hours ?? draftHours;
    const baseDays = weekSetup?.days ?? draftDays;
    const days = baseDays.length > 0 ? baseDays : ['Tue', 'Wed', 'Thu'];
    const recommendedHoursRaw = recommendedMins / 60;
    const targetHours = Math.max(baseHours, Math.ceil(recommendedHoursRaw * 2) / 2);
    // Rebalance = drop any per-day overrides, spread the (possibly topped-up)
    // total evenly across active days.
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

  // Flat ordered render list.
  type Row =
    | { kind: 'email'; email: Email }
    | { kind: 'task'; task: ManualTask }
    | { kind: 'sidebar'; task: SidebarTask };

  const rows: Row[] = [
    ...todayEmails.map(email => ({ kind: 'email' as const, email })),
    ...todayTasks.map(task => ({ kind: 'task' as const, task })),
    ...sidebarTasks.filter(t => !t.done).filter(t => t.priority === 'high').map(task => ({ kind: 'sidebar' as const, task })),
    ...sidebarTasks.filter(t => !t.done).filter(t => t.priority === 'normal').map(task => ({ kind: 'sidebar' as const, task })),
    ...sidebarTasks.filter(t => t.done).map(task => ({ kind: 'sidebar' as const, task })),
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* Greeting */}
      <div className="flex items-center gap-4 pb-1">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Sun size={26} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Good morning, Dr. Morgan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here's your plan. Follow it and you're on top of your admin.</p>
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

      {/* Risk / Status Banner */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Left — status */}
          <div className="p-6 flex items-start gap-4">
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0",
              isAtRisk ? "bg-amber-100" : "bg-green-100"
            )}>
              {isAtRisk
                ? <AlertTriangle size={24} className="text-amber-500" />
                : <CheckCircle2 size={24} className="text-green-600" />
              }
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground font-medium">You're currently:</p>
              <p className={cn("text-xl font-bold", isAtRisk ? "text-amber-600" : "text-green-600")}>
                {isAtRisk ? 'At risk' : 'On track'}
              </p>
              {isAtRisk ? (
                <>
                  <p className="text-sm text-foreground">
                    You have <strong>{fmtMins(allocatedMins)}</strong> booked
                    {activeDays.length > 0 && <> across <strong>{activeDays.join(', ')}</strong></>}.
                  </p>
                  <p className="text-sm font-medium text-amber-600">
                    Based on current workload and historical trends you will likely need to add {fmtMins(shortfall)} more.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-foreground">
                    You have <strong>{fmtMins(allocatedMins)}</strong> admin booked this week
                    {activeDays.length > 0 && <> across <strong>{activeDays.join(', ')}</strong></>}.
                  </p>
                  <p className="text-sm text-muted-foreground">Your allocation covers this week's workload.</p>
                </>
              )}
            </div>
          </div>

          {/* Right — AI recommendation */}
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

      {/* Middle grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Today's Plan */}
        <div className="lg:col-span-3 bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center">
                  <CalendarCheck size={18} className="text-green-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold">Today's Plan</h3>
                    <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {fmtMins(totalMins)} admin
                    </span>
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {totalDone}/{totalItems} done
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Quick access to your inbox & tasks — click any item to open it in detail.</p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('Emails')}
                className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
              >
                Open inbox <ChevronRight size={12} />
              </button>
            </div>
          </div>

          <ul className="divide-y divide-border">
            {rows.map((row, idx) => {
              if (row.kind === 'email') {
                const e = row.email;
                const handled = handledEmailIds.has(e.id);
                const priority = getEmailPriority(e);
                return (
                  <li
                    key={`email-${e.id}`}
                    onClick={() => handleEmailClick(e.id)}
                    className={cn(
                      "flex items-start gap-4 px-6 py-4 transition-colors cursor-pointer hover:bg-slate-50",
                      handled && "opacity-60"
                    )}
                    data-testid={`plan-email-${e.id}`}
                  >
                    <span className={cn(
                      "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5",
                      handled ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-600"
                    )}>
                      {handled ? <Check size={12} /> : idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Mail size={12} className="text-muted-foreground flex-shrink-0" />
                        <p className={cn("text-sm font-semibold truncate", handled && "line-through")}>
                          {e.subject}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        From <strong className="text-foreground">{e.from}</strong> · {e.date}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="font-medium">Why:</span> {getEmailWhy(e)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn(
                        "inline-flex items-center text-[10px] font-bold border px-2 py-0.5 rounded-full",
                        PRIORITY_PILL[priority]
                      )}>
                        {priority}
                      </span>
                      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{e.estMin}min</span>
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </div>
                  </li>
                );
              }

              if (row.kind === 'task') {
                const t = row.task;
                const handled = handledTaskIds.has(t.id);
                const priority = getTaskPriority(t);
                return (
                  <li
                    key={`task-${t.id}`}
                    onClick={() => handleTaskClick(t.id)}
                    className={cn(
                      "flex items-start gap-4 px-6 py-4 transition-colors cursor-pointer hover:bg-slate-50",
                      handled && "opacity-60"
                    )}
                    data-testid={`plan-task-${t.id}`}
                  >
                    <span className={cn(
                      "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5",
                      handled ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-600"
                    )}>
                      {handled ? <Check size={12} /> : idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText size={12} className="text-muted-foreground flex-shrink-0" />
                        <p className={cn("text-sm font-semibold truncate", handled && "line-through")}>
                          {t.title}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="font-medium">Why:</span> {getTaskWhy(t)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn(
                        "inline-flex items-center text-[10px] font-bold border px-2 py-0.5 rounded-full",
                        PRIORITY_PILL[priority]
                      )}>
                        {priority}
                      </span>
                      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{t.estMin}min</span>
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </div>
                  </li>
                );
              }

              const task = row.task;
              return (
                <li
                  key={`sidebar-${task.id}`}
                  className={cn("flex items-start gap-4 px-6 py-4 bg-slate-50/40", task.done && "opacity-50")}
                >
                  <span className={cn(
                    "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5",
                    task.done ? "bg-green-100 text-green-600" : "bg-slate-200 text-slate-500"
                  )}>
                    {task.done ? <Check size={12} /> : idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-semibold", task.done && "line-through")}>{task.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium">Why:</span>{' '}
                      {task.priority === 'high' ? 'High priority — action required.' : 'Scheduled manual task.'}
                    </p>
                    {task.priority === 'high' && (
                      <div className="mt-1.5">
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                          High priority
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{task.estMin}min</span>
                    <button
                      onClick={() => onToggleSidebarTask(task.id)}
                      className={cn(
                        "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0",
                        task.done ? "bg-green-500 border-green-500" : "border-slate-300 hover:border-primary"
                      )}
                    >
                      {task.done && <Check size={11} className="text-white" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="px-6 py-4 border-t border-border bg-green-50/60 flex items-center gap-3">
            <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
            <p className="text-sm font-medium text-green-700">Finish this list and you're safe to close down the computer for today! 🎉</p>
          </div>
        </div>

        {/* This Week */}
        <div className="lg:col-span-2 bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
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
      </div>

      {/* Bottom stats — 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Emails safely deferred */}
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0">
            <Mail size={20} className="text-teal-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{Math.max(emails.length - todayEmails.length, 0)}</p>
            <p className="text-sm font-semibold text-foreground">Emails safely deferred</p>
            <p className="text-xs text-muted-foreground">Scheduled for next week or later.</p>
          </div>
        </div>

        {/* 2. Tasks scheduled */}
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <ClipboardList size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{manualTasks.length}</p>
            <p className="text-sm font-semibold text-foreground">Tasks scheduled</p>
            <p className="text-xs text-muted-foreground">Reports / letters / admin tasks.</p>
          </div>
        </div>

        {/* 3. Unsafe deferrals */}
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <ShieldCheck size={20} className="text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold">0</p>
            <p className="text-sm font-semibold text-foreground">Unsafe deferrals</p>
            <p className="text-xs text-muted-foreground">You're safe if you follow the plan.</p>
            <button className="mt-1 text-xs text-primary font-semibold flex items-center gap-1 hover:underline">
              See what's deferred <ChevronRight size={11} />
            </button>
          </div>
        </div>

        {/* 4. Missed deadlines */}
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

      {/* Availability adjustment panel */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-slate-50/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
              <Settings2 size={17} className="text-slate-600" />
            </div>
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                Adjust this week's availability
                {savedFlash && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full animate-in fade-in">
                    <Check size={10} /> Saved
                  </span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plans change. Tweak your hours or days here without re-running the weekly brief.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenWeeklySetup}
            className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
          >
            <RotateCcw size={11} /> Re-run weekly brief
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1">
                Per-day admin hours
              </label>
              <p className="text-xs text-muted-foreground">
                Set different time for each day — not every week is balanced. Total this week: <strong className="text-foreground" data-testid="text-availability-total">{fmtMins(draftTotalMins)}</strong>
                {draftDays.length > 0 && <> across {draftDays.length} day{draftDays.length !== 1 ? 's' : ''}</>}.
              </p>
            </div>
            {draftDays.length > 1 && (
              <button
                onClick={spreadEvenly}
                className="text-[11px] font-bold text-primary bg-primary/5 border border-primary/20 px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors flex items-center gap-1.5"
                data-testid="button-spread-evenly"
              >
                <RotateCcw size={11} /> Spread evenly
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {ALL_DAYS.map(d => {
              const mins = draftMinutesByDay[d];
              const active = mins != null && mins > 0;
              return (
                <div
                  key={d}
                  className={cn(
                    "rounded-xl border p-3 transition-colors",
                    active ? "border-primary/40 bg-primary/5" : "border-border bg-white"
                  )}
                  data-testid={`day-card-${d.toLowerCase()}`}
                >
                  <button
                    onClick={() => toggleDraftDay(d)}
                    className={cn(
                      "w-full text-sm font-bold mb-2 py-1 rounded-md transition-colors",
                      active
                        ? "text-primary hover:bg-primary/10"
                        : "text-slate-500 hover:bg-slate-50"
                    )}
                    data-testid={`day-toggle-${d.toLowerCase()}`}
                  >
                    {d}
                  </button>
                  {active ? (
                    <>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => adjustDayMins(d, -15)}
                          className="w-7 h-7 rounded-md border border-border bg-white hover:bg-accent flex items-center justify-center transition-colors flex-shrink-0"
                          data-testid={`day-mins-decrease-${d.toLowerCase()}`}
                          aria-label={`Decrease ${d} by 15 min`}
                        >
                          <Minus size={12} />
                        </button>
                        <div className="flex-1 text-center">
                          <span className="text-sm font-bold text-foreground" data-testid={`day-mins-${d.toLowerCase()}`}>
                            {fmtMins(mins!)}
                          </span>
                        </div>
                        <button
                          onClick={() => adjustDayMins(d, 15)}
                          className="w-7 h-7 rounded-md border border-border bg-white hover:bg-accent flex items-center justify-center transition-colors flex-shrink-0"
                          data-testid={`day-mins-increase-${d.toLowerCase()}`}
                          aria-label={`Increase ${d} by 15 min`}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                        ±15 min
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground text-center py-2 italic">
                      Off
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {draftDays.length === 0
              ? 'No admin days selected — your week is unscheduled.'
              : <>{draftHours}h total / week. Tap a day name to switch it on or off.</>}
          </p>
        </div>

        {dirty && (
          <div className="px-6 py-3 border-t border-border bg-amber-50/50 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
              <AlertTriangle size={12} />
              Unsaved changes — your dashboard won't update until you save.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={resetDraft}
                disabled={!weekSetup}
                className="text-xs text-muted-foreground font-semibold px-3 py-1.5 rounded-lg hover:bg-white transition-colors disabled:opacity-40"
              >
                Discard
              </button>
              <button
                onClick={saveAvailability}
                className="bg-primary text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
                data-testid="button-save-availability"
              >
                Save changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
