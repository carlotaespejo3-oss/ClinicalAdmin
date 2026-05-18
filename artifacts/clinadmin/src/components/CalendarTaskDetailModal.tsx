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
  Pencil,
  Calendar,
  Clock,
  Hash,
  StickyNote,
  User,
  Sparkles,
  Hand,
  Mail,
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

// Shared detail / edit popup for any plan item — calendar tab AND
// the dashboard (Today's Plan, My Tasks, Week Ahead) both use this
// single modal so the experience is identical across surfaces.
//
// Modes:
//   - `initialMode='details'` (default for dashboard) — opens in a
//     read-only summary view first; an Edit button swaps it into
//     the existing edit form.
//   - `initialMode='edit'` (calendar tab) — opens straight in edit
//     mode, preserving the calendar's existing behaviour.
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
  initialMode?: 'details' | 'edit';
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

function formatDateLabel(iso: string): string {
  const tKey = todayKey();
  if (iso === tKey) return 'Today';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const [ty, tm, td] = tKey.split('-').map(Number);
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

export default function CalendarTaskDetailModal({
  item,
  scheduledDate,
  onClose,
  onNavigateToTasks,
  initialMode = 'edit',
}: Props) {
  const userItems = useUserPlannedItems();
  const { tasks: prompted } = usePromptedTasksState();
  const manualTasks = useManualTasksWithOverrides();
  const linkedDocTasks = useLinkedDocTasks();

  // Resolve the underlying source so we know what fields are editable
  // and what extra metadata (notes, risk) to surface in details mode.
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
      reason:
        typeof item.linkedToEmailId === 'number'
          ? 'This task came from an email — open it from the Inbox to update it.'
          : 'This task is managed from the Tasks tab.',
    };
  }, [item, userItems, prompted, manualTasks, linkedDocTasks, scheduledDate]);

  // Seed manual task lookup — surfaces notes/risk for readonly plan
  // rows whose refId points back to a hand-curated manual task.
  const seedManual = useMemo(() => {
    if (typeof item.refId !== 'string') return null;
    return manualTasks.find((t) => t.id === item.refId) ?? null;
  }, [item.refId, manualTasks]);

  const [mode, setMode] = useState<'details' | 'edit'>(initialMode);
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
  const editable = source.kind !== 'readonly';
  const showTitleField = source.kind !== 'unclear';
  const showDateField = source.kind !== 'unclear';
  const deleteLabel = source.kind === 'unclear' ? 'Dismiss for today' : 'Delete';

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

  // Cancel from edit returns to details if we opened in details mode,
  // otherwise closes (calendar tab keeps its single-stage behaviour).
  const handleCancel = () => {
    if (initialMode === 'details') {
      setMode('details');
      setError(null);
    } else {
      onClose();
    }
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

  // Source label shown above the title in the details panel.
  const sourceLabel =
    source.kind === 'userEvent'
      ? 'Calendar event'
      : source.kind === 'userTask'
        ? 'Manually added'
        : source.kind === 'prompted'
          ? 'AI · from email'
          : source.kind === 'linkedDoc'
            ? 'Linked document task'
            : source.kind === 'unclear'
              ? 'Unclear emails'
              : typeof item.linkedToEmailId === 'number'
                ? 'Linked to email'
                : seedManual
                  ? 'Scheduled task'
                  : 'External task';

  const heading =
    mode === 'details'
      ? source.kind === 'userEvent'
        ? 'Event details'
        : source.kind === 'unclear'
          ? 'Unclear emails reminder'
          : 'Task details'
      : source.kind === 'userEvent'
        ? 'Edit event'
        : source.kind === 'unclear'
          ? 'Unclear emails reminder'
          : source.kind === 'linkedDoc'
            ? 'Edit document task'
            : 'Edit task';

  // Details mode field values pulled from the resolved source. We
  // prefer the persisted store values (always up to date) and fall
  // back to the planner's PlanItem fields for readonly rows.
  const detailDateIso =
    source.kind === 'userTask' || source.kind === 'userEvent'
      ? source.item.date
      : source.kind === 'prompted'
        ? dateKeyFromDueDays(source.item.dueDays)
        : source.kind === 'manual' || source.kind === 'linkedDoc'
          ? dateKeyFromDueDays(source.item.deadline)
          : scheduledDate;
  const detailEstMin =
    source.kind === 'userEvent'
      ? source.item.durationMin
      : source.kind === 'userTask' ||
          source.kind === 'prompted' ||
          source.kind === 'manual' ||
          source.kind === 'linkedDoc'
        ? source.item.estMin
        : item.estMin;
  const detailType =
    source.kind === 'prompted'
      ? source.item.type
      : source.kind === 'userEvent'
        ? 'Event'
        : source.kind === 'linkedDoc'
          ? source.item.type
          : seedManual?.type ?? null;
  const detailPatient =
    source.kind === 'prompted' ? source.item.patientName : null;
  const detailNotes =
    source.kind === 'userEvent'
      ? source.item.notes
      : source.kind === 'prompted'
        ? source.item.notes
        : source.kind === 'manual' || source.kind === 'linkedDoc'
          ? source.item.noteAfterEmailDone ?? null
          : seedManual?.noteAfterEmailDone ?? null;
  const detailRisk =
    source.kind === 'manual' || source.kind === 'linkedDoc'
      ? source.item.risk
      : seedManual?.risk;
  const detailPriority =
    source.kind === 'prompted' ? source.item.priority : null;
  const detailStartTime =
    source.kind === 'userEvent' ? source.item.startTime : null;

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
          {/* ---- Details (read-only) view ---- */}
          {mode === 'details' && (
            <div className="space-y-3" data-testid="calendar-task-detail-details">
              <div>
                <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {source.kind === 'prompted' ? (
                    <Sparkles size={10} />
                  ) : source.kind === 'userEvent' || source.kind === 'userTask' ? (
                    <Hand size={10} />
                  ) : typeof item.linkedToEmailId === 'number' ? (
                    <Mail size={10} />
                  ) : null}
                  {sourceLabel}
                </p>
                <h3 className="text-base font-semibold text-foreground mt-1 leading-snug break-words">
                  {title || item.title}
                </h3>
              </div>

              <div className="rounded-md border border-border bg-muted/30 divide-y divide-border/60">
                <DetailRow icon={<Calendar size={13} />} label="Due">
                  {formatDateLabel(detailDateIso)}
                </DetailRow>
                {detailStartTime && (
                  <DetailRow icon={<Clock size={13} />} label="Start time">
                    {detailStartTime}
                  </DetailRow>
                )}
                <DetailRow icon={<Clock size={13} />} label={source.kind === 'userEvent' ? 'Duration' : 'Estimated time'}>
                  {detailEstMin} min
                </DetailRow>
                {detailType && (
                  <DetailRow icon={<Hash size={13} />} label="Type">
                    {detailType}
                  </DetailRow>
                )}
                {detailPriority && (
                  <DetailRow icon={<Hash size={13} />} label="Priority">
                    <span className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
                      detailPriority === 'high'
                        ? 'bg-red-100 text-red-700'
                        : detailPriority === 'medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700',
                    )}>
                      {detailPriority}
                    </span>
                  </DetailRow>
                )}
                {detailPatient && (
                  <DetailRow icon={<User size={13} />} label="Patient">
                    {detailPatient}
                  </DetailRow>
                )}
                {detailRisk && detailRisk !== 'none' && (
                  <DetailRow icon={<Hash size={13} />} label="Risk">
                    <span className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
                      detailRisk === 'high'
                        ? 'bg-red-100 text-red-700'
                        : detailRisk === 'medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700',
                    )}>
                      {detailRisk}
                    </span>
                  </DetailRow>
                )}
              </div>

              {detailNotes && detailNotes.trim() && (
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    <StickyNote size={11} /> Notes
                  </p>
                  <p className="text-sm text-foreground mt-1 whitespace-pre-wrap leading-relaxed bg-muted/40 border border-border rounded-md p-3">
                    {detailNotes}
                  </p>
                </div>
              )}

              {source.kind === 'unclear' && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs flex items-start gap-2">
                  <Info size={14} className="mt-0.5 flex-shrink-0 text-amber-700" />
                  <p className="leading-snug text-amber-900">
                    {item.title}. Edit to set how long you want to reserve for
                    this triage, or dismiss it for today if you've already
                    handled it.
                  </p>
                </div>
              )}

              {!editable && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs flex items-start gap-2">
                  <Info size={14} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="space-y-2 min-w-0">
                    <p className="text-muted-foreground">{(source as Extract<EditableSource, { kind: 'readonly' }>).reason}</p>
                    <button
                      type="button"
                      onClick={() => { onNavigateToTasks(); onClose(); }}
                      className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:underline"
                      data-testid="calendar-task-detail-open-tasks"
                    >
                      Open Tasks tab <ExternalLink size={11} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Edit (form) view ---- */}
          {mode === 'edit' && !editable && source.kind === 'readonly' && (
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

          {mode === 'edit' && source.kind === 'unclear' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs flex items-start gap-2">
              <Info size={14} className="mt-0.5 flex-shrink-0 text-amber-700" />
              <p className="leading-snug text-amber-900">
                {item.title}. Set how long you want to reserve for this triage,
                or dismiss it for today if you've already handled it.
              </p>
            </div>
          )}

          {mode === 'edit' && editable && (
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
              onClick={mode === 'edit' ? handleCancel : onClose}
              className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-border hover:bg-muted/50"
              data-testid="calendar-task-detail-cancel"
            >
              {mode === 'edit' && editable ? 'Cancel' : 'Close'}
            </button>
            {mode === 'details' && editable && (
              <button
                type="button"
                onClick={() => setMode('edit')}
                className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-primary text-primary-foreground hover:brightness-95"
                data-testid="calendar-task-detail-edit"
              >
                <Pencil size={12} /> Edit
              </button>
            )}
            {mode === 'edit' && editable && (
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

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-28 flex-shrink-0">
        {icon} {label}
      </span>
      <span className="text-foreground min-w-0 flex-1">{children}</span>
    </div>
  );
}
