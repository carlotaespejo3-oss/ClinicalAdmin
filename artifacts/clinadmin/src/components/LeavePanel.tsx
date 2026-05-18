import { useMemo, useState } from 'react';
import { Plane, Plus, Trash2, X, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  useLeaveBlocks,
  addLeaveBlock,
  removeLeaveBlock,
  nextWorkingDayAfter,
  itemsAtRiskBeforeLeave,
  LEAVE_TYPE_LABEL,
  type LeaveType,
  type LeaveBlock,
  type AtRiskInput,
} from '@/lib/leaveBlocksStore';
import {
  useAppSettingsCache,
  setAppSettingsInternal,
} from '@/lib/clinicianSettingsStore';
import { useManualTasksWithOverrides } from '@/lib/manualTaskOverridesStore';
import type { WeekSetup } from '@/pages/ClinAdmin';

// Calendar-side panel for managing clinician leave / time-off.
//
// Supports full-day, morning-only (09:00–13:00), afternoon-only
// (13:00–17:00) and custom start/end times for single-day entries.
// Multi-day entries are always full-day (the morning/afternoon split
// stops being meaningful across a week). The planner picks up
// partial-day overlaps via leaveMinutesForDay's proportional share.
//
// Before saving, the panel runs itemsAtRiskBeforeLeave against the
// clinician's open manual tasks and shows any deadlines that land
// inside the leave window — the clinician then confirms or cancels.
// Per the user preference in replit.md (confirm before destructive),
// delete also goes through window.confirm.

const TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
  { value: 'annual', label: 'Annual leave' },
  { value: 'sick', label: 'Sick leave' },
  { value: 'conference', label: 'Conference' },
  { value: 'pd', label: 'Professional development' },
  { value: 'unpaid', label: 'Unpaid leave' },
];

type DayPart = 'full' | 'morning' | 'afternoon' | 'custom';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatRange(b: LeaveBlock): string {
  const s = new Date(b.startAt);
  const e = new Date(b.endAt);
  const lastDay = new Date(e.getTime() - 60_000);
  const fmt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const fmtWithYear: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const sameDay = s.toDateString() === lastDay.toDateString();
  if (sameDay) {
    return s.toLocaleDateString('en-GB', fmtWithYear);
  }
  return `${s.toLocaleDateString('en-GB', fmt)} – ${lastDay.toLocaleDateString('en-GB', fmtWithYear)}`;
}

// Detect whether a saved block is a half-day so the list can show a
// "Morning"/"Afternoon" tag next to the date range.
function dayPartLabel(b: LeaveBlock): string | null {
  const s = new Date(b.startAt);
  const e = new Date(b.endAt);
  const sameDay = s.toDateString() === new Date(e.getTime() - 60_000).toDateString();
  if (!sameDay) return null;
  const sH = s.getHours();
  const eH = e.getHours();
  if (sH === 9 && eH === 13) return 'Morning';
  if (sH === 13 && eH === 17) return 'Afternoon';
  if (sH === 9 && eH === 17) return null; // full day — no tag needed
  return `${String(sH).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}–${String(eH).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`;
}

function isoFromLocalDateTime(dateStr: string, hh: number, mm: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  const local = new Date(y, m - 1, d, hh, mm, 0, 0);
  return local.toISOString();
}

