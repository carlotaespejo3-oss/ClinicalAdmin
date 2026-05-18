import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Trash2, CalendarClock } from 'lucide-react';
import {
  useUserPlannedItems,
  deleteUserPlannedItem,
  type UserPlannedItem,
} from '@/lib/userPlannedItemsStore';
import { cn } from '@/lib/utils';
import { fmtMin, dateKey, startOfDay } from '@/lib/calendarHelpers';
import AddPlannedItemDialog from './AddPlannedItemDialog';

// Simple flat list of items the clinician has added by hand, sorted
// by date (soonest first). Sits beside Today's Plan on Home and is
// the clinician's one-stop place to jot down anything that isn't
// email — a call to make, a letter to write, a meeting to attend.
//
// Everything added here flows into the planner (via
// usePlannerOutput) and appears on the "Week ahead" grid below and
// on the full Calendar tab.
export default function TaskList() {
  const items = useUserPlannedItems();
  const [addOpen, setAddOpen] = useState(false);

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = useMemo(() => dateKey(today), [today]);

  // Sort by date asc, then by created time so the most-recently added
  // wins ties — feels right when the clinician adds two things for
  // the same day in quick succession.
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.createdAt - b.createdAt;
    });
  }, [items]);

  return (
    <div
      className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col"
      data-testid="task-list"
    >
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <ClipboardList size={17} className="text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-tight">My tasks</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Anything you've added by hand, in date order.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md bg-primary text-white hover:brightness-110"
          data-testid="task-list-add"
        >
          <Plus size={13} />
          Add
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="px-5 py-10 flex flex-col items-center justify-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
            <ClipboardList size={20} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-foreground">
            Nothing on your list yet
          </p>
          <p className="text-xs text-muted-foreground max-w-[240px]">
            Add a task or event and it'll show up here, on the week ahead, and
            on your calendar.
          </p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md bg-primary text-white hover:brightness-110"
            data-testid="task-list-add-empty"
          >
            <Plus size={13} />
            Add your first
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border/60 flex-1 overflow-y-auto">
          {sorted.map((item) => (
            <li key={item.id}>
              <TaskRow item={item} todayKey={todayKey} />
            </li>
          ))}
        </ul>
      )}

      <AddPlannedItemDialog
        open={addOpen}
        defaultDate={todayKey}
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}

function TaskRow({
  item,
  todayKey,
}: {
  item: UserPlannedItem;
  todayKey: string;
}) {
  const isEvent = item.kind === 'event';
  const Icon = isEvent ? CalendarClock : ClipboardList;
  const mins = isEvent
    ? (item as Extract<UserPlannedItem, { kind: 'event' }>).durationMin
    : (item as Extract<UserPlannedItem, { kind: 'task' }>).estMin;
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60 group">
      <span
        className={cn(
          'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5',
          isEvent
            ? 'bg-violet-100 text-violet-600 border border-violet-200'
            : 'bg-indigo-100 text-indigo-600 border border-indigo-200',
        )}
      >
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">
          {item.title}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          <span className={item.date === todayKey ? 'text-primary font-bold' : ''}>
            {formatDateLabel(item.date, todayKey)}
          </span>
          <span className="mx-1.5 text-border">·</span>
          <span className="tabular-nums">{fmtMin(mins)}</span>
          {isEvent &&
            (item as Extract<UserPlannedItem, { kind: 'event' }>).startTime && (
              <>
                <span className="mx-1.5 text-border">·</span>
                <span className="tabular-nums">
                  {(item as Extract<UserPlannedItem, { kind: 'event' }>).startTime}
                </span>
              </>
            )}
        </p>
      </div>
      <button
        type="button"
        onClick={() => deleteUserPlannedItem(item.id)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-700 mt-1.5 transition-opacity"
        aria-label="Remove"
        data-testid={`task-list-remove-${item.id}`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function formatDateLabel(iso: string, todayKey: string): string {
  // iso = YYYY-MM-DD local
  if (iso === todayKey) return 'Today';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Tomorrow check
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const tomorrow = new Date(ty, tm - 1, td + 1);
  if (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  ) {
    return 'Tomorrow';
  }
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
