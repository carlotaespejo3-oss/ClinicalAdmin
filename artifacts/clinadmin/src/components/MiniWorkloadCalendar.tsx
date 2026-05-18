import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { DailyPlan } from '@/lib/planner';
import { cn } from '@/lib/utils';
import {
  STATUS_TONE,
  CATEGORY_TONE,
  fmtMin,
  startOfDay,
  addDays,
  dateKey,
  indexRunway,
  filterRunwayToTasks,
} from '@/lib/calendarHelpers';
import type { AiCategory } from '@/lib/types';

type ViewMode = 'week' | 'fortnight' | 'month';

interface Props {
  runway: DailyPlan[];
  onJumpToDay?: (dayIndex: number) => void;
}

// Mini calendar shown next to Today's Plan. Lets the clinician glance at
// the workload density across the week, fortnight, or month. Driven by
// the same planner runway as the rest of Home, so it stays in sync with
// availability tweaks and AI rec actions.
//
// Note: the planner currently produces a 14-day runway. Days beyond that
// horizon render as "future" cells with no load — they aren't planned
// yet. That's an honest representation, not a bug.
export default function MiniWorkloadCalendar({ runway, onJumpToDay }: Props) {
  const [mode, setMode] = useState<ViewMode>('week');
  const today = useMemo(() => startOfDay(new Date()), []);
  // Calendar is the clinician's diary view — only show tasks/events
  // (reports, CPD, meetings, manual + linked-doc tasks). Emails belong
  // to the inbox/Today's Plan surfaces. Load + status are recomputed
  // from the filtered set so the colour bar isn't misleading.
  const tasksOnlyRunway = useMemo(() => filterRunwayToTasks(runway), [runway]);
  const runwayByDate = useMemo(() => indexRunway(tasksOnlyRunway), [tasksOnlyRunway]);
  const horizonEnd = useMemo(() => addDays(today, tasksOnlyRunway.length - 1), [today, tasksOnlyRunway.length]);

  // For month view we let the clinician page month-by-month, but the
  // status colouring only fills in for days inside the runway horizon.
  const [monthAnchor, setMonthAnchor] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const handleDayClick = (date: Date) => {
    if (!onJumpToDay) return;
    const t = startOfDay(date).getTime();
    const todayT = today.getTime();
    if (t < todayT || t > horizonEnd.getTime()) return;
    const diff = Math.round((t - todayT) / 86400000);
    onJumpToDay(diff);
  };

  return (
    <div
      className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col h-full"
      data-testid="mini-workload-calendar"
    >
      {/* Header — title + view toggle */}
      <div className="px-5 pt-5 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
              <CalendarDays size={17} className="text-blue-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold leading-tight">Workload at a glance</h3>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {mode === 'week' && 'This week'}
                {mode === 'fortnight' && 'Next 14 days'}
                {mode === 'month' && monthAnchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div
            className="inline-flex rounded-lg border border-border bg-slate-50 p-0.5"
            role="tablist"
            aria-label="Calendar view"
          >
            {(['week', 'fortnight', 'month'] as const).map(m => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors capitalize',
                  mode === m
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                data-testid={`mini-cal-view-${m}`}
              >
                {m}
              </button>
            ))}
          </div>
          {mode === 'month' && (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setMonthAnchor(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                }
                className="w-7 h-7 rounded-md border border-border bg-white flex items-center justify-center hover:bg-accent transition-colors"
                aria-label="Previous month"
                data-testid="mini-cal-prev-month"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() =>
                  setMonthAnchor(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                }
                className="w-7 h-7 rounded-md border border-border bg-white flex items-center justify-center hover:bg-accent transition-colors"
                aria-label="Next month"
                data-testid="mini-cal-next-month"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex-1">
        {mode === 'week' && (
          <WeekGrid
            days={Array.from({ length: 7 }, (_, i) => addDays(today, i))}
            today={today}
            runwayByDate={runwayByDate}
            onDayClick={handleDayClick}
          />
        )}
        {mode === 'fortnight' && (
          <FortnightGrid
            days={Array.from({ length: 14 }, (_, i) => addDays(today, i))}
            today={today}
            runwayByDate={runwayByDate}
            onDayClick={handleDayClick}
          />
        )}
        {mode === 'month' && (
          <MonthGrid
            anchor={monthAnchor}
            today={today}
            horizonEnd={horizonEnd}
            runwayByDate={runwayByDate}
            onDayClick={handleDayClick}
          />
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-border bg-slate-50/50 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <LegendDot className="bg-green-400" label="On track" />
        <LegendDot className="bg-amber-400" label="Tight" />
        <LegendDot className="bg-red-500" label="Overloaded" />
        <LegendDot className="bg-slate-300" label="No admin time" />
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('w-2 h-2 rounded-full', className)} />
      {label}
    </span>
  );
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function WeekGrid({
  days,
  today,
  runwayByDate,
  onDayClick,
}: {
  days: Date[];
  today: Date;
  runwayByDate: Map<string, DailyPlan>;
  onDayClick: (date: Date) => void;
}) {
  // Single row of 7 day cells with a load bar each.
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map(d => {
        const plan = runwayByDate.get(dateKey(d)) ?? null;
        const isToday = d.getTime() === today.getTime();
        return (
          <MiniDayCell
            key={dateKey(d)}
            date={d}
            plan={plan}
            isToday={isToday}
            variant="week"
            onClick={() => onDayClick(d)}
          />
        );
      })}
    </div>
  );
}

function FortnightGrid({
  days,
  today,
  runwayByDate,
  onDayClick,
}: {
  days: Date[];
  today: Date;
  runwayByDate: Map<string, DailyPlan>;
  onDayClick: (date: Date) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map(d => {
        const plan = runwayByDate.get(dateKey(d)) ?? null;
        const isToday = d.getTime() === today.getTime();
        return (
          <MiniDayCell
            key={dateKey(d)}
            date={d}
            plan={plan}
            isToday={isToday}
            variant="fortnight"
            onClick={() => onDayClick(d)}
          />
        );
      })}
    </div>
  );
}

function MonthGrid({
  anchor,
  today,
  horizonEnd,
  runwayByDate,
  onDayClick,
}: {
  anchor: Date;
  today: Date;
  horizonEnd: Date;
  runwayByDate: Map<string, DailyPlan>;
  onDayClick: (date: Date) => void;
}) {
  // Monday-start month grid, padded out so we always render full weeks.
  const cells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    // JS getDay(): Sun=0..Sat=6. We want Monday=0..Sunday=6.
    const leadBlanks = (first.getDay() + 6) % 7;
    const start = addDays(first, -leadBlanks);
    const totalCells = Math.ceil((leadBlanks + last.getDate()) / 7) * 7;
    return Array.from({ length: totalCells }, (_, i) => addDays(start, i));
  }, [anchor]);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1.5">
        {DOW_LABELS.map(d => (
          <div
            key={d}
            className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground text-center"
          >
            {d.slice(0, 1)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(d => {
          const plan = runwayByDate.get(dateKey(d)) ?? null;
          const isToday = d.getTime() === today.getTime();
          const inMonth = d.getMonth() === anchor.getMonth();
          const beyondHorizon = d.getTime() > horizonEnd.getTime();
          const beforeToday = d.getTime() < today.getTime();
          return (
            <MiniDayCell
              key={dateKey(d)}
              date={d}
              plan={plan}
              isToday={isToday}
              variant="month"
              inMonth={inMonth}
              greyed={beyondHorizon || beforeToday}
              onClick={() => onDayClick(d)}
            />
          );
        })}
      </div>
    </div>
  );
}

// Single day cell — variant controls the size and label density. Plan
// status colours the left border + a small load bar; category dots sit
// along the bottom when there are items.
function MiniDayCell({
  date,
  plan,
  isToday,
  variant,
  inMonth = true,
  greyed = false,
  onClick,
}: {
  date: Date;
  plan: DailyPlan | null;
  isToday: boolean;
  variant: 'week' | 'fortnight' | 'month';
  inMonth?: boolean;
  greyed?: boolean;
  onClick: () => void;
}) {
  const status = plan?.status ?? 'idle';
  const tone = STATUS_TONE[status];

  const statusBorder: Record<DailyPlan['status'], string> = {
    safe: 'border-l-green-400',
    tight: 'border-l-amber-400',
    breach: 'border-l-red-500',
    idle: 'border-l-slate-200',
  };

  const loadPct = plan && plan.minutesAvailable > 0
    ? Math.min(100, Math.round((plan.totalPlannedMin / plan.minutesAvailable) * 100))
    : 0;

  const loadBarColour =
    status === 'breach' ? 'bg-red-400'
    : status === 'tight' ? 'bg-amber-400'
    : status === 'safe' ? 'bg-green-400'
    : 'bg-slate-300';

  // Category dot summary (cap at 3 in compact views).
  const cats = plan
    ? Array.from(new Set(plan.items.map(i => i.category)))
    : [];
  const maxDots = variant === 'week' ? 4 : variant === 'fortnight' ? 3 : 3;

  const dayNum = date.getDate();
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' });

  const clickable = plan != null;

  const baseClass = cn(
    'text-left rounded-md border border-l-4 transition-colors flex flex-col',
    statusBorder[status],
    inMonth ? 'bg-white' : 'bg-slate-50/60',
    greyed && 'opacity-50',
    isToday ? 'border-primary/60 ring-1 ring-primary/20' : 'border-border/60',
    clickable ? 'hover:border-border cursor-pointer' : 'cursor-default',
  );

  const sizeClass =
    variant === 'week' ? 'min-h-[72px] p-1.5'
    : variant === 'fortnight' ? 'min-h-[54px] p-1'
    : 'aspect-square min-h-[36px] p-1';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={cn(baseClass, sizeClass)}
      title={
        plan
          ? `${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} — ${plan.items.length} item${plan.items.length === 1 ? '' : 's'}, ${tone.label.toLowerCase()} (${fmtMin(plan.totalPlannedMin)} / ${fmtMin(plan.minutesAvailable)})`
          : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
      }
      data-testid={`mini-cal-day-${dateKey(date)}`}
    >
      <div className="flex items-start justify-between">
        {variant !== 'month' && (
          <span
            className={cn(
              'text-[9px] font-bold uppercase tracking-widest text-muted-foreground',
              isToday && 'text-primary',
            )}
          >
            {weekday}
          </span>
        )}
        <span
          className={cn(
            variant === 'month' ? 'text-xs font-bold' : 'text-sm font-bold',
            !inMonth && 'text-muted-foreground/50',
            isToday && 'text-primary',
            variant === 'month' && 'ml-auto',
          )}
        >
          {dayNum}
        </span>
      </div>

      {/* Load bar (skipped in month view to keep cells dense) */}
      {plan && variant !== 'month' && (
        <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={cn('h-full', loadBarColour)}
            style={{ width: `${loadPct}%` }}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Item count + category dots */}
      {plan && plan.items.length > 0 && (
        <div className="mt-auto flex items-center justify-between gap-1 pt-1">
          {variant !== 'month' && (
            <span className="text-[9px] text-muted-foreground tabular-nums">
              {plan.items.length} item{plan.items.length === 1 ? '' : 's'}
            </span>
          )}
          <div className={cn('flex flex-wrap gap-0.5', variant === 'month' && 'mx-auto')}>
            {cats.slice(0, maxDots).map(cat => {
              const t = CATEGORY_TONE[cat as AiCategory] ?? CATEGORY_TONE.ADMIN;
              return <span key={cat} className={cn('w-1.5 h-1.5 rounded-full', t.dot)} />;
            })}
          </div>
        </div>
      )}

      {plan && plan.items.length === 0 && plan.minutesAvailable > 0 && variant !== 'month' && (
        <span className="text-[9px] text-muted-foreground mt-auto pt-1">Free</span>
      )}
    </button>
  );
}
