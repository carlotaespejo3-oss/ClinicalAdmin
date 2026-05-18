import { Fragment, useMemo, useState } from 'react';
import { ClipboardList, Plus, Trash2, Sparkles, Phone, HelpCircle, Mail, Hand } from 'lucide-react';
import type { DailyPlan, PlanItem } from '@/lib/planner';
import {
  useUserPlannedItems,
  deleteUserPlannedItem,
} from '@/lib/userPlannedItemsStore';
import {
  usePromptedTasksState,
  isPromptDismissed,
  hasPromptedTaskForKind,
} from '@/lib/promptedTasksStore';
import { useAiClassifications } from '@/lib/aiClassifyStore';
import { emails as seedEmails } from '@/lib/data';
import { useManualTasksWithOverrides } from '@/lib/manualTaskOverridesStore';
import { detectPotentialTasks } from '@/lib/potentialTaskDetect';
import {
  useAutoTaskSeenSet,
  markAutoTaskSeen,
} from '@/lib/autoTaskSeenStore';
import { cn } from '@/lib/utils';
import { fmtMin, dateKey, startOfDay } from '@/lib/calendarHelpers';
import AddPlannedItemDialog from './AddPlannedItemDialog';
import EmailPreviewModal from './EmailPreviewModal';
import TaskDetailModal, { type TaskDetail } from './TaskDetailModal';

interface Props {
  runway: DailyPlan[];
  // Optional click-through that takes the clinician to the
  // originating email in the Inbox tab. Used by ghost rows and by
  // the "Open in Inbox" button inside the email preview modal.
  onOpenEmail?: (emailId: number) => void;
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
      notes: string;
      patientName: string | null;
    }
  // Tier-3 ghost row: the AI saw a possible task in an email but
  // couldn't commit (date or intent was low confidence). Surfaced
  // so the clinician knows there's something unresolved without
  // the AI guessing — they tap to handle it in the Inbox.
  | {
      kind: 'ghost';
      date: string;
      id: string;
      title: string;
      emailId: number;
      typeLabel: string;
    };

