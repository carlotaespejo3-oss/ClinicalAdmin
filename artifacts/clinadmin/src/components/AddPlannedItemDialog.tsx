import { useEffect, useRef, useState } from 'react';
import { X, ClipboardList, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  addUserPlannedTask,
  addUserPlannedEvent,
} from '@/lib/userPlannedItemsStore';

interface Props {
  open: boolean;
  defaultDate: string; // YYYY-MM-DD
  onClose: () => void;
}

type Mode = 'task' | 'event';

// Lightweight modal for adding a task or a fixed event to the week
// ahead. No backend yet — values are pushed straight into the
// in-memory store, which the planner subscribes to.
export default function AddPlannedItemDialog({ open, defaultDate, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('task');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [estMin, setEstMin] = useState('30');
  const [startTime, setStartTime] = useState('');
  const [notes, setNotes] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // Reset every time the dialog re-opens so a previous draft doesn't
  // bleed into a fresh add.
  useEffect(() => {
    if (!open) return;
    setMode('task');
    setTitle('');
    setDate(defaultDate);
    setEstMin('30');
    setStartTime('');
    setNotes('');
    // Focus title shortly after mount so keyboard users land in the
    // right place.
    const t = setTimeout(() => titleRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, defaultDate]);

  // Esc closes — matches the rest of the app's modal conventions.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmedTitle = title.trim();
  const mins = Math.max(5, Math.min(480, Number(estMin) || 0));
  const canSubmit = trimmedTitle.length > 0 && date.length === 10 && mins > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (mode === 'task') {
      addUserPlannedTask({ title: trimmedTitle, date, estMin: mins });
    } else {
      addUserPlannedEvent({
        title: trimmedTitle,
        date,
        startTime: startTime || null,
        durationMin: mins,
        notes: notes || null,
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-planned-item-title"
      onClick={onClose}
      data-testid="add-planned-item-backdrop"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 id="add-planned-item-title" className="text-base font-bold">
              Add to your week
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tasks get planned around your admin time. Events stay put.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground"
            aria-label="Close"
            data-testid="add-planned-item-close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Mode toggle */}
          <div
            className="inline-flex rounded-lg border border-border bg-slate-50 p-0.5 w-full"
            role="tablist"
            aria-label="What are you adding?"
          >
            {(['task', 'event'] as const).map((m) => {
              const Icon = m === 'task' ? ClipboardList : CalendarClock;
              const label = m === 'task' ? 'Task' : 'Event';
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md transition-colors',
                    mode === m
                      ? 'bg-white text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  data-testid={`add-planned-item-mode-${m}`}
                >
                  <Icon size={13} />
                  {label}
                </button>
              );
            })}
          </div>

          <Field label={mode === 'task' ? 'What needs doing?' : 'What is it?'}>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                mode === 'task'
                  ? 'e.g. NDIS report for J. Patel'
                  : 'e.g. MDT meeting'
              }
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
              data-testid="add-planned-item-title-input"
              maxLength={120}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={mode === 'task' ? 'Do it by' : 'Date'}>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                data-testid="add-planned-item-date-input"
              />
            </Field>
            <Field label={mode === 'task' ? 'Estimate (min)' : 'Duration (min)'}>
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={estMin}
                onChange={(e) => setEstMin(e.target.value)}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 tabular-nums"
                data-testid="add-planned-item-mins-input"
              />
            </Field>
          </div>

          {mode === 'event' && (
            <>
              <Field label="Start time (optional)">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  data-testid="add-planned-item-time-input"
                />
              </Field>
              <Field label="Notes (optional)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  data-testid="add-planned-item-notes-input"
                  maxLength={240}
                />
              </Field>
            </>
          )}

          <p className="text-[11px] text-muted-foreground">
            {mode === 'task'
              ? 'Tasks compete for your admin time and may be scheduled earlier than this date if your week is full.'
              : 'Events are fixed in your diary. Their time is removed from that day before the planner schedules anything else.'}
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-bold px-3 py-2 rounded-md border border-border hover:bg-accent"
              data-testid="add-planned-item-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                'text-xs font-bold px-3 py-2 rounded-md text-white',
                canSubmit
                  ? 'bg-primary hover:brightness-110'
                  : 'bg-slate-300 cursor-not-allowed',
              )}
              data-testid="add-planned-item-submit"
            >
              Add {mode === 'task' ? 'task' : 'event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
