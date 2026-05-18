import { useMemo, useState } from 'react';
import {
  CalendarRange,
  Plus,
  Columns3,
  List,
  ClipboardList,
  Mail,
  CalendarClock,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { DailyPlan, PlanItem } from '@/lib/planner';
import { cn } from '@/lib/utils';
import {
  CATEGORY_TONE,
  fmtMin,
  startOfDay,
  addDays,
  dateKey,
  indexRunway,
  filterRunwayToTasks,
} from '@/lib/calendarHelpers';
import {
  useUserPlannedItems,
  deleteUserPlannedItem,
} from '@/lib/userPlannedItemsStore';
import { useManualTasksWithOverrides } from '@/lib/manualTaskOverridesStore';
import AddPlannedItemDialog from './AddPlannedItemDialog';
import EmailPreviewModal from './EmailPreviewModal';
import TaskDetailModal, { type TaskDetail } from './TaskDetailModal';

type Layout = 'columns' | 'agenda';
type Range = 'week' | 'fortnight' | 'month';

const RANGE_DAYS: Record<Range, number> = {
  week: 7,
  fortnight: 14,
  month: 28,
};

interface Props {
  runway: DailyPlan[];
  // Optional click-through to open an email in the Inbox tab. Wired
  // up from HomeTab so clicking an email-linked task here behaves
  // exactly the same as in the "My tasks" box.
  onOpenEmail?: (emailId: number) => void;
}

// Weekly task + event overview, mounted on Home below Today's Plan
// and the mini workload calendar. Shows the days ahead grouped
// either as side-by-side columns or as a vertical agenda list (the
// clinician picks). Anything added here flows straight into the
// planner, the mini calendar, and the full Calendar tab.
//
// Range can be flipped between week / fortnight / month — the
// columns layout keeps 7 across and wraps onto extra rows for the
// bigger ranges, so the box just grows downwards. Prev / next nudge
// the window by the current range size; "Today" snaps it back.
export default function WeeklyTaskOverview({ runway, onOpenEmail }: Props) {
  const [layout, setLayout] = useState<Layout>('columns');
  const [range, setRange] = useState<Range>('week');
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<string>(() => dateKey(new Date()));
  // Anchor is the first day of the visible window. Stored as an
  // offset in days from today so the today indicator stays correct
  // across midnight without us re-rendering.
  const [offsetDays, setOffsetDays] = useState(0);
  const [previewEmailId, setPreviewEmailId] = useState<number | null>(null);
  const [detailTask, setDetailTask] = useState<TaskDetail | null>(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = useMemo(() => dateKey(today), [today]);
  const anchor = useMemo(() => addDays(today, offsetDays), [today, offsetDays]);

  const length = RANGE_DAYS[range];
  const days = useMemo(
    () => Array.from({ length }, (_, i) => addDays(anchor, i)),
    [anchor, length],
  );

  // Calendar surfaces show diary work only — emails belong on Today's
  // Plan and the inbox. Same filter the mini cal + full Calendar use,
  // so totals match.
  const tasksOnlyRunway = useMemo(() => filterRunwayToTasks(runway), [runway]);
  const runwayByDate = useMemo(() => indexRunway(tasksOnlyRunway), [tasksOnlyRunway]);

  // For richer click-through details: resolve a plan row whose refId
  // points at a seed manual task back to its metadata (notes, type,
  // risk), exactly like TaskList does.
  const manualTasks = useManualTasksWithOverrides();
  const manualTasksById = useMemo(() => {
    const m = new Map<string, (typeof manualTasks)[number]>();
    for (const t of manualTasks) m.set(t.id, t);
    return m;
  }, [manualTasks]);
  const userPlanned = useUserPlannedItems();
  const userIds = useMemo(
    () => new Set(userPlanned.map((u) => u.id)),
    [userPlanned],
  );

  const openAddFor = (d: string) => {
    setAddDate(d);
    setAddOpen(true);
  };

  // Mirrors TaskList.handleRowClick so the two boxes feel identical:
  //   · items linked to an email → open the email preview modal
  //   · everything else (manual / user-added tasks, events) → open
  //     the read-only task detail modal so the clinician sees what
  //     the item actually is.
  const handleItemClick = (item: PlanItem, dateIso: string) => {
    if (typeof item.linkedToEmailId === 'number') {
      setPreviewEmailId(item.linkedToEmailId);
      return;
    }
    const refId = typeof item.refId === 'string' ? item.refId : null;
    const seed = refId ? manualTasksById.get(refId) : undefined;
    const isUser = refId !== null && userIds.has(refId);
    const sourceLabel =
      item.kind === 'event'
        ? 'Calendar event'
        : isUser
          ? 'Manually added'
          : 'Scheduled task';
    setDetailTask({
      title: item.title,
      sourceLabel,
      dueLabel: formatDateLabel(dateIso, todayKey),
      estMin: item.estMin,
      typeLabel: seed?.type ?? null,
      risk: seed?.risk,
      patientName: null,
      notes: seed?.noteAfterEmailDone ?? null,
    });
  };

  // ---- Window navigation -------------------------------------------------
  const goPrev = () => setOffsetDays((o) => o - length);
  const goNext = () => setOffsetDays((o) => o + length);
  const goToday = () => setOffsetDays(0);
  // True when the window contains today's date — used to disable
  // the "Today" jump button so it doesn't look interactive when it
  // wouldn't change anything.
  const containsToday = offsetDays <= 0 && offsetDays + length > 0;

  const rangeLabel = useMemo(() => {
    const last = days[days.length - 1];
    const sameYear = anchor.getFullYear() === last.getFullYear();
    const startFmt: Intl.DateTimeFormatOptions = sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
    const endFmt: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    };
    return `${anchor.toLocaleDateString('en-GB', startFmt)} – ${last.toLocaleDateString('en-GB', endFmt)}`;
  }, [anchor, days]);

  return (
    <div
      className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden"
      data-testid="weekly-task-overview"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
            <CalendarRange size={17} className="text-violet-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-tight">
              {range === 'week' ? 'Week ahead' : range === 'fortnight' ? 'Fortnight ahead' : 'Month ahead'}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="tabular-nums">{rangeLabel}</span>
              <span className="mx-1.5 text-border">·</span>
              Tap an item to open it.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* ---- Range toggle ---- */}
          <div
            className="inline-flex rounded-lg border border-border bg-slate-50 p-0.5"
            role="tablist"
            aria-label="Range"
          >
            {(
              [
                { id: 'week', label: 'Week' },
                { id: 'fortnight', label: 'Fortnight' },
                { id: 'month', label: 'Month' },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                aria-selected={range === id}
                onClick={() => {
                  setRange(id);
                  // Re-anchor to today on range change so the new
                  // window starts where the clinician expects.
                  setOffsetDays(0);
                }}
                className={cn(
                  'text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors',
                  range === id
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                data-testid={`weekly-overview-range-${id}`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* ---- Window nav: prev / today / next ---- */}
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={goPrev}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white"
              aria-label="Previous period"
              data-testid="weekly-overview-prev"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={goToday}
              disabled={containsToday}
              className={cn(
                'text-[11px] font-bold px-2 py-1 rounded-md transition-colors',
                containsToday
                  ? 'text-muted-foreground/50 cursor-default'
                  : 'text-foreground hover:bg-white',
              )}
              data-testid="weekly-overview-today"
            >
              Today
            </button>
            <button
              type="button"
              onClick={goNext}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white"
              aria-label="Next period"
              data-testid="weekly-overview-next"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          {/* ---- Layout toggle ---- */}
          <div
            className="inline-flex rounded-lg border border-border bg-slate-50 p-0.5"
            role="tablist"
            aria-label="Layout"
          >
            {(
              [
                { id: 'columns', label: 'Columns', Icon: Columns3 },
                { id: 'agenda', label: 'Agenda', Icon: List },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={layout === id}
                onClick={() => setLayout(id)}
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md transition-colors',
                  layout === id
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                data-testid={`weekly-overview-layout-${id}`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => openAddFor(dateKey(today))}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md bg-primary text-white hover:brightness-110"
            data-testid="weekly-overview-add"
          >
            <Plus size={13} />
            Add
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {layout === 'columns' ? (
          <ColumnsLayout
            days={days}
            today={today}
            runwayByDate={runwayByDate}
            onAdd={openAddFor}
            onItemClick={handleItemClick}
          />
        ) : (
          <AgendaLayout
            days={days}
            today={today}
            runwayByDate={runwayByDate}
            onAdd={openAddFor}
            onItemClick={handleItemClick}
          />
        )}
      </div>

      <AddPlannedItemDialog
        open={addOpen}
        defaultDate={addDate}
        onClose={() => setAddOpen(false)}
      />
      <EmailPreviewModal
        open={previewEmailId !== null}
        emailId={previewEmailId}
        onClose={() => setPreviewEmailId(null)}
        onOpenInInbox={onOpenEmail}
      />
      <TaskDetailModal
        open={detailTask !== null}
        detail={detailTask}
        onClose={() => setDetailTask(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns layout — 7-wide grid that wraps onto more rows as the
// range grows (fortnight = 2 rows, month = 4 rows). Keeps the
// column width steady and just expands downwards, which matches
// the clinician's "I like the size, expand down" preference.
// ---------------------------------------------------------------------------

function ColumnsLayout({
  days,
  today,
  runwayByDate,
  onAdd,
  onItemClick,
}: {
  days: Date[];
  today: Date;
  runwayByDate: Map<string, DailyPlan>;
  onAdd: (date: string) => void;
  onItemClick: (item: PlanItem, dateIso: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-2 overflow-x-auto">
      {days.map((d) => {
        const key = dateKey(d);
        const plan = runwayByDate.get(key) ?? null;
        const isToday = d.getTime() === today.getTime();
        const items = plan?.items ?? [];
        return (
          <div
            key={key}
            className={cn(
              'min-w-0 rounded-xl border bg-slate-50/40 flex flex-col',
              isToday ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border/60',
            )}
            data-testid={`weekly-overview-col-${key}`}
          >
            <div
              className={cn(
                'px-2 py-2 border-b flex items-baseline justify-between gap-1',
                isToday ? 'bg-primary/5 border-primary/20' : 'border-border/60',
              )}
            >
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {d.toLocaleDateString('en-GB', { weekday: 'short' })}
                </p>
                <p className="text-sm font-bold leading-none mt-0.5">{d.getDate()}</p>
              </div>
              {isToday && (
                <span className="text-[8px] font-bold uppercase tracking-widest text-primary">
                  Today
                </span>
              )}
            </div>
            <div className="p-1.5 space-y-1.5 flex-1 min-h-[120px]">
              {items.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onAdd(dateKey(d))}
                  className="w-full text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent rounded-md py-2 transition-colors"
                  data-testid={`weekly-overview-add-day-${dateKey(d)}`}
                >
                  + Add
                </button>
              ) : (
                <>
                  {items.map((item, idx) => (
                    <CompactItem
                      key={`${item.kind}-${item.refId}-${idx}`}
                      item={item}
                      onClick={() => onItemClick(item, key)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => onAdd(dateKey(d))}
                    className="w-full text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent rounded-md py-1 transition-colors"
                    data-testid={`weekly-overview-add-day-${dateKey(d)}`}
                  >
                    +
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda layout — vertical list grouped by day header.
// ---------------------------------------------------------------------------

function AgendaLayout({
  days,
  today,
  runwayByDate,
  onAdd,
  onItemClick,
}: {
  days: Date[];
  today: Date;
  runwayByDate: Map<string, DailyPlan>;
  onAdd: (date: string) => void;
  onItemClick: (item: PlanItem, dateIso: string) => void;
}) {
  return (
    <div className="space-y-3">
      {days.map((d) => {
        const key = dateKey(d);
        const plan = runwayByDate.get(key) ?? null;
        const isToday = d.getTime() === today.getTime();
        const items = plan?.items ?? [];
        const totalMin = items.reduce((s, i) => s + i.estMin, 0);
        return (
          <div
            key={key}
            className="rounded-xl border border-border/60 overflow-hidden"
            data-testid={`weekly-overview-agenda-${key}`}
          >
            <div
              className={cn(
                'px-3 py-2 flex items-center justify-between gap-2 border-b',
                isToday
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-slate-50/60 border-border/60',
              )}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'text-xs font-bold',
                    isToday && 'text-primary',
                  )}
                >
                  {d.toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
                {isToday && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-primary">
                    Today
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {items.length > 0 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {items.length} item{items.length === 1 ? '' : 's'} ·{' '}
                    {fmtMin(totalMin)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onAdd(key)}
                  className="text-[10px] font-bold text-primary hover:underline"
                  data-testid={`weekly-overview-agenda-add-${key}`}
                >
                  + Add
                </button>
              </div>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-3 py-3">
                Nothing planned.
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {items.map((item, idx) => (
                  <li key={`${item.kind}-${item.refId}-${idx}`}>
                    <AgendaRow item={item} onClick={() => onItemClick(item, key)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item renderers
// ---------------------------------------------------------------------------

function pickIcon(kind: PlanItem['kind']) {
  switch (kind) {
    case 'event':
      return CalendarClock;
    case 'task':
      return ClipboardList;
    case 'email':
      return Mail;
    default:
      return ClipboardList;
  }
}

function CompactItem({ item, onClick }: { item: PlanItem; onClick: () => void }) {
  const tone =
    item.kind === 'event'
      ? CATEGORY_TONE.PROFESSIONAL
      : CATEGORY_TONE[item.category] ?? CATEGORY_TONE.ADMIN;
  const Icon = pickIcon(item.kind);
  const userPlanned = useUserPlannedItems();
  const isUserItem = userPlanned.some((u) => u.id === item.refId);
  return (
    <div
      className={cn(
        'rounded-md border px-1.5 py-1 text-[10px] relative group cursor-pointer transition-shadow hover:shadow-sm',
        tone.chipBg,
        tone.chipText,
        tone.chipBorder,
      )}
      title={item.reasonText}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start gap-1 min-w-0">
        <Icon size={9} className="mt-0.5 flex-shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate leading-tight">{item.title}</p>
          <p className="opacity-70 mt-0.5 tabular-nums">{fmtMin(item.estMin)}</p>
        </div>
        {isUserItem && typeof item.refId === 'string' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteUserPlannedItem(item.refId as string);
            }}
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 hover:text-red-700"
            aria-label="Remove"
            data-testid={`weekly-overview-remove-${item.refId}`}
          >
            <Trash2 size={9} />
          </button>
        )}
      </div>
    </div>
  );
}

function AgendaRow({ item, onClick }: { item: PlanItem; onClick: () => void }) {
  const tone =
    item.kind === 'event'
      ? CATEGORY_TONE.PROFESSIONAL
      : CATEGORY_TONE[item.category] ?? CATEGORY_TONE.ADMIN;
  const Icon = pickIcon(item.kind);
  const userPlanned = useUserPlannedItems();
  const isUserItem = userPlanned.some((u) => u.id === item.refId);
  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2 hover:bg-slate-50/60 group cursor-pointer transition-colors"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span
        className={cn(
          'w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0',
          tone.chipBg,
          tone.chipText,
          'border',
          tone.chipBorder,
        )}
      >
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">{item.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {item.reasonText}
          <span className="mx-1.5 text-border">·</span>
          <span className="tabular-nums">{fmtMin(item.estMin)}</span>
        </p>
      </div>
      {isUserItem && typeof item.refId === 'string' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            deleteUserPlannedItem(item.refId as string);
          }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-700 mt-0.5"
          aria-label="Remove"
          data-testid={`weekly-overview-remove-${item.refId}`}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

// Same "Today / Tomorrow / Wednesday / Wed 20 May" logic TaskList
// uses, kept local because the rule is small and inlining avoids
// another shared util just for date labels.
function formatDateLabel(iso: string, todayKey: string): string {
  if (iso === todayKey) return 'Today';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const tomorrow = new Date(ty, tm - 1, td + 1);
  if (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  ) {
    return 'Tomorrow';
  }
  const diffDays = Math.round(
    (date.getTime() - new Date(ty, tm - 1, td).getTime()) / 86_400_000,
  );
  if (diffDays > 1 && diffDays <= 6) {
    return date.toLocaleDateString('en-GB', { weekday: 'long' });
  }
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