// Flat task list shown beside Today's Plan on Home. See the Row
// type above for the precise definition of "task" used here.
//
// Delete is offered only on items the clinician added by hand from
// the inline Add dialog. Linked-doc, manual, and AI-prompt rows
// are owned by their respective tabs (Tasks / Inbox) and edited
// there.
export default function TaskList({ runway, onOpenEmail }: Props) {
  const userPlanned = useUserPlannedItems();
  const { tasks: promptedTasks } = usePromptedTasksState();
  const classifications = useAiClassifications();
  const seenSet = useAutoTaskSeenSet();
  const manualTasks = useManualTasksWithOverrides();
  const [addOpen, setAddOpen] = useState(false);
  const [previewEmailId, setPreviewEmailId] = useState<number | null>(null);
  const [detailTask, setDetailTask] = useState<TaskDetail | null>(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = useMemo(() => dateKey(today), [today]);

  // Set of user-added refIds — used to decide which rows get a
  // delete affordance. Tasks become PlannerTasks with `refId = it.id`
  // in usePlannerOutput, so they appear with kind='task' here.
  const userIds = useMemo(
    () => new Set(userPlanned.map((u) => u.id)),
    [userPlanned],
  );

  // Quick lookup for the seed manual-task source row so the detail
  // modal can show notes / type / risk for plan rows whose refId
  // points back to a manual task.
  const manualTasksById = useMemo(() => {
    const m = new Map<string, (typeof manualTasks)[number]>();
    for (const t of manualTasks) m.set(t.id, t);
    return m;
  }, [manualTasks]);

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
    // 2 — AI-prompt follow-ups the clinician accepted OR the
    // auto-creator added (Tier 1/2). These bypass the planner, so
    // we add them by hand with a date computed from dueDays (null
    // → today, so the clinician sees them immediately).
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
        notes: t.notes ?? '',
        patientName: t.patientName,
      });
    }
    // 3 — Tier-3 ghost rows. For every classified email, run the
    // detector; surface any Tier-3 detection the clinician hasn't
    // already accepted or dismissed via the inbox panel. These
    // never auto-create — the row's whole purpose is to flag "you
    // need to decide what to do with this".
    for (const email of seedEmails) {
      const cls = classifications.get(email.id);
      if (!cls) continue;
      // Mirror the skip rules of PotentialTaskPanel/auto-creator —
      // categories that have their own task pipeline shouldn't
      // also produce ghost rows.
      if (cls.category === 'NONE' || cls.category === 'CPD' ||
          cls.category === 'LEGAL' || cls.category === 'UNCLEAR') continue;
      if (cls.documentDirection !== null && !cls.prescriptionRequest) continue;
      const detected = detectPotentialTasks({
        from: email.from,
        subject: email.subject,
        body: email.body,
      });
      for (const p of detected) {
        if (p.tier !== 3) continue;
        if (isPromptDismissed(email.id, p.kind)) continue;
        if (hasPromptedTaskForKind(email.id, p.kind)) continue;
        out.push({
          kind: 'ghost',
          date: todayKey,
          id: `ghost_${email.id}_${p.kind}`,
          title: p.suggestedTitle,
          emailId: email.id,
          typeLabel: p.type,
        });
      }
    }
    // Sort by date soonest first so the clinician sees what's
    // closest at the top regardless of source. Ghosts use today's
    // date so they cluster at the top — they want attention.
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [runway, promptedTasks, today, classifications, todayKey]);

  // Group rows by date so we can render a "Today" / "Tomorrow" /
  // "Wed 20 May" header above each group. Sort already happened
  // above so consecutive same-date rows are adjacent.
  const groups = useMemo(() => {
    const out: { date: string; rows: Row[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.date === r.date) last.rows.push(r);
      else out.push({ date: r.date, rows: [r] });
    }
    return out;
  }, [rows]);

  // ---- Click handlers shared with TaskRow ----------------------
  // Decides which modal to open for a given row. Rules:
  //   · prompt rows → email modal (linkedEmailId).
  //   · plan rows whose item links back to an email (linked-doc
  //     task) → email modal.
  //   · plan rows for user-added or seed manual tasks → task
  //     detail modal.
  //   · ghost rows → leave inline behaviour (jumps to Inbox).
  const handleRowClick = (row: Row) => {
    if (row.kind === 'ghost') {
      if (onOpenEmail) onOpenEmail(row.emailId);
      return;
    }
    if (row.kind === 'prompt') {
      if (!seenSet.has(row.id)) markAutoTaskSeen(row.id);
      setPreviewEmailId(row.linkedEmailId);
      return;
    }
    // ---- row.kind === 'plan' ----
    const item = row.item;
    if (typeof item.linkedToEmailId === 'number') {
      setPreviewEmailId(item.linkedToEmailId);
      return;
    }
    // Try to resolve to a seed manual task for richer details.
    const refId = typeof item.refId === 'string' ? item.refId : null;
    const seed = refId ? manualTasksById.get(refId) : undefined;
    const isUser = refId !== null && userIds.has(refId);
    setDetailTask({
      title: item.title,
      sourceLabel: isUser ? 'Manually added' : 'Scheduled task',
      dueLabel: formatDateLabel(row.date, todayKey),
      estMin: item.estMin,
      typeLabel: seed?.type ?? null,
      risk: seed?.risk,
      patientName: null,
      notes: seed?.noteAfterEmailDone ?? null,
    });
  };

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
          {groups.map((group) => (
            <Fragment key={group.date}>
              {/* ---- Day group separator ---- */}
              <li
                className={cn(
                  'sticky top-0 z-10 px-5 py-1.5 text-[10px] font-bold uppercase tracking-widest',
                  'bg-slate-50/95 backdrop-blur-sm border-b border-border text-slate-600',
                  group.date === todayKey && 'text-primary',
                )}
                data-testid={`task-list-day-header-${group.date}`}
              >
                {formatDateLabel(group.date, todayKey)}
              </li>
              {group.rows.map((row, idx) => {
                const key =
                  row.kind === 'plan'
                    ? `plan-${row.date}-${row.item.refId}-${idx}`
                    : `${row.kind}-${row.id}`;
                const refId =
                  row.kind === 'plan' && typeof row.item.refId === 'string'
                    ? row.item.refId
                    : null;
                const isUserItem = refId !== null && userIds.has(refId);
                // Unseen dot only applies to auto/prompted rows; planner
                // rows already have their own visibility (Today's Plan).
                const isUnseen = row.kind === 'prompt' && !seenSet.has(row.id);
                return (
                  <li key={key}>
                    <TaskRow
                      row={row}
                      todayKey={todayKey}
                      isUserItem={isUserItem}
                      isUnseen={isUnseen}
                      onClick={() => handleRowClick(row)}
                    />
                  </li>
                );
              })}
            </Fragment>
          ))}
        </ul>
      )}

      <AddPlannedItemDialog
        open={addOpen}
        defaultDate={todayKey}
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

