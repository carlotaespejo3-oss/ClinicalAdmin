import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Trash2,
  Save,
  ExternalLink,
  Phone,
  ClipboardList,
  CalendarClock,
  Info,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanItem } from '@/lib/planner';
import {
  useUserPlannedItems,
  updateUserPlannedTask,
  updateUserPlannedEvent,
  deleteUserPlannedItem,
  type UserPlannedItem,
} from '@/lib/userPlannedItemsStore';
import {
  usePromptedTasksState,
  updatePromptedTask,
  removePromptedTask,
  type PromptedTask,
} from '@/lib/promptedTasksStore';
import {
  useManualTasksWithOverrides,
  setManualTaskFields,
  setManualTaskHidden,
  clearManualTaskOverride,
} from '@/lib/manualTaskOverridesStore';
import {
  useLinkedDocTasks,
  updateLinkedDocTask,
  dismissLinkedDocTask,
} from '@/lib/linkedDocTasksStore';
import {
  setUnclearGateEstMin,
  dismissUnclearGate,
} from '@/lib/unclearGateOverridesStore';
import type { ManualTask } from '@/lib/types';

// Detail / edit modal for an item the clinician clicked on the
// **calendar**. Different from `TaskDetailModal` (the read-only Home /
// Tasks popup) — this one mutates.
//
// Routing by item.refId namespace:
//   - 'upt_*' / 'upe_*' → userPlannedItems (full edit)
//   - 'pt_*'           → promptedTasks (edit via re-POST upsert)
//   - 'doc_*'          → linkedDocTasks (auto-generated document tasks)
//   - other string id  → seed ManualTask (m2..m5) edited via overrides
//   - kind='unclear_gate', refId=null → resize / dismiss the unclear gate
//   - none of the above → read-only with a pointer to the Tasks tab
//
// Phone-call rule: when the underlying promptedTask has
// kind='phone_call', the minutes field is locked at 30. The clamp
// also lives in the store (defence in depth), so even if a stray
// path bypassed the UI the rule would still hold.
//
// Date editing for date-based tasks uses a normal date picker; we
// convert picked-date → days-from-today on save (clamped non-negative).
// Calendar-day arithmetic, not 24h windows.
//
// Planner reflection: every mutation here writes to the store the
// planner subscribes to, so the runway recomputes on the next render.
// Manual title/estMin/deadline edits → manualTaskOverridesStore;
// linked-doc edits → linkedDocTasksStore; unclear-gate overrides →
// unclearGateOverridesStore. No prop drilling required.

type EditableSource =
  | { kind: 'userTask'; item: Extract<UserPlannedItem, { kind: 'task' }> }
  | { kind: 'userEvent'; item: Extract<UserPlannedItem, { kind: 'event' }> }
  | { kind: 'prompted'; item: PromptedTask }
  | { kind: 'manual'; item: ManualTask }
  | { kind: 'linkedDoc'; item: ManualTask & { linkedEmailId: number } }
  | { kind: 'unclear'; dateKey: string }
  | { kind: 'readonly'; title: string; reason: string };

interface Props {
  item: PlanItem;
  scheduledDate: string; // YYYY-MM-DD — the runway day this item was placed on
  onClose: () => void;
  onNavigateToTasks: () => void;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetweenLocal(fromYmd: string, toYmd: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  };
  return Math.round((parse(toYmd) - parse(fromYmd)) / 86_400_000);
}

