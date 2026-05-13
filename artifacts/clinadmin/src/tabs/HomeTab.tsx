import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Sun, ShieldAlert, Settings2, Minus, Plus, RotateCcw, Check, ChevronRight } from 'lucide-react';
import { emails, CAT } from '@/lib/data';
import { ManualTask, SidebarTask, TabType } from '@/lib/types';
import { cn, getEmailPriority, getTaskPriority, PRIORITY_PILL, type Priority } from '@/lib/utils';
import { WeekSetup } from '@/pages/ClinAdmin';
import { useLinkedDocTasks } from '@/lib/linkedDocTasksStore';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { useArchivedEmails } from '@/lib/archivedStore';
import { usePlannerOutput } from '@/lib/usePlannerOutput';
import TodaysPlan from '@/components/TodaysPlan';

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

export default function HomeTab({ sidebarTasks, manualTasks, weekSetup, onOpenWeeklySetup, onUpdateAvailability, onNavigate, onOpenEmail }: Props) {
  const linkedDocTasks = useLinkedDocTasks();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const plannerOutput = usePlannerOutput(manualTasks, weekSetup);

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

  // ---- Availability adjustment draft state ----
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
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const resetDraft = () => {
    if (!weekSetup) return;
    setDraftMinutesByDay(buildInitialDraft());
  };

  // ---- Slim status banner ----
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

      {/* Slim status banner — left side only, no AI rec column. The full
          recommendation surface lives in the Detailed View so this page
          stays calm. */}
      <div
        className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-start gap-4"
        data-testid={`status-banner-${status}`}
      >
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', statusStyles.bg)}>
          <StatusIcon size={24} className={statusStyles.icon} />
        </div>
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-sm text-muted-foreground font-medium">You're currently:</p>
          <p className={cn('text-xl font-bold', statusStyles.text)} data-testid="status-banner-headline">
            {youAre} — {plannerOutput.statusHeadline}
          </p>
          <p className="text-sm text-foreground" data-testid="status-banner-detail">
            {plannerOutput.statusDetail}
          </p>
        </div>
        <button
          onClick={() => onNavigate('Detailed View')}
          className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline whitespace-nowrap flex-shrink-0 mt-1"
          data-testid="button-open-detailed-view"
        >
          Detailed view <ChevronRight size={12} />
        </button>
      </div>

      {/* Today's plan — the only Today's Plan on this page. Reads from
          plannerOutput which is derived from live stores (acknowledged,
          archived, AI classifications, manual task done state, linked doc
          tasks, week setup), so it recomputes the moment any of those
          change in another tab. */}
      <TodaysPlan
        todaysPlan={plannerOutput.todaysPlan}
        overallStatus={plannerOutput.overallStatus}
        unclearCount={plannerOutput.unclearCount}
        onTriageUnclear={() => {
          // Jump to the inbox and open the first unclassified email so the
          // clinician lands directly on the thing they need to triage.
          const firstId = plannerOutput.unclearEmailIds[0];
          if (firstId != null) onOpenEmail(firstId);
          onNavigate('Emails');
        }}
        onItemClick={(item) => {
          if (typeof item.refId === 'number') {
            onOpenEmail(item.refId);
            onNavigate('Emails');
          } else if (item.kind === 'task') {
            onNavigate('Tasks');
          }
        }}
      />

      {/* Availability adjustment panel — kept on Home so the clinician can
          tweak today's hours without leaving the calm view. */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
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
            className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline whitespace-nowrap"
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
