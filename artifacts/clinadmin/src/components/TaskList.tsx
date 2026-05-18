import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Trash2, Sparkles, Phone } from 'lucide-react';
import type { DailyPlan, PlanItem } from '@/lib/planner';
import {
  useUserPlannedItems,
  deleteUserPlannedItem,
} from '@/lib/userPlannedItemsStore';
import { usePromptedTasksState } from '@/lib/promptedTasksStore';
import { cn } from '@/lib/utils';
import { fmtMin, dateKey, startOfDay } from '@/lib/calendarHelpers';
import AddPlannedItemDialog from './AddPlannedItemDialog';

interface Props {
  runway: DailyPlan[];
}

// A row in "My tasks" is something the clinician needs to do that
// REPLYING TO AN EMAIL ALONE WON'T CLEAR. Three sources qualify:
//
//   1. Linked document tasks — auto-paired with an email
//      ("Write NDIS report for J. Patel"). PlanItem kind='task',
//      arrives from linkedDocTasksStore via the planner.
//   2. Manual tasks the clinician added by hand — either from the
//      Tasks tab (manualTasksStore) or the "Add to your week"
//      dialog here (userPlannedItemsStore). Both reach us as
//      kind='task' items on the runway.
//   3. AI-extracted potential follow-ups the clinician accepted
//      from the inbox "Possible task" prompt — phone calls,
//      prescriptions, appointment bookings, deadlines. These live
//      in promptedTasksStore and DO NOT pass through the planner,
//      so we merge them in directly below.
//
// What's intentionally OUT: emails whose only action is "draft a
// reply and send". They're scheduled by the planner (kind='email')
// and visible in Today's Plan — listing them again here would mean
// every safeguarding/clinical email shows up as a task, which is
// noise, not work to track.
type Row =
  | { kind: 'plan'; date: string; item: PlanItem }
  | {
      kind: 'prompt';
      date: string;
      id: string;
      title: string;
      estMin: number;
      typeLabel: string;
      linkedEmailId: number;
    };

// Flat task list shown beside Today's Plan on Home. See the Row
// type above for the precise definition of "task" used here.
//
// Delete is offered only on items the clinician added by hand from
// the inline Add dialog. Linked-doc, manual, and AI-prompt rows
// are owned by their respective tabs (Tasks / Inbox) and edited
// there.
export default function TaskList({ runway }: Props) {
  const userPlanned = useUserPlannedItems();
  const { tasks: promptedTasks } = usePromptedTasksState();
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
    // 1 — planner-scheduled true tasks. Skip events (live on the
    // calendar) AND emails (a reply isn't a separate task — see
    // the Row type doc above). Unclear-gate prompts also drop out.
    for (const day of runway) {
      for (const item of day.items) {
        if (item.kind !== 'task') continue;
        out.push({ kind: 'plan', date: day.date, item });
      }
    }
    // 2 — AI-prompt follow-ups the clinician accepted. These bypass
    // the planner, so we add them by hand with a date computed from
    // dueDays (null → today, so the clinician sees them immediately
    // instead of having no date at all).
    for (const t of promptedTasks) {
      if (t.done) continue;
      const due = new Date(today);
      const offset = typeof t.dueDays === 'number' ? Math.max(0, t.dueDays) : 0;
      due.setDate(due.getDate() + offset);
      out.push({
        kind: 'prompt',
        date: dateKey(due),
        id: t.id,
        title: t.title,
        estMin: t.estMin,
        typeLabel: t.type,
        linkedEmailId: t.emailId,
      });
    }
    // Sort by date soonest first so the clinician sees what's
    // closest at the top regardless of source.
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [runway, promptedTasks, today]);

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
              Work beyond just replying — reports, calls, follow-ups.
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
          {rows.map((row, idx) => {
            const key =
              row.kind === 'plan'
                ? `plan-${row.date}-${row.item.refId}-${idx}`
                : `prompt-${row.id}`;
            const isUserItem =
              row.kind === 'plan' &&
              typeof row.item.refId === 'string' &&
              userIds.has(row.item.refId);
            return (
              <li key={key}>
                <TaskRow row={row} todayKey={todayKey} isUserItem={isUserItem} />
              </li>
            );
          })}
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
  // Unpack the two row variants into a flat shape the rest of the
  // render uses. Keeps the JSX a single template instead of two
  // near-identical copies.
  const title = row.kind === 'plan' ? row.item.title : row.title;
  const estMin = row.kind === 'plan' ? row.item.estMin : row.estMin;
  const subLabel =
    row.kind === 'plan' ? null : row.typeLabel.toLowerCase();
  // AI-derived = anything the clinician didn't add by hand. Covers
  // linked doc tasks, planner-scheduled work AND prompt follow-ups.
  const isAi = !isUserItem;
  const Icon = row.kind === 'prompt' ? Phone : ClipboardList;
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60 group">
      <span
        className={cn(
          'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border',
          isUserItem
            ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
            : row.kind === 'prompt'
              ? 'bg-violet-50 text-violet-700 border-violet-200'
              : 'bg-slate-100 text-slate-700 border-slate-200',
        )}
      >
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {title}
          </p>
          {isAi && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded flex-shrink-0"
              title={
                row.kind === 'prompt'
                  ? 'AI-detected follow-up — confirmed by you in the inbox'
                  : 'Scheduled by the AI planner'
              }
            >
              <Sparkles size={8} />
              AI
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          <span className={row.date === todayKey ? 'text-primary font-bold' : ''}>
            {formatDateLabel(row.date, todayKey)}
          </span>
          <span className="mx-1.5 text-border">·</span>
          <span className="tabular-nums">{fmtMin(estMin)}</span>
          {subLabel && (
            <>
              <span className="mx-1.5 text-border">·</span>
              <span className="truncate">{subLabel}</span>
            </>
          )}
        </p>
      </div>
      {isUserItem && row.kind === 'plan' && typeof row.item.refId === 'string' && (
        <button
          type="button"
          onClick={() => deleteUserPlannedItem(row.item.refId as string)}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-700 mt-1.5 transition-opacity"
          aria-label="Remove"
          data-testid={`task-list-remove-${row.item.refId}`}
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
