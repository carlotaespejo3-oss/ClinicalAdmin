import { useMemo } from 'react';
import { Sparkles, Undo2, Pencil } from 'lucide-react';
import type { Email } from '@/lib/types';
import {
  detectPotentialTasks,
  type DetectionTier,
} from '@/lib/potentialTaskDetect';
import {
  getPromptedTasksForEmail,
  removePromptedTask,
  usePromptedTasksState,
} from '@/lib/promptedTasksStore';
import { isAutoTaskSeen, useAutoCreatedIds } from '@/lib/autoTaskSeenStore';
import { cn } from '@/lib/utils';

interface Props {
  email: Email;
  // Called when the clinician taps "Edit" — wires through to the
  // inbox's existing PotentialTaskPanel form. Optional; when not
  // provided, only Undo is offered.
  onEdit?: (taskId: string) => void;
}

// Pretty-prints the auto-created task's deadline in plain words.
// Returns null when there's no deadline to mention.
function dueLabel(dueDays: number | null): string | null {
  if (dueDays === null) return null;
  if (dueDays <= 0) return 'today';
  if (dueDays === 1) return 'tomorrow';
  if (dueDays <= 6) {
    const d = new Date();
    d.setDate(d.getDate() + dueDays);
    return d.toLocaleDateString('en-GB', { weekday: 'long' });
  }
  return `in ${dueDays} days`;
}

// Quiet "undo" strip shown ON the email card / detail view for
// every prompted task the auto-creator has created for this email.
//
// Behaviour per spec:
//   - Tier 1 (silent) — slate strip, plain wording. "Auto-created:
//     'Call Mrs Foster' due Friday". No urgency, no colour shout.
//   - Tier 2 (amber)  — amber border + "date estimated" wording.
//     The clinician can see at a glance that the AI was unsure.
//   - No acknowledge required. The strip ages out naturally when
//     the clinician undoes, edits, or completes the task.
export default function AutoCreatedTasksStrip({ email, onEdit }: Props) {
  // Subscribe for reactivity even though we read the snapshot via
  // the helper below.
  usePromptedTasksState();
  const autoCreatedIds = useAutoCreatedIds();

  // Re-derive tier from the email content. Detection is deterministic
  // on (from, subject, body), so this matches what the auto-creator
  // saw at creation time — no persisted "tier" column needed.
  const detected = useMemo(
    () =>
      detectPotentialTasks({
        from: email.from,
        subject: email.subject,
        body: email.body,
      }),
    [email.from, email.subject, email.body],
  );

  const tierByKind = useMemo(() => {
    const m = new Map<string, DetectionTier>();
    for (const p of detected) m.set(p.kind, p.tier);
    return m;
  }, [detected]);

  const tasks = useMemo(() => {
    return getPromptedTasksForEmail(email.id).filter((t) => {
      if (t.done) return false;
      // Provenance gate: only rows the auto-creator stamped get an
      // undo strip. Manually-accepted Tier 1/2 prompted tasks
      // (from the inbox PotentialTaskPanel) still show in My tasks
      // but never claim to be "auto-created".
      if (!autoCreatedIds.has(t.id)) return false;
      // Defensive: the tier should always be 1 or 2 here (the
      // creator never stamps Tier 3), but re-check in case the
      // email content changed since creation.
      const tier = tierByKind.get(t.kind);
      return tier === 1 || tier === 2;
    });
  }, [email.id, tierByKind, autoCreatedIds]);

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="auto-created-tasks-strip">
      {tasks.map((t) => {
        const tier = tierByKind.get(t.kind) ?? 2;
        const due = dueLabel(t.dueDays);
        const isAmber = tier === 2;
        const seen = isAutoTaskSeen(t.id);
        return (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]',
              isAmber
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-slate-200 bg-slate-50 text-slate-700',
            )}
          >
            <Sparkles
              size={12}
              className={cn(
                'flex-shrink-0',
                isAmber ? 'text-amber-700' : 'text-slate-500',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <span className="font-semibold">Added to My tasks:</span>{' '}
                <span className="truncate">&lsquo;{t.title}&rsquo;</span>
                {due && (
                  <>
                    {' '}
                    <span className={isAmber ? 'italic' : ''}>
                      {isAmber ? 'date estimated as ' : 'due '}
                      {due}
                    </span>
                  </>
                )}
                {!seen && (
                  <span
                    className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-blue-500 align-middle"
                    title="New — not yet opened"
                  />
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => removePromptedTask(t.id)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors',
                  isAmber
                    ? 'border-amber-300 hover:bg-amber-100'
                    : 'border-slate-300 hover:bg-slate-100',
                )}
                data-testid={`auto-task-undo-${t.id}`}
                aria-label="Undo — remove this auto-created task"
              >
                <Undo2 size={11} /> Undo
              </button>
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(t.id)}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors',
                    isAmber
                      ? 'border-amber-300 hover:bg-amber-100'
                      : 'border-slate-300 hover:bg-slate-100',
                  )}
                  data-testid={`auto-task-edit-${t.id}`}
                >
                  <Pencil size={11} /> Edit
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