function dateKeyFromDueDays(dueDays: number | null): string {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const offset = typeof dueDays === 'number' ? Math.max(0, dueDays) : 0;
  const d = new Date(base.getTime() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarTaskDetailModal({
  item,
  scheduledDate,
  onClose,
  onNavigateToTasks,
}: Props) {
  const userItems = useUserPlannedItems();
  const { tasks: prompted } = usePromptedTasksState();
  const manualTasks = useManualTasksWithOverrides();
  const linkedDocTasks = useLinkedDocTasks();

  const source: EditableSource = useMemo(() => {
    const refId = item.refId;
    if (typeof refId === 'string') {
      if (refId.startsWith('upt_')) {
        const u = userItems.find((x) => x.id === refId && x.kind === 'task');
        if (u && u.kind === 'task') return { kind: 'userTask', item: u };
      }
      if (refId.startsWith('upe_')) {
        const u = userItems.find((x) => x.id === refId && x.kind === 'event');
        if (u && u.kind === 'event') return { kind: 'userEvent', item: u };
      }
      if (refId.startsWith('pt_')) {
        const p = prompted.find((x) => x.id === refId);
        if (p) return { kind: 'prompted', item: p };
      }
      if (refId.startsWith('doc_')) {
        // linkedDocTasks is a Map<number, LinkedDocTask>; find by id string.
        for (const t of linkedDocTasks.values()) {
          if (t.id === refId) {
            return {
              kind: 'linkedDoc',
              item: t as ManualTask & { linkedEmailId: number },
            };
          }
        }
      }
      // Fall through: try seed manual task lookup (ids like 'm2'..'m5').
      const m = manualTasks.find((x) => x.id === refId);
      if (m) return { kind: 'manual', item: m };
    }
    if (item.kind === 'unclear_gate') {
      return { kind: 'unclear', dateKey: scheduledDate || todayKey() };
    }
    return {
      kind: 'readonly',
      title: item.title,
      reason: 'This task is managed from the Tasks tab.',
    };
  }, [item, userItems, prompted, manualTasks, linkedDocTasks, scheduledDate]);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState<string>(scheduledDate || todayKey());
  const [estMin, setEstMin] = useState<number>(item.estMin);
  const [startTime, setStartTime] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (source.kind === 'userTask') {
      setTitle(source.item.title);
      setDate(source.item.date);
      setEstMin(source.item.estMin);
    } else if (source.kind === 'userEvent') {
      setTitle(source.item.title);
      setDate(source.item.date);
      setEstMin(source.item.durationMin);
      setStartTime(source.item.startTime ?? '');
      setNotes(source.item.notes ?? '');
    } else if (source.kind === 'prompted') {
      setTitle(source.item.title);
      setDate(dateKeyFromDueDays(source.item.dueDays));
      setEstMin(source.item.kind === 'phone_call' ? 30 : source.item.estMin);
      setNotes(source.item.notes ?? '');
      setPriority(source.item.priority);
    } else if (source.kind === 'manual' || source.kind === 'linkedDoc') {
      setTitle(source.item.title);
      setDate(dateKeyFromDueDays(source.item.deadline));
      setEstMin(source.item.estMin);
    } else if (source.kind === 'unclear') {
      setTitle(item.title);
      setDate(source.dateKey);
      setEstMin(item.estMin);
    } else {
      setTitle(source.title);
    }
  }, [source, scheduledDate, item.title, item.estMin]);

  const phoneCallLocked =
    source.kind === 'prompted' && source.item.kind === 'phone_call';

  const handleSave = () => {
    setError(null);
    const titleTrim = title.trim();
    if (source.kind !== 'unclear' && !titleTrim) {
      setError('Give the task a short title before saving.');
      return;
    }
    if (source.kind !== 'unclear' && !date) {
      setError('Pick a date.');
      return;
    }
    if (source.kind === 'userTask') {
      updateUserPlannedTask(source.item.id, { title: titleTrim, date, estMin });
    } else if (source.kind === 'userEvent') {
      updateUserPlannedEvent(source.item.id, {
        title: titleTrim,
        date,
        startTime: startTime || null,
        durationMin: estMin,
        notes: notes || null,
      });
    } else if (source.kind === 'prompted') {
      const newDueDays = Math.max(0, daysBetweenLocal(todayKey(), date));
      updatePromptedTask(source.item.id, {
        title: titleTrim,
        estMin: phoneCallLocked ? 30 : estMin,
        dueDays: newDueDays,
        priority,
        notes,
      });
    } else if (source.kind === 'manual') {
      const newDeadline = Math.max(0, daysBetweenLocal(todayKey(), date));
      // source.item.title is the MERGED title (override-or-seed). If the
      // user didn't touch the field we send `undefined` (no change) — sending
      // null would clobber an existing override back to the seed, which
      // they didn't ask for. The dedicated "Reset to default" button is
      // the only path that clears overrides.
      const titleChanged = titleTrim !== source.item.title;
      setManualTaskFields(source.item.id, {
        ...(titleChanged && { titleOverride: titleTrim }),
        deadlineOverride: newDeadline,
        estMinOverride: estMin,
      });
    } else if (source.kind === 'linkedDoc') {
      const newDeadline = Math.max(0, daysBetweenLocal(todayKey(), date));
      updateLinkedDocTask(source.item.linkedEmailId, {
        title: titleTrim,
        deadline: newDeadline,
        estMin,
      });
    } else if (source.kind === 'unclear') {
      setUnclearGateEstMin(source.dateKey, estMin);
    }
    onClose();
  };

  const handleDelete = () => {
    if (source.kind === 'readonly') return;
    if (source.kind === 'unclear') {
      const ok = window.confirm(
        "Dismiss the unclear-emails reminder for today? It'll come back tomorrow if any emails still need classifying.",
      );
      if (!ok) return;
      dismissUnclearGate(source.dateKey);
      onClose();
      return;
    }
    let label = 'this task';
    if (
      source.kind === 'userTask' ||
      source.kind === 'prompted' ||
      source.kind === 'manual' ||
      source.kind === 'linkedDoc'
    ) {
      label = `"${title.trim() || item.title}"`;
    } else if (source.kind === 'userEvent') {
      label = `the event "${title.trim() || item.title}"`;
    }
    const ok = window.confirm(`Remove ${label}? The week will be replanned.`);
    if (!ok) return;
    if (source.kind === 'userTask' || source.kind === 'userEvent') {
      deleteUserPlannedItem(source.item.id);
    } else if (source.kind === 'prompted') {
      removePromptedTask(source.item.id);
    } else if (source.kind === 'manual') {
      setManualTaskHidden(source.item.id, true);
    } else if (source.kind === 'linkedDoc') {
      dismissLinkedDocTask(source.item.linkedEmailId);
    }
    onClose();
  };

  // For manual seeds: let the clinician revert all overrides
  // (title/deadline/estMin/done/hidden) back to the shipped seed in
  // one click. The seed array itself is never touched.
  const handleResetManual = () => {
    if (source.kind !== 'manual') return;
    const ok = window.confirm(
      'Reset this task to its default title, deadline, and time? Your edits will be lost.',
    );
    if (!ok) return;
    clearManualTaskOverride(source.item.id);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const Icon =
    item.kind === 'event'
      ? CalendarClock
      : phoneCallLocked
        ? Phone
        : ClipboardList;
  const heading =
    source.kind === 'userEvent'
      ? 'Edit event'
      : source.kind === 'readonly'
        ? 'Task details'
        : source.kind === 'unclear'
          ? 'Unclear emails reminder'
          : source.kind === 'linkedDoc'
            ? 'Edit document task'
            : source.kind === 'manual'
              ? 'Edit task'
              : 'Edit task';
  const editable = source.kind !== 'readonly';
  const showTitleField = source.kind !== 'unclear';
  const showDateField = source.kind !== 'unclear';
  const deleteLabel = source.kind === 'unclear' ? 'Dismiss for today' : 'Delete';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      data-testid="calendar-task-detail-modal"
    >
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded bg-muted text-foreground flex-shrink-0">
              <Icon size={14} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold leading-tight truncate">
                {heading}
              </h2>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                {item.category} · {item.reasonText}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded"
            aria-label="Close"
            data-testid="calendar-task-detail-close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {!editable && source.kind === 'readonly' && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs flex items-start gap-2">
              <Info
                size={14}
                className="mt-0.5 flex-shrink-0 text-muted-foreground"
              />
              <div className="space-y-2 min-w-0">
                <p className="font-semibold leading-snug">{source.title}</p>
                <p className="text-muted-foreground">{source.reason}</p>
                <button
                  type="button"
                  onClick={() => {
                    onNavigateToTasks();
                    onClose();
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:underline"
                >
                  Open Tasks tab <ExternalLink size={11} />
                </button>
              </div>
            </div>
          )}

          {source.kind === 'unclear' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs flex items-start gap-2">
              <Info size={14} className="mt-0.5 flex-shrink-0 text-amber-700" />
              <p className="leading-snug text-amber-900">
                {item.title}. Set how long you want to reserve for this triage,
                or dismiss it for today if you've already handled it.
              </p>
            </div>
          )}

          {editable && (
            <>
              {showTitleField && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Title
                  </span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                    data-testid="calendar-task-detail-title"
                  />
                </label>
              )}

              <div
                className={cn(
                  'grid gap-3',
                  showDateField ? 'grid-cols-2' : 'grid-cols-1',
                )}
              >
                {showDateField && (
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Date
                    </span>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                      data-testid="calendar-task-detail-date"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {source.kind === 'userEvent'
                      ? 'Duration (mins)'
                      : 'Time (mins)'}
                    {phoneCallLocked && (
                      <span className="ml-1 text-sky-700 normal-case font-normal">
                        · fixed
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={estMin}
                    disabled={phoneCallLocked}
                    onChange={(e) =>
                      setEstMin(Math.max(5, Number(e.target.value) || 5))
                    }
                    className={cn(
                      'mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background',
                      phoneCallLocked && 'opacity-60 cursor-not-allowed',
                    )}
                    data-testid="calendar-task-detail-mins"
                  />
                  {phoneCallLocked && (
                    <span className="text-[10px] text-muted-foreground">
                      Phone callbacks always book 30 mins.
                    </span>
                  )}
                </label>
              </div>

              {source.kind === 'userEvent' && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Start time (optional)
                  </span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                    data-testid="calendar-task-detail-start"
                  />
                </label>
              )}

              {source.kind === 'prompted' && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Priority
                  </span>
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as 'high' | 'medium' | 'low')
                    }
                    className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                    data-testid="calendar-task-detail-priority"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              )}

              {(source.kind === 'userEvent' || source.kind === 'prompted') && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {source.kind === 'userEvent'
                      ? 'Notes (optional)'
                      : 'Description / notes'}
                  </span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={500}
                    className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-y"
                    data-testid="calendar-task-detail-notes"
                  />
                </label>
              )}

              {source.kind === 'linkedDoc' && (
                <p className="text-[11px] text-muted-foreground italic">
                  Auto-generated from a linked email. Edits stay on this task
                  only — the original message in Outlook is left untouched.
                </p>
              )}

              {source.kind === 'manual' && (
                <button
                  type="button"
                  onClick={handleResetManual}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  data-testid="calendar-task-detail-reset-manual"
                >
                  <RotateCcw size={11} /> Reset to default
                </button>
              )}

              {error && (
                <p className="text-xs text-red-700 font-medium" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border bg-muted/30">
          {editable ? (
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider px-2.5 py-1.5 rounded text-red-700 hover:bg-red-50"
              data-testid="calendar-task-detail-delete"
            >
              <Trash2 size={12} /> {deleteLabel}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-border hover:bg-muted/50"
            >
              {editable ? 'Cancel' : 'Close'}
            </button>
            {editable && (
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-primary text-primary-foreground hover:brightness-95"
                data-testid="calendar-task-detail-save"
              >
                <Save size={12} /> Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