function TaskRow({
  row,
  todayKey,
  isUserItem,
  isUnseen,
  onClick,
}: {
  row: Row;
  todayKey: string;
  isUserItem: boolean;
  isUnseen: boolean;
  onClick: () => void;
}) {
  // Unpack the row variants into a flat shape the rest of the
  // render uses. Keeps the JSX a single template instead of three
  // near-identical copies.
  const title =
    row.kind === 'plan' ? row.item.title : row.title;
  const estMin = row.kind === 'plan' ? row.item.estMin : row.kind === 'prompt' ? row.estMin : null;
  // Linked-doc plan rows carry the originating email ID so we can
  // label them as "AI · from email" too.
  const isLinkedFromEmail =
    row.kind === 'plan' && typeof row.item.linkedToEmailId === 'number';
  const isGhost = row.kind === 'ghost';
  // Three "source" buckets the clinician should be able to tell
  // apart at a glance:
  //   · "AI · from email" — prompt rows + linked-doc plan rows
  //   · "Manually added"  — user-planned items + seed manual tasks
  //   · ghosts wear their own "Unresolved" pill, no source tag
  const source: 'ai_email' | 'manual' | null = isGhost
    ? null
    : row.kind === 'prompt' || isLinkedFromEmail
      ? 'ai_email'
      : 'manual';

  const Icon =
    row.kind === 'prompt' ? Phone :
    row.kind === 'ghost' ? HelpCircle :
    isLinkedFromEmail ? Mail :
    ClipboardList;

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 group cursor-pointer transition-colors',
        isGhost ? 'hover:bg-amber-50/60' : 'hover:bg-slate-50/80',
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      data-testid={
        row.kind === 'ghost'
          ? `task-list-ghost-${row.emailId}`
          : row.kind === 'prompt'
            ? `task-list-prompt-${row.id}`
            : `task-list-plan-${row.item.refId ?? 'unknown'}`
      }
    >
      <span
        className={cn(
          'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border',
          isUserItem
            ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
            : isGhost
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : row.kind === 'prompt' || isLinkedFromEmail
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
          {isUnseen && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"
              title="New — not yet opened"
            />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
          {isGhost ? (
            <span>Tap to classify in Inbox</span>
          ) : (
            <>
              {/* ---- Source pill: tells the clinician at a glance
                     where the row came from. AI rows get the
                     violet sparkles, manual rows get a quiet
                     slate "Manually added". */}
              {source === 'ai_email' && (
                <span
                  className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded"
                  title="The AI added this from an email"
                >
                  <Sparkles size={8} /> AI · from email
                </span>
              )}
              {source === 'manual' && (
                <span
                  className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded"
                  title="You added this by hand"
                >
                  <Hand size={8} /> Manually added
                </span>
              )}
              {estMin !== null && (
                <>
                  <span className="text-border">·</span>
                  <span className="tabular-nums">{fmtMin(estMin)}</span>
                </>
              )}
            </>
          )}
          {isGhost && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-700 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded"
              title="The AI spotted something but isn't sure — tap to handle in Inbox"
            >
              Unresolved
            </span>
          )}
        </p>
      </div>
      {isUserItem && row.kind === 'plan' && typeof row.item.refId === 'string' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            deleteUserPlannedItem(row.item.refId as string);
          }}
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
  // Within the coming week, the day name on its own ("Wednesday")
  // is friendlier than "Wed 20 May". Past a week, fall back to a
  // dated label to avoid ambiguity.
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
