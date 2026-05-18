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
import AddPlannedItemDialog from './AddPlannedItemDialog';

type Layout = 'columns' | 'agenda';

interface Props {
  runway: DailyPlan[];
}

// Weekly task + event overview, mounted on Home below Today's Plan
// and the mini workload calendar. Shows the seven days ahead grouped
// either as side-by-side columns or as a vertical agenda list (the
// clinician picks). Anything added here flows straight into the
// planner, the mini calendar, and the full Calendar tab.
export default function WeeklyTaskOverview({ runway }: Props) {
  const [layout, setLayout] = useState<Layout>('columns');
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<string>(() => dateKey(new Date()));

  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(today, i)),
    [today],
  );
  // Calendar surfaces show diary work only — emails belong on Today's
  // Plan and the inbox. Same filter the mini cal + full Calendar use,
  // so totals match.
  const tasksOnlyRunway = useMemo(() => filterRunwayToTasks(runway), [runway]);
  const runwayByDate = useMemo(() => indexRunway(tasksOnlyRunway), [tasksOnlyRunway]);

  const openAddFor = (d: string) => {
    setAddDate(d);
    setAddOpen(true);
  };

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
            <h3 className="text-base font-bold leading-tight">Week ahead</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your tasks and events, in order. Add anything that isn't email.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          />
        ) : (
          <AgendaLayout
            days={days}
            today={today}
            runwayByDate={runwayByDate}
            onAdd={openAddFor}
          />
        )}
      </div>

      <AddPlannedItemDialog
        open={addOpen}
        defaultDate={addDate}
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns layout — seven narrow columns side-by-side, scrollable
// horizontally on small screens.
// ---------------------------------------------------------------------------

function ColumnsLayout({
  days,
  today,
  runwayByDate,
  onAdd,
}: {
  days: Date[];
  today: Date;
  runwayByDate: Map<string, DailyPlan>;
  onAdd: (date: string) => void;
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
                    <CompactItem key={`${item.kind}-${item.refId}-${idx}`} item={item} />
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
}: {
  days: Date[];
  today: Date;
  runwayByDate: Map<string, DailyPlan>;
  onAdd: (date: string) => void;
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
                    <AgendaRow item={item} />
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

function CompactItem({ item }: { item: PlanItem }) {
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
        'rounded-md border px-1.5 py-1 text-[10px] relative group',
        tone.chipBg,
        tone.chipText,
        tone.chipBorder,
      )}
      title={item.reasonText}
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
            onClick={() => deleteUserPlannedItem(item.refId as string)}
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

function AgendaRow({ item }: { item: PlanItem }) {
  const tone =
    item.kind === 'event'
      ? CATEGORY_TONE.PROFESSIONAL
      : CATEGORY_TONE[item.category] ?? CATEGORY_TONE.ADMIN;
  const Icon = pickIcon(item.kind);
  const userPlanned = useUserPlannedItems();
  const isUserItem = userPlanned.some((u) => u.id === item.refId);
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 hover:bg-slate-50/60 group">
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
          onClick={() => deleteUserPlannedItem(item.refId as string)}
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
