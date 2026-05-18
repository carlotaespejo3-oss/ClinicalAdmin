import { useEffect, useState } from 'react';
import { Settings2, Minus, Plus, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WeekSetup } from '@/pages/ClinAdmin';

interface Props {
  weekSetup: WeekSetup | null;
  onUpdateAvailability: (hours: number, days: string[], minutesByDay?: Record<string, number>) => void;
  onOpenWeeklySetup: () => void;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

// Per-day availability editor. Owns its own draft so the clinician can
// fiddle with multiple days before committing. Save fires
// onUpdateAvailability with the total hours, the list of active days,
// and the per-day minutes map; Discard reverts to the persisted
// weekSetup. The panel re-syncs its draft from props whenever the
// underlying weekSetup changes (e.g. an AI recommendation was applied
// elsewhere).
export default function AvailabilityPanel({ weekSetup, onUpdateAvailability, onOpenWeeklySetup }: Props) {
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

  return (
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
  );
}
