import { useState } from 'react';
import { Plane, Plus, Trash2, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  useLeaveBlocks,
  addLeaveBlock,
  removeLeaveBlock,
  nextWorkingDayAfter,
  LEAVE_TYPE_LABEL,
  type LeaveType,
  type LeaveBlock,
} from '@/lib/leaveBlocksStore';
import type { WeekSetup } from '@/pages/ClinAdmin';

// Calendar-side panel for managing clinician leave / time-off.
//
// v1 minimal — add, list, delete. Each entry zeros out admin time on
// the days it covers (the planner picks this up via the adapter).
// Half-days are supported via start/end time pickers; in v1 we keep
// the form date-only and treat each entry as full-day 09:00–17:00 on
// the covered range. Future revisions can add a "half day" toggle.
//
// Confirm-before-destructive rule (per the user preference in
// replit.md): delete fires only after a window.confirm.

const TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
  { value: 'annual', label: 'Annual leave' },
  { value: 'sick', label: 'Sick leave' },
  { value: 'conference', label: 'Conference' },
  { value: 'pd', label: 'Professional development' },
  { value: 'unpaid', label: 'Unpaid leave' },
];

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatRange(b: LeaveBlock): string {
  const s = new Date(b.startAt);
  const e = new Date(b.endAt);
  // endAt is exclusive, so subtract a minute to display the inclusive
  // last day in the human-readable range.
  const lastDay = new Date(e.getTime() - 60_000);
  const fmt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const fmtWithYear: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const sameDay = s.toDateString() === lastDay.toDateString();
  if (sameDay) {
    return s.toLocaleDateString('en-GB', fmtWithYear);
  }
  const sameYear = s.getFullYear() === lastDay.getFullYear();
  return `${s.toLocaleDateString('en-GB', fmt)} – ${lastDay.toLocaleDateString('en-GB', sameYear ? fmtWithYear : fmtWithYear)}`;
}

function isoFromLocalDate(dateStr: string, time: 'start' | 'end'): string {
  // Date input gives 'YYYY-MM-DD'. Treat as local 09:00 for start,
  // local 17:00 for end. endAt being exclusive is enforced by adding
  // a day when start==end so a 1-day leave covers the whole working
  // window cleanly.
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  const hh = time === 'start' ? 9 : 17;
  const local = new Date(y, m - 1, d, hh, 0, 0, 0);
  return local.toISOString();
}

// Format a 'YYYY-MM-DD' as "Mon 18 May". Used for the "Day back" line
// on each leave entry so the clinician can see at a glance when the
// backlog will land.
function formatDayBack(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

interface Props {
  weekSetup: WeekSetup | null;
}

export default function LeavePanel({ weekSetup }: Props) {
  const blocks = useLeaveBlocks();
  const workingWeekdays = new Set(weekSetup?.days ?? []);
  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState<string>(todayKey());
  const [endDate, setEndDate] = useState<string>(todayKey());
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setLeaveType('annual');
    setStartDate(todayKey());
    setEndDate(todayKey());
    setNotes('');
    setError(null);
  };

  const handleSave = () => {
    if (!startDate || !endDate) {
      setError('Please pick both a start and end date.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    const startAt = isoFromLocalDate(startDate, 'start');
    // endAt is exclusive — push to 17:00 on the chosen end day.
    const endAt = isoFromLocalDate(endDate, 'end');
    if (!startAt || !endAt) {
      setError('Could not read the dates. Please try again.');
      return;
    }
    addLeaveBlock({
      startAt,
      endAt,
      leaveType,
      notes: notes.trim() ? notes.trim() : null,
    });
    resetForm();
    setOpen(false);
  };

  const handleDelete = (b: LeaveBlock) => {
    const ok = window.confirm(
      `Remove ${LEAVE_TYPE_LABEL[b.leaveType].toLowerCase()} for ${formatRange(b)}? The week will be replanned.`,
    );
    if (ok) removeLeaveBlock(b.id);
  };

  return (
    <Card className="border-border/60" data-testid="leave-panel">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded bg-sky-100 text-sky-700 flex-shrink-0">
              <Plane size={14} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold">Leave &amp; time off</h3>
              <p className="text-[11px] text-muted-foreground">
                Tell the planner about holidays, sick days, or conferences so it can replan around them.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setOpen((v) => !v);
            }}
            className={cn(
              'inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider px-2.5 py-1.5 rounded border transition-colors',
              open
                ? 'bg-muted text-foreground border-border'
                : 'bg-primary text-primary-foreground border-primary hover:brightness-95',
            )}
            data-testid="leave-add-toggle"
          >
            {open ? <X size={12} /> : <Plus size={12} />}
            {open ? 'Cancel' : 'Add leave'}
          </button>
        </div>

        {open && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3" data-testid="leave-form">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                  data-testid="leave-start"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">To (inclusive)</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                  data-testid="leave-end"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Type</span>
              <select
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                data-testid="leave-type"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Notes (optional)</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. covering Dr Patel's clinic on return"
                maxLength={200}
                className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                data-testid="leave-notes"
              />
            </label>
            {error && (
              <p className="text-xs text-red-700 font-medium" role="alert">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { resetForm(); setOpen(false); }}
                className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-border hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-primary text-primary-foreground hover:brightness-95"
                data-testid="leave-save"
              >
                Save leave
              </button>
            </div>
          </div>
        )}

        {blocks.length === 0 && !open && (
          <p className="text-xs text-muted-foreground italic">No leave on file — your week is planned against your usual availability.</p>
        )}

        {blocks.length > 0 && (
          <ul className="space-y-1.5" data-testid="leave-list">
            {blocks.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded border border-border/60 bg-card px-3 py-2"
                data-testid={`leave-row-${b.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">
                    {LEAVE_TYPE_LABEL[b.leaveType]}
                    <span className="ml-2 text-xs text-muted-foreground font-normal">{formatRange(b)}</span>
                  </p>
                  {b.notes && (
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">{b.notes}</p>
                  )}
                  {(() => {
                    const back = nextWorkingDayAfter(b.endAt, workingWeekdays, blocks);
                    if (!back) return null;
                    return (
                      <p
                        className="text-[11px] text-amber-800 mt-0.5"
                        data-testid={`leave-day-back-${b.id}`}
                      >
                        Day back: {formatDayBack(back)}
                      </p>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(b)}
                  className="text-muted-foreground hover:text-red-700 p-1 rounded flex-shrink-0"
                  aria-label={`Remove ${LEAVE_TYPE_LABEL[b.leaveType]} on ${formatRange(b)}`}
                  data-testid={`leave-delete-${b.id}`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
