import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Check, Calendar, X } from 'lucide-react';
import type { Email } from '@/lib/types';
import {
  detectPotentialTasks,
  type PotentialTask,
} from '@/lib/potentialTaskDetect';
import {
  addPromptedTask,
  dismissPrompt,
} from '@/lib/promptedTasksStore';
import { kindLabel } from '@/lib/potentialTaskLabels';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  email: Email;
  // The Tier-3 detection that triggered this modal. The modal uses
  // it to seed the AI suggestion strip + the default task kind.
  detection: PotentialTask;
  onClose: () => void;
}

type ActionKind = 'task' | 'event' | 'none';

// Modal that closes the loop on a Tier-3 (low-confidence) detection.
// Three questions, nothing more:
//
//   1. What kind of action is this?   Task / Event / Not an action
//   2. When does it need to happen?   date + optional time
//   3. Notes — optional
//
// The bottom row gives three terminal paths, all of which clear the
// row from the unresolved queue:
//
//   · Ignore email — actively marks this (email, kind) as reviewed
//                    and dismissed, so it stops surfacing. NOT the
//                    same as Cancel, which leaves it unresolved.
//   · Cancel       — close without recording anything; row stays.
//   · Save task    — disabled until a date is set (Not-an-action
//                    bypasses this — picking it enables Save).
//
// Three-bucket rule: the modal renders the email subject + a quoted
// phrase from the body for context, but stores NOTHING from the
// email body locally. Only the clinician's chosen title, date, and
// note get written to the prompted-tasks store.
//
// Phase 1 (tasks only): the Event button is offered but creates a
// task underneath — clock-time → calendar events is a later phase.
// The Event affordance is kept now so the clinician learns the
// vocabulary and the form layout stays stable when events ship.
export default function ClassifyTaskModal({
  open,
  email,
  detection,
  onClose,
}: Props) {
  const [actionKind, setActionKind] = useState<ActionKind>('task');
  const [dateStr, setDateStr] = useState<string>(''); // yyyy-mm-dd
  const [timeStr, setTimeStr] = useState<string>(''); // hh:mm (optional)
  const [notes, setNotes] = useState<string>('');

  // Reset every time the modal is opened for a fresh detection so a
  // previous session's choices don't leak in.
  useEffect(() => {
    if (!open) return;
    setActionKind('task');
    setDateStr('');
    setTimeStr('');
    setNotes('');
  }, [open, detection.kind, email.id]);

  // Pull a short quote from the body to remind the clinician what
  // they're looking at. Detection.evidence is the matched phrase
  // (e.g. "give me a call when you get a chance") — short, safe to
  // render. Falls back to the email preview if there's nothing.
  const quote = useMemo(() => {
    const ev = detection.evidence?.trim();
    if (ev && ev.length > 0) return ev;
    return email.preview ?? '';
  }, [detection.evidence, email.preview]);

  // "Looks like a callback request — no deadline given. Suggested
  // as a task." — surfaces the AI's own reasoning so the clinician
  // can agree or correct, and over time learns what the AI catches.
  const hint = useMemo(() => {
    const label = kindLabel(detection.kind);
    const dateBit =
      detection.dueDays === null ? 'no deadline given' : 'date is unclear';
    return `Looks like a ${label} — ${dateBit}. Suggested as a task.`;
  }, [detection.kind, detection.dueDays]);

  // Save button gate. "Not an action" bypasses the date requirement
  // because there's nothing to schedule — we're recording a
  // dismissal, not a task.
  const canSave = actionKind === 'none' ? true : dateStr.length > 0;

  if (!open) return null;

  // Convert the chosen date into a dueDays offset from today, since
  // promptedTasksStore stores relative offsets (not absolute dates).
  const toDueDays = (yyyyMmDd: string): number | null => {
    if (!yyyyMmDd) return null;
    const target = new Date(yyyyMmDd + 'T00:00:00');
    if (Number.isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ms = target.getTime() - today.getTime();
    return Math.max(0, Math.round(ms / 86_400_000));
  };

  const handleSave = () => {
    if (!canSave) return;
    if (actionKind === 'none') {
      // "Not an action" = reviewed-and-dismissed. No task created.
      dismissPrompt(email.id, detection.kind);
      onClose();
      return;
    }
    addPromptedTask({
      emailId: email.id,
      kind: detection.kind,
      title: detection.suggestedTitle,
      type: detection.type,
      estMin: detection.defaultMin,
      priority: 'medium',
      patientName: null,
      dueDays: toDueDays(dateStr),
      notes,
    });
    onClose();
  };

  const handleIgnore = () => {
    // Actively dismiss so it stops surfacing in the unresolved
    // queue. Different from Cancel which leaves the row in place.
    dismissPrompt(email.id, detection.kind);
    onClose();
  };

  const fromLabel = email.from.split('<')[0]?.trim() || email.from;
  const dateLabel = (email.date ?? '').toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="classify-modal-title"
      data-testid="classify-task-modal"
    >
      <div
        className="bg-white rounded-2xl shadow-xl border border-border w-full max-w-[640px] max-h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- Header: sender, date, subject, quoted phrase ---- */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-border">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              From {fromLabel} · {dateLabel}
            </p>
            <h2
              id="classify-modal-title"
              className="text-base font-semibold text-foreground mt-1"
            >
              {email.subject}
            </h2>
            {quote && (
              <p className="text-sm text-muted-foreground italic mt-1 line-clamp-2">
                &ldquo;{quote}&rdquo;
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-md border border-border hover:bg-slate-50 flex items-center justify-center text-muted-foreground"
            aria-label="Close"
            data-testid="classify-modal-close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* ---- AI reasoning strip ---- */}
          <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-[13px] text-blue-900">
            <Sparkles size={14} className="text-blue-700 mt-0.5 flex-shrink-0" />
            <p>{hint}</p>
          </div>

          {/* ---- Q1: type of action ---- */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">
              What kind of action is this?
            </p>
            <div className="grid grid-cols-3 gap-2">
              <ChoiceButton
                selected={actionKind === 'task'}
                onClick={() => setActionKind('task')}
                icon={<Check size={18} />}
                label="Task"
                testId="classify-choice-task"
              />
              <ChoiceButton
                selected={actionKind === 'event'}
                onClick={() => setActionKind('event')}
                icon={<Calendar size={18} />}
                label="Event"
                testId="classify-choice-event"
              />
              <ChoiceButton
                selected={actionKind === 'none'}
                onClick={() => setActionKind('none')}
                icon={<X size={18} />}
                label="Not an action"
                testId="classify-choice-none"
              />
            </div>
          </div>

          {/* ---- Q2: when ---- */}
          {actionKind !== 'none' && (
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">
                When does it need to happen?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  className="border border-border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                  data-testid="classify-date-input"
                  aria-label="Date"
                />
                <input
                  type="time"
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                  className="border border-border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                  data-testid="classify-time-input"
                  aria-label="Time (optional)"
                />
              </div>
            </div>
          )}

          {/* ---- Q3: notes ---- */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">
              Notes <span className="font-normal text-muted-foreground">— optional</span>
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. re: Theo's recent sessions"
              rows={3}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              data-testid="classify-notes-input"
            />
          </div>
        </div>

        {/* ---- Bottom row: Ignore / Cancel / Save ---- */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-slate-50/40">
          <button
            type="button"
            onClick={handleIgnore}
            className="px-3 py-2 text-sm font-semibold rounded-md border border-border bg-white text-foreground hover:bg-slate-100"
            data-testid="classify-ignore-btn"
          >
            Ignore email
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-semibold rounded-md border border-border bg-white text-foreground hover:bg-slate-100"
            data-testid="classify-cancel-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              'px-3 py-2 text-sm font-semibold rounded-md border transition-colors',
              canSave
                ? 'bg-primary border-primary text-primary-foreground hover:opacity-90'
                : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed',
            )}
            data-testid="classify-save-btn"
          >
            {actionKind === 'none' ? 'Mark reviewed' : 'Save task'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChoiceButton({
  selected,
  onClick,
  icon,
  label,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={selected}
      className={cn(
        'flex flex-col items-center justify-center gap-1 px-3 py-3 rounded-md border text-sm font-semibold transition-colors',
        selected
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-border bg-white text-foreground hover:bg-slate-50',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
