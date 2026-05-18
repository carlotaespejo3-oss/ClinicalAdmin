import { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  ClipboardList,
  CalendarClock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { usePlannerOutput } from '@/lib/usePlannerOutput';
import AvailabilityPanel from '@/components/AvailabilityPanel';
import LeavePanel from '@/components/LeavePanel';
import CalendarTaskDetailModal from '@/components/CalendarTaskDetailModal';
import {
  useLeaveBlocks,
  leaveBlocksForDay,
  LEAVE_TYPE_LABEL,
  type LeaveBlock,
} from '@/lib/leaveBlocksStore';
import type { ManualTask, AiCategory, TabType } from '@/lib/types';
import type { DailyPlan, PlanItem } from '@/lib/planner';
import type { WeekSetup } from '@/pages/ClinAdmin';
import {
  CATEGORY_TONE,
  STATUS_TONE,
  fmtMin,
  startOfDay,
  addDays,
  dateKey,
  indexRunway,
  filterRunwayToTasks,
} from '@/lib/calendarHelpers';

type RangeMode = 'week' | 'twoweeks' | 'month';

interface Props {
  weekSetup: WeekSetup | null;
  manualTasks: ManualTask[];
  onOpenEmail: (id: number) => void;
  onNavigate: (tab: TabType) => void;
  onOpenWeeklySetup: () => void;
  onUpdateAvailability: (hours: number, days: string[], minutesByDay?: Record<string, number>) => void;
}

function ItemChip({
  item,
  onOpenEmail,
  onOpenTask,
  dense,
}: {
  item: PlanItem;
  onOpenEmail: (id: number) => void;
  onOpenTask: (item: PlanItem) => void;
  dense?: boolean;
}) {
  const tone = CATEGORY_TONE[item.category] ?? CATEGORY_TONE.ADMIN;
  const Icon =
    item.kind === 'event'
      ? CalendarClock
      : item.kind === 'task'
        ? ClipboardList
        : Mail;
  // Email items open the email; tasks and events open the detail
  // modal where the clinician can edit or delete. Unclear-gate
  // rows stay non-interactive — they're a status indicator, not a
  // task with its own row in any store.
  const clickable =
    (item.kind === 'email' && typeof item.refId === 'number') ||
    item.kind === 'task' ||
    item.kind === 'event';
  const handleClick = () => {
    if (item.kind === 'email' && typeof item.refId === 'number') {
      onOpenEmail(item.refId);
    } else if (item.kind === 'task' || item.kind === 'event') {
      onOpenTask(item);
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!clickable}
      className={cn(
        'w-full text-left rounded-md border px-2 py-1.5 transition-colors',
        tone.chipBg,
        tone.chipText,
        tone.chipBorder,
        clickable ? 'hover:brightness-95 cursor-pointer' : 'cursor-default',
        dense ? 'text-[11px]' : 'text-xs',
      )}
      title={item.reasonText}
      data-testid={`calendar-item-${item.kind}-${item.refId ?? 'na'}`}
    >
      <div className="flex items-start gap-1.5 min-w-0">
        <Icon size={dense ? 10 : 12} className="mt-0.5 flex-shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate leading-tight">{item.title}</p>
          {!dense && <p className="text-[10px] opacity-70 mt-0.5">{fmtMin(item.estMin)}</p>}
        </div>
      </div>
    </button>
  );
}

function DayColumn({
  date,
  plan,
  onOpenEmail,
  onOpenTask,
  leave,
}: {
  date: Date;
  plan: DailyPlan | null;
  onOpenEmail: (id: number) => void;
  onOpenTask: (item: PlanItem) => void;
  leave: LeaveBlock[];
}) {
  const isToday = startOfDay(date).getTime() === startOfDay(new Date()).getTime();
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' });
  const dayNum = date.getDate();
  const monthShort = date.toLocaleDateString('en-GB', { month: 'short' });
  const status = plan?.status ?? 'idle';
  const tone = STATUS_TONE[status];

  return (
    <div
      className={cn(
        'min-w-0 flex flex-col rounded-xl border bg-card ring-1',
        tone.ring,
        isToday ? 'border-primary/50 shadow-sm' : 'border-border/60',
      )}
    >
      <div className={cn('px-3 py-2 border-b', isToday ? 'bg-primary/5 border-primary/20' : 'border-border/60')}>
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{weekday}</p>
            <p className="text-lg font-bold leading-none mt-0.5">
              {dayNum}
              <span className="ml-1 text-xs font-normal text-muted-foreground">{monthShort}</span>
            </p>
          </div>
          {isToday && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
              Today
            </span>
          )}
        </div>
        {plan && (
          <div className="flex items-center justify-between mt-2">
            <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', tone.pillBg, tone.pillText)}>
              {tone.label}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {fmtMin(plan.totalPlannedMin)} / {fmtMin(plan.minutesAvailable)}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 p-2 space-y-1.5 min-h-[120px]">
        {leave.length > 0 && (
          <div
            className="rounded-md border border-sky-200 bg-sky-50 text-sky-800 px-2 py-1.5 text-[11px] font-semibold"
            data-testid="day-leave-pill"
          >
            On leave · {LEAVE_TYPE_LABEL[leave[0].leaveType]}
          </div>
        )}
        {!plan && <p className="text-[11px] text-muted-foreground italic px-1 py-2">Beyond planning horizon</p>}
        {plan && plan.items.length === 0 && leave.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic px-1 py-2">
            {plan.minutesAvailable === 0 ? 'No admin time scheduled' : 'Nothing planned'}
          </p>
        )}
        {plan?.items.map((item, i) => (
          <ItemChip
            key={`${item.kind}-${item.refId ?? i}`}
            item={item}
            onOpenEmail={onOpenEmail}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
    </div>
  );
}

function MonthCell({
  date,
  plan,
  inMonth,
  isToday,
  onClick,
  isSelected,
  leave,
}: {
  date: Date;
  plan: DailyPlan | null;
  inMonth: boolean;
  isToday: boolean;
  onClick: () => void;
  isSelected: boolean;
  leave: LeaveBlock[];
}) {
  const status = plan?.status ?? 'idle';
  const tone = STATUS_TONE[status];
  // Tally by kind so the cell can summarise "2 tasks · 1 meeting"
  // instead of relying on dots alone. Emails are already excluded
  // from tasksOnlyRunway upstream, so in practice this collapses to
  // tasks + meetings (events).
  let taskCount = 0;
  let meetingCount = 0;
  let otherCount = 0;
  const categoryCounts: Partial<Record<AiCategory, number>> = {};
  if (plan) {
    for (const item of plan.items) {
      if (item.kind === 'event') meetingCount += 1;
      else if (item.kind === 'task') taskCount += 1;
      else otherCount += 1;
      categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
    }
  }
  const summaryParts: string[] = [];
  if (taskCount > 0) summaryParts.push(`${taskCount} task${taskCount === 1 ? '' : 's'}`);
  if (meetingCount > 0) summaryParts.push(`${meetingCount} mtg${meetingCount === 1 ? '' : 's'}`);
  if (otherCount > 0) summaryParts.push(`${otherCount} email${otherCount === 1 ? '' : 's'}`);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        plan
          ? `${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} — ${plan.items.length} item${plan.items.length === 1 ? '' : 's'} planned, ${STATUS_TONE[plan.status].label.toLowerCase()}`
          : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
      }
      aria-pressed={isSelected}
      className={cn(
        'min-h-[92px] p-2 text-left rounded-lg border transition-colors flex flex-col gap-1',
        inMonth ? 'bg-card' : 'bg-muted/20',
        isSelected
          ? 'border-primary ring-2 ring-primary/30'
          : isToday
          ? 'border-primary/60'
          : 'border-border/60 hover:border-border',
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cn('text-sm font-bold', !inMonth && 'text-muted-foreground/50', isToday && 'text-primary')}>
          {date.getDate()}
        </span>
        {leave.length > 0 ? (
          <span className="text-[9px] font-bold px-1 rounded bg-sky-100 text-sky-800" aria-hidden="true">Leave</span>
        ) : plan && plan.items.length > 0 ? (
          <span className={cn('text-[9px] font-bold px-1 rounded', tone.pillBg, tone.pillText)} aria-hidden="true">{plan.items.length}</span>
        ) : null}
      </div>
      {plan && plan.items.length > 0 && (
        <>
          <p className="text-[10px] font-semibold text-foreground/80 leading-tight">
            {summaryParts.join(' · ')}
          </p>
          <p className="text-[10px] text-muted-foreground tabular-nums leading-tight">
            {fmtMin(plan.totalPlannedMin)}
            {plan.minutesAvailable > 0 && (
              <span className="text-muted-foreground/70"> / {fmtMin(plan.minutesAvailable)}</span>
            )}
          </p>
          <div className="mt-auto flex flex-wrap gap-0.5" aria-hidden="true">
            {Object.entries(categoryCounts).slice(0, 6).map(([cat]) => {
              const t = CATEGORY_TONE[cat as AiCategory] ?? CATEGORY_TONE.ADMIN;
              return <span key={cat} className={cn('w-1.5 h-1.5 rounded-full', t.dot)} />;
            })}
          </div>
        </>
      )}
      {plan && plan.minutesAvailable > 0 && plan.items.length === 0 && (
        <span className="text-[10px] text-muted-foreground mt-auto">{fmtMin(plan.minutesAvailable)} free</span>
      )}
    </button>
  );
}

export default function CalendarTab({ weekSetup, manualTasks, onOpenEmail, onNavigate, onOpenWeeklySetup, onUpdateAvailability }: Props) {
  const planner = usePlannerOutput(manualTasks, weekSetup);
  const leaveBlocks = useLeaveBlocks();
  const openEmail = (id: number) => {
    onOpenEmail(id);
    onNavigate('Emails');
  };

  // Task / event detail modal. We track the calendar date the item
  // was rendered against so the modal can pre-fill the date picker
  // even for items whose underlying store doesn't carry a date
  // (e.g. linked-doc tasks).
  const [selectedTask, setSelectedTask] = useState<{ item: PlanItem; date: string } | null>(null);
  const openTaskOnDate = (date: string) => (item: PlanItem) => {
    setSelectedTask({ item, date });
  };
  const [mode, setMode] = useState<RangeMode>('week');
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this week, 1 = next week
  const today = useMemo(() => startOfDay(new Date()), []);
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Calendar shows tasks/events only (reports, CPD, meetings, manual +
  // linked-doc tasks). Emails live in the Inbox/Today's Plan surfaces,
  // not the diary. filterRunwayToTasks recomputes per-day load + status
  // from the filtered items so the colour swatches honestly reflect
  // events-only load — kept in one helper so the mini calendar on Home
  // and this full view stay in lockstep.
  const tasksOnlyRunway = useMemo(() => filterRunwayToTasks(planner.runway), [planner.runway]);
  const runwayByDate = useMemo(() => indexRunway(tasksOnlyRunway), [tasksOnlyRunway]);
  const horizonEnd = addDays(today, tasksOnlyRunway.length - 1);

  // Days shown in week / two-week mode
  const startOffset = mode === 'week' ? weekOffset * 7 : 0;
  const colCount = mode === 'twoweeks' ? 14 : 7;
  const columnDays = useMemo(() => {
    return Array.from({ length: colCount }, (_, i) => addDays(today, startOffset + i));
  }, [today, startOffset, colCount]);

  // Month grid
  const monthGrid = useMemo(() => {
    if (mode !== 'month') return [];
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    // Monday-start grid
    const dow = (first.getDay() + 6) % 7; // 0 = Mon
    const gridStart = addDays(first, -dow);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [mode, monthAnchor]);

  // Month nav is bounded to months that intersect the planner runway
  // [today, horizonEnd]. Outside that range the calendar would be all
  // empty cells, which isn't useful.
  const monthFirst = monthAnchor;
  const monthLast = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
  const todayMonthFirst = new Date(today.getFullYear(), today.getMonth(), 1);
  const horizonMonthFirst = new Date(horizonEnd.getFullYear(), horizonEnd.getMonth(), 1);
  const canGoBack =
    mode === 'week' ? weekOffset > 0 : mode === 'month' ? monthFirst > todayMonthFirst : false;
  const canGoForward =
    mode === 'week'
      ? weekOffset < Math.ceil(tasksOnlyRunway.length / 7) - 1
      : mode === 'month'
        ? monthLast < horizonEnd || monthFirst < horizonMonthFirst
        : false;

  const goPrev = () => {
    if (mode === 'week') setWeekOffset(Math.max(0, weekOffset - 1));
    else if (mode === 'month') setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1));
  };
  const goNext = () => {
    if (mode === 'week')
      setWeekOffset(Math.min(Math.ceil(tasksOnlyRunway.length / 7) - 1, weekOffset + 1));
    else if (mode === 'month') setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1));
  };
  const goToday = () => {
    if (mode === 'month') setMonthAnchor(new Date(today.getFullYear(), today.getMonth(), 1));
    else setWeekOffset(0);
    setSelectedDate(null);
  };

  const headerTitle = useMemo(() => {
    if (mode === 'month') {
      return monthAnchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
    const first = columnDays[0];
    const last = columnDays[columnDays.length - 1];
    const sameMonth = first.getMonth() === last.getMonth();
    const fOpts: Intl.DateTimeFormatOptions = sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' };
    return `${first.toLocaleDateString('en-GB', fOpts)} – ${last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }, [mode, columnDays, monthAnchor]);

  // Aggregate for header
  const visiblePlans = mode === 'month'
    ? monthGrid.map(d => runwayByDate.get(dateKey(d))).filter(Boolean) as DailyPlan[]
    : columnDays.map(d => runwayByDate.get(dateKey(d))).filter(Boolean) as DailyPlan[];
  const totalPlanned = visiblePlans.reduce((s, p) => s + p.totalPlannedMin, 0);
  const totalCapacity = visiblePlans.reduce((s, p) => s + p.minutesAvailable, 0);
  const breachCount = visiblePlans.filter(p => p.status === 'breach').length;

  const selectedPlan = selectedDate ? runwayByDate.get(dateKey(selectedDate)) ?? null : null;

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Header */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                <CalendarIcon size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold leading-tight truncate">{headerTitle}</h2>
                <p className="text-xs text-muted-foreground">
                  {fmtMin(totalPlanned)} planned · {fmtMin(totalCapacity)} scheduled
                  {breachCount > 0 && (
                    <span className="ml-2 text-red-700 font-semibold">· {breachCount} overloaded {breachCount === 1 ? 'day' : 'days'}</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Range selector */}
              <div className="inline-flex rounded-lg border border-border overflow-hidden">
                {([
                  { id: 'week', label: '1 week' },
                  { id: 'twoweeks', label: '2 weeks' },
                  { id: 'month', label: 'Month' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => { setMode(opt.id); setSelectedDate(null); }}
                    className={cn(
                      'text-xs font-bold px-3 py-1.5 uppercase tracking-wider transition-colors',
                      mode === opt.id ? 'bg-foreground text-background' : 'hover:bg-muted/50',
                    )}
                    data-testid={`calendar-mode-${opt.id}`}
                    aria-pressed={mode === opt.id}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Navigation */}
              <div className="inline-flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={goPrev}
                  disabled={!canGoBack}
                  className="p-1.5 hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  data-testid="calendar-prev"
                  aria-label="Previous"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={goToday}
                  className="text-xs font-bold px-2 py-1.5 hover:bg-muted/50 uppercase tracking-wider border-x border-border"
                  data-testid="calendar-today"
                >
                  Today
                </button>
                <button
                  onClick={goNext}
                  disabled={!canGoForward}
                  className="p-1.5 hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  data-testid="calendar-next"
                  aria-label="Next"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Week / Two-week column view */}
      {mode !== 'month' && (
        <div
          className={cn(
            'grid gap-3',
            mode === 'week' ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7' : 'grid-cols-2 sm:grid-cols-4 md:grid-cols-7',
          )}
        >
          {columnDays.map(d => (
            <DayColumn
              key={dateKey(d)}
              date={d}
              plan={runwayByDate.get(dateKey(d)) ?? null}
              onOpenEmail={openEmail}
              onOpenTask={openTaskOnDate(dateKey(d))}
              leave={leaveBlocksForDay(dateKey(d), leaveBlocks)}
            />
          ))}
        </div>
      )}

      {/* Month grid + side detail column.
          When a day is selected, the grid shrinks and a detail panel
          appears to the right (stacks below on narrow screens) so the
          clinician can read the day without losing the month context. */}
      {mode === 'month' && (
        <div
          className={cn(
            'grid gap-4',
            selectedDate ? 'lg:grid-cols-[1fr_320px]' : 'grid-cols-1',
          )}
        >
          <Card className="border-border/60">
            <CardContent className="p-4">
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                  <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid.map(d => {
                  const inMonth = d.getMonth() === monthAnchor.getMonth();
                  const inHorizon = d.getTime() >= today.getTime() && d.getTime() <= horizonEnd.getTime();
                  const plan = inHorizon ? runwayByDate.get(dateKey(d)) ?? null : null;
                  const isToday = d.getTime() === today.getTime();
                  const isSelected = !!selectedDate && d.getTime() === selectedDate.getTime();
                  return (
                    <MonthCell
                      key={dateKey(d)}
                      date={d}
                      plan={plan}
                      inMonth={inMonth}
                      isToday={isToday}
                      onClick={() => setSelectedDate(isSelected ? null : d)}
                      isSelected={isSelected}
                      leave={leaveBlocksForDay(dateKey(d), leaveBlocks)}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Side detail column — only rendered while a day is selected */}
          {selectedDate && (
            <Card className="border-primary/40 lg:sticky lg:top-4 lg:self-start" data-testid="month-day-detail">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Day detail
                    </p>
                    <h3 className="text-sm font-bold leading-tight mt-0.5">
                      {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </h3>
                    {selectedPlan && (
                      <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                        {fmtMin(selectedPlan.totalPlannedMin)} planned · {fmtMin(selectedPlan.minutesAvailable)} available
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {selectedPlan && (
                      <span className={cn('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded', STATUS_TONE[selectedPlan.status].pillBg, STATUS_TONE[selectedPlan.status].pillText)}>
                        {STATUS_TONE[selectedPlan.status].label}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedDate(null)}
                      className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
                      aria-label="Close day detail"
                      data-testid="month-day-detail-close"
                    >
                      ×
                    </button>
                  </div>
                </div>
                {!selectedPlan && (
                  <p className="text-xs text-muted-foreground italic">Beyond the 14-day planning horizon — nothing scheduled yet.</p>
                )}
                {selectedPlan && selectedPlan.items.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">{selectedPlan.minutesAvailable === 0 ? 'No admin time scheduled.' : 'Nothing planned for this day.'}</p>
                )}
                {selectedPlan && selectedPlan.items.length > 0 && (
                  <div className="space-y-1.5">
                    {selectedPlan.items.map((item, i) => (
                      <ItemChip
                        key={`${item.kind}-${item.refId ?? i}`}
                        item={item}
                        onOpenEmail={openEmail}
                        onOpenTask={openTaskOnDate(selectedPlan.date)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Availability adjustment — lives on Calendar so the clinician
          can tweak this week's hours next to the view that visualises
          the impact. Moved here from Home to keep the dashboard calm. */}
      <LeavePanel />

      <AvailabilityPanel
        weekSetup={weekSetup}
        onUpdateAvailability={onUpdateAvailability}
        onOpenWeeklySetup={onOpenWeeklySetup}
      />

      {selectedTask && (
        <CalendarTaskDetailModal
          item={selectedTask.item}
          scheduledDate={selectedTask.date}
          onClose={() => setSelectedTask(null)}
          onNavigateToTasks={() => onNavigate('Tasks')}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        <span className="font-bold uppercase tracking-widest">Legend:</span>
        {([
          ['SAFEGUARDING', 'Safeguarding'],
          ['URGENT_CLINICAL', 'Urgent clinical'],
          ['CLINICAL', 'Clinical'],
          ['PROFESSIONAL', 'Professional'],
          ['ADMIN', 'Admin'],
          ['LEGAL', 'Legal'],
        ] as const).map(([cat, label]) => (
          <span key={cat} className="inline-flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full', CATEGORY_TONE[cat as AiCategory].dot)} />
            {label}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} className="text-green-700" />On track</span>
          <span className="inline-flex items-center gap-1"><Clock size={10} className="text-amber-700" />Tight</span>
          <span className="inline-flex items-center gap-1"><AlertTriangle size={10} className="text-red-700" />Overloaded</span>
        </span>
      </div>
    </div>
  );
}
