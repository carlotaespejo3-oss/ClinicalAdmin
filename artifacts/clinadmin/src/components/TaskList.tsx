import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Trash2, Mail, Sparkles } from 'lucide-react';
import type { DailyPlan, PlanItem } from '@/lib/planner';
import {
  useUserPlannedItems,
  deleteUserPlannedItem,
} from '@/lib/userPlannedItemsStore';
import { cn } from '@/lib/utils';
import { fmtMin, dateKey, startOfDay } from '@/lib/calendarHelpers';
import AddPlannedItemDialog from './AddPlannedItemDialog';

interface Props {
  runway: DailyPlan[];
}

type Row = {
  date: string;
  item: PlanItem;
};

// Flat task list shown beside Today's Plan on Home.
//
// Sources: pulls EVERYTHING the planner has scheduled across the
// 14-day runway — emails the AI extracted into actionable work,
// existing manual tasks, AND items the clinician just added by hand
// from the Add dialog. Sorted by date (soonest first).
//
// Events are intentionally excluded — they live on the calendar,
// not in a task list.
//
// Delete is offered only on items the clinician added by hand
// (matched against the user-planned-items store by refId), since
// AI-derived rows reflect emails / linked clinical tasks that are
// owned by the inbox/tasks tabs.
export default function TaskList({ runway }: Props) {
  const userPlanned = useUserPlannedItems();
  const [addOpen, setAddOpen] = useState(false);

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = useMemo(() => dateKey(today), [today]);

  // Set of user-added refIds — used to decide which rows get a
  // delete affordance. Tasks become PlannerTasks with `refId = it.id`
  // in usePlannerOutput, so they appear with kind='task' here.
  const userIds = useMemo(
    () => new Set(userPlanned.map((u) => u.id)),
    [userPlanned],
  );

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const day of runway) {
      for (const item of day.items) {
        if (item.kind === 'event') continue;
        out.push({ date: day.date, item });
      }
    }
    return out;
  }, [runway]);

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
              Everything you're scheduled to do — AI-planned and your own.
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

      {rows.length === 0 ? (
        <div className="px-5 py-10 flex flex-col items-center justify-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
            <ClipboardList size={20} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-foreground">
            Nothing scheduled
          </p>
          <p className="text-xs text-muted-foreground max-w-[240px]">
            Add a task and it'll show up here alongside anything the AI
            schedules from your inbox.
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
        <ul
          className="divide-y divide-border/60 flex-1 overflow-y-auto max-h-[480px]"
          data-testid="task-list-rows"
        >
          {rows.map((row, idx) => (
            <li key={`${row.date}-${row.item.kind}-${row.item.refId}-${idx}`}>
              <TaskRow
                row={row}
                todayKey={todayKey}
                isUserItem={
                  typeof row.item.refId === 'string' && userIds.has(row.item.refId)
                }
              />
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
  row,
  todayKey,
  isUserItem,
}: {
  row: Row;
  todayKey: string;
  isUserItem: boolean;
}) {
  const { item, date } = row;
  const isEmail = item.kind === 'email';
  // AI-derived = anything the planner scheduled that the clinician
  // didn't add by hand. Lets us mark these rows with the spark icon
  // so the clinician can tell at a glance what's their list vs the
  // AI's queue.
  const isAi = !isUserItem;
  const Icon = isEmail ? Mail : ClipboardList;
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60 group">
      <span
        className={cn(
          'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border',
          isEmail
            ? 'bg-sky-50 text-sky-700 border-sky-200'
            : isUserItem
              ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
              : 'bg-slate-100 text-slate-700 border-slate-200',
        )}
      >
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {item.title}
          </p>
          {isAi && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded flex-shrink-0"
              title="Scheduled by the AI planner"
            >
              <Sparkles size={8} />
              AI
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          <span className={date === todayKey ? 'text-primary font-bold' : ''}>
            {formatDateLabel(date, todayKey)}
          </span>
          <span className="mx-1.5 text-border">·</span>
          <span className="tabular-nums">{fmtMin(item.estMin)}</span>
          {isEmail && (
            <>
              <span className="mx-1.5 text-border">·</span>
              <span className="truncate">{item.category.toLowerCase()}</span>
            </>
          )}
        </p>
      </div>
      {isUserItem && typeof item.refId === 'string' && (
        <button
          type="button"
          onClick={() => deleteUserPlannedItem(item.refId as string)}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-700 mt-1.5 transition-opacity"
          aria-label="Remove"
          data-testid={`task-list-remove-${item.refId}`}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

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
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