// Parse a 'HH:MM' input value into [hh, mm]. Returns null on bad input.
function parseTime(s: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return [hh, mm];
}

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
  const manualTasks = useManualTasksWithOverrides();
  const appSettings = useAppSettingsCache();
  const workingWeekdays = new Set(weekSetup?.days ?? []);
  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState<string>(todayKey());
  const [endDate, setEndDate] = useState<string>(todayKey());
  const [dayPart, setDayPart] = useState<DayPart>('full');
  const [customStart, setCustomStart] = useState<string>('09:00');
  const [customEnd, setCustomEnd] = useState<string>('17:00');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  // Two-step save: first click runs the conflict check and (if any)
  // surfaces a confirm panel; second click on "Save anyway" commits.
  const [pendingConflicts, setPendingConflicts] = useState<{
    block: { startAt: string; endAt: string };
    conflicts: ReturnType<typeof itemsAtRiskBeforeLeave>;
  } | null>(null);

  const isMultiDay = Boolean(startDate && endDate && startDate !== endDate);
  // Half-day only makes sense on a single-day entry. When the
  // clinician picks a multi-day range we silently coerce back to
  // full-day so the saved block covers each calendar day fully.
  const effectiveDayPart: DayPart = isMultiDay ? 'full' : dayPart;

  const resetForm = () => {
    setLeaveType('annual');
    setStartDate(todayKey());
    setEndDate(todayKey());
    setDayPart('full');
    setCustomStart('09:00');
    setCustomEnd('17:00');
    setNotes('');
    setError(null);
    setPendingConflicts(null);
  };

  // Convert form state → (startAt, endAt). Returns null on bad input.
  const buildIsoRange = (): { startAt: string; endAt: string } | null => {
    if (!startDate || !endDate) return null;
    if (endDate < startDate) return null;
    let startHH = 9, startMM = 0, endHH = 17, endMM = 0;
    if (effectiveDayPart === 'morning') {
      startHH = 9; endHH = 13;
    } else if (effectiveDayPart === 'afternoon') {
      startHH = 13; endHH = 17;
    } else if (effectiveDayPart === 'custom') {
      const s = parseTime(customStart);
      const e = parseTime(customEnd);
      if (!s || !e) return null;
      if (s[0] * 60 + s[1] >= e[0] * 60 + e[1]) return null;
      [startHH, startMM] = s;
      [endHH, endMM] = e;
    }
    const startAt = isoFromLocalDateTime(startDate, startHH, startMM);
    const endAt = isoFromLocalDateTime(endDate, endHH, endMM);
    if (!startAt || !endAt) return null;
    return { startAt, endAt };
  };

  const commitBlock = (range: { startAt: string; endAt: string }) => {
    addLeaveBlock({
      startAt: range.startAt,
      endAt: range.endAt,
      leaveType,
      notes: notes.trim() ? notes.trim() : null,
    });
    resetForm();
    setOpen(false);
  };

  const handleSave = () => {
    setError(null);
    if (!startDate || !endDate) {
      setError('Please pick both a start and end date.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    if (effectiveDayPart === 'custom') {
      const s = parseTime(customStart);
      const e = parseTime(customEnd);
      if (!s || !e) {
        setError('Please enter valid start and end times (HH:MM).');
        return;
      }
      if (s[0] * 60 + s[1] >= e[0] * 60 + e[1]) {
        setError('End time must be after start time.');
        return;
      }
    }
    const range = buildIsoRange();
    if (!range) {
      setError('Could not read the dates. Please try again.');
      return;
    }
    // Conflict check — only against open manual tasks (they carry a
    // deadline in days-from-today). Sidebar tasks have no deadline.
    const candidateBlock: LeaveBlock = {
      id: '__pending',
      startAt: range.startAt,
      endAt: range.endAt,
      leaveType,
      notes: null,
    };
    const inputs: AtRiskInput[] = manualTasks
      .filter((t) => !t.done)
      .map((t) => ({
        id: t.id,
        title: t.title,
        deadlineDays: t.deadline,
      }));
    const conflicts = itemsAtRiskBeforeLeave(new Date(), [candidateBlock], inputs, 365);
    if (conflicts.length > 0) {
      setPendingConflicts({ block: range, conflicts });
      return;
    }
    commitBlock(range);
  };

  const handleConfirmAnyway = () => {
    if (!pendingConflicts) return;
    commitBlock(pendingConflicts.block);
  };

  const handleDelete = (b: LeaveBlock) => {
    const ok = window.confirm(
      `Remove ${LEAVE_TYPE_LABEL[b.leaveType].toLowerCase()} for ${formatRange(b)}? The week will be replanned.`,
    );
    if (ok) removeLeaveBlock(b.id);
  };

  const rampUpMinutes = appSettings.leavePlanner?.rampUpMinutes ?? 60;
  const rampUpOptions = useMemo(() => [0, 30, 60, 90, 120], []);

  const setRampUp = (mins: number) => {
    setAppSettingsInternal({
      ...appSettings,
      leavePlanner: { ...appSettings.leavePlanner, rampUpMinutes: mins },
    });
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

        {open && !pendingConflicts && (
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

            {/* Day-part picker — only meaningful for single-day entries.
                Multi-day spans coerce to full-day so each covered day
                is treated consistently. */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Time</span>
              <div className="mt-1 inline-flex rounded-md border border-border overflow-hidden text-xs" role="group" data-testid="leave-daypart">
                {(['full', 'morning', 'afternoon', 'custom'] as const).map((p) => {
                  const disabled = isMultiDay && p !== 'full';
                  const labels: Record<DayPart, string> = {
                    full: 'Full day',
                    morning: 'Morning',
                    afternoon: 'Afternoon',
                    custom: 'Custom',
                  };
                  const active = effectiveDayPart === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={disabled}
                      onClick={() => setDayPart(p)}
                      className={cn(
                        'px-2.5 py-1.5 border-r last:border-r-0 border-border transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-foreground hover:bg-accent',
                        disabled && 'opacity-40 cursor-not-allowed',
                      )}
                      data-testid={`leave-daypart-${p}`}
                    >
                      {labels[p]}
                    </button>
                  );
                })}
              </div>
              {isMultiDay && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Multi-day leave covers each day fully. Use single-day entries for half-days.
                </p>
              )}
              {effectiveDayPart === 'custom' && !isMultiDay && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Start</span>
                    <input
                      type="time"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                      data-testid="leave-custom-start"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">End</span>
                    <input
                      type="time"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                      data-testid="leave-custom-end"
                    />
                  </label>
                </div>
              )}
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

        {/* Conflict confirmation — two-step save. Lists every open
            manual task with a deadline that lands inside the proposed
            leave window so the clinician can decide consciously. */}
        {pendingConflicts && (
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3"
            data-testid="leave-conflict-confirm"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {pendingConflicts.conflicts.length}{' '}
                  {pendingConflicts.conflicts.length === 1 ? 'task is' : 'tasks are'} due during this leave.
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  You can save the leave anyway — they'll appear as breached on the planner so you can rearrange or defer them.
                </p>
              </div>
            </div>
            <ul className="text-xs space-y-1 text-amber-900" data-testid="leave-conflict-list">
              {pendingConflicts.conflicts.slice(0, 6).map((c) => (
                <li key={c.item.id} className="truncate">
                  <strong>{formatDayBack(c.deadlineKey)}</strong> — {c.item.title}
                </li>
              ))}
              {pendingConflicts.conflicts.length > 6 && (
                <li className="text-amber-700/80">+ {pendingConflicts.conflicts.length - 6} more</li>
              )}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingConflicts(null)}
                className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100"
                data-testid="leave-conflict-cancel"
              >
                Back to form
              </button>
              <button
                type="button"
                onClick={handleConfirmAnyway}
                className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-amber-700 text-white hover:bg-amber-800"
                data-testid="leave-conflict-confirm-save"
              >
                Save leave anyway
              </button>
            </div>
          </div>
        )}

        {blocks.length === 0 && !open && (
          <p className="text-xs text-muted-foreground italic">No leave on file — your week is planned against your usual availability.</p>
        )}

        {blocks.length > 0 && (
          <ul className="space-y-1.5" data-testid="leave-list">
            {blocks.map((b) => {
              const partLabel = dayPartLabel(b);
              const back = nextWorkingDayAfter(b.endAt, workingWeekdays, blocks);
              return (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded border border-border/60 bg-card px-3 py-2"
                  data-testid={`leave-row-${b.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight">
                      {LEAVE_TYPE_LABEL[b.leaveType]}
                      <span className="ml-2 text-xs text-muted-foreground font-normal">{formatRange(b)}</span>
                      {partLabel && (
                        <span
                          className="ml-2 text-[10px] font-bold uppercase tracking-wider text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded"
                          data-testid={`leave-daypart-tag-${b.id}`}
                        >
                          {partLabel}
                        </span>
                      )}
                    </p>
                    {b.notes && (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{b.notes}</p>
                    )}
                    {back && (
                      <p
                        className="text-[11px] text-amber-800 mt-0.5"
                        data-testid={`leave-day-back-${b.id}`}
                      >
                        Day back: {formatDayBack(back)}
                      </p>
                    )}
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
              );
            })}
          </ul>
        )}

        {/* Catch-up time on first day back — advisory setting.
            Holds the chosen minutes back from bookable time on the
            first working day after a fully-on-leave run. */}
        <div className="pt-2 mt-2 border-t border-border/60" data-testid="leave-rampup-control">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Catch-up time on first day back
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {rampUpOptions.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRampUp(m)}
                className={cn(
                  'text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors',
                  rampUpMinutes === m
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:bg-accent',
                )}
                data-testid={`leave-rampup-${m}`}
              >
                {m === 0 ? 'Off' : m < 60 ? `${m} min` : `${m / 60}h`}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {rampUpMinutes === 0
              ? 'No catch-up buffer reserved.'
              : `Holds ${rampUpMinutes < 60 ? `${rampUpMinutes} min` : `${rampUpMinutes / 60}h`} back from your first day back so triage isn't crammed into the day's first hour.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
