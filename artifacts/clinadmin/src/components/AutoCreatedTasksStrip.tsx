import { useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Undo2, Pencil } from 'lucide-react';
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
import { useAutoCreatedIds } from '@/lib/autoTaskSeenStore';
import { cn } from '@/lib/utils';

interface Props {
  email: Email;
  // Called when the clinician taps "Edit" — wires through to the
  // inbox's existing PotentialTaskPanel form. Optional; when not
  // provided, only Undo is offered.
  onEdit?: (taskId: string) => void;
}

// Pretty-prints a relative deadline in plain words ("today" /
// "tomorrow" / "Friday" / "in 12 days"). Returns null when there is
// no deadline to mention.
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

// Quiet "task created" strip shown ON the email card / detail view
// for every prompted task the auto-creator has produced for this
// email. Mirrors the screenshots the clinician approved:
//
//   Tier 1 (silent, both signals strong)
//     · green tick · "Task created — 'Submit NDIS report' · due Friday"
//     · light slate background, no urgency
//
//   Tier 2 (amber, one signal soft)
//     · amber warning triangle · "Task created — date estimated
//       'Complete sensory profile' · due Fri (estimated)"
//     · amber background — clinician sees the AI was unsure at a glance
//
// Both strips persist (no acknowledge) and offer Undo + Edit. They
// disappear naturally when the task is undone, edited, or marked done.
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
      // (from the inbox panel or Classify modal) still live in My
      // tasks but never claim to be "auto-created".
      if (!autoCreatedIds.has(t.id)) return false;
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
        return (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px]',
              isAmber
                ? 'border-amber-300 bg-amber-50/80 text-amber-900'
                : 'border-emerald-200 bg-emerald-50/60 text-slate-800',
            )}
          >
            {isAmber ? (
              <AlertTriangle
                size={16}
                className="text-amber-700 flex-shrink-0"
              />
            ) : (
              <CheckCircle2
                size={16}
                className="text-emerald-700 flex-shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <span className="font-semibold">Task created</span>
              {isAmber && (
                <>
                  {' — '}
                  <span className="font-semibold italic">date estimated</span>
                </>
              )}
              {' — '}
              <span className={cn('truncate', isAmber && 'italic')}>
                &ldquo;{t.title}&rdquo;
              </span>
              {due && (
                <span className={cn(isAmber && 'italic')}>
                  {' · due '}{due}{isAmber ? ' (estimated)' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => removePromptedTask(t.id)}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold border bg-white transition-colors',
                  isAmber
                    ? 'border-amber-300 text-amber-900 hover:bg-amber-100'
                    : 'border-slate-300 text-slate-800 hover:bg-slate-100',
                )}
                data-testid={`auto-task-undo-${t.id}`}
                aria-label="Undo — remove this auto-created task"
              >
                <Undo2 size={12} /> Undo
              </button>
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(t.id)}
                  className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold border bg-white transition-colors',
                    isAmber
                      ? 'border-amber-300 text-amber-900 hover:bg-amber-100'
                      : 'border-slate-300 text-slate-800 hover:bg-slate-100',
                  )}
                  data-testid={`auto-task-edit-${t.id}`}
                >
                  <Pencil size={12} /> Edit
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
