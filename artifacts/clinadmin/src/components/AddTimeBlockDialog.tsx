// Lightweight dialog that asks "at what time?" when the clinician taps a
// quick-add button (+30min / +1h) on the dashboard. Lets them set a start
// time before the block is committed to the weekly schedule.

import { useState } from 'react';
import { Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdminTimeBlock } from '@/pages/ClinAdmin';

// 15-min-increment options 07:00–20:00, consistent with TimeBlockEditor.
const TIME_OPTIONS: string[] = (() => {
  const opts: string[] = [];
  for (let h = 7; h <= 20; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 20 && m > 0) break;
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return opts;
})();

const QUICK_TIMES: { label: string; value: string }[] = [
  { label: 'Morning', value: '08:00' },
  { label: 'Mid-morning', value: '10:00' },
  { label: 'Lunchtime', value: '12:30' },
  { label: 'Afternoon', value: '14:00' },
  { label: 'Late afternoon', value: '16:00' },
];

function blockEnd(start: string, durationMin: number): string {
  const [h, m] = start.split(':').map(Number);
  const endMins = h * 60 + m + durationMin;
  const eh = Math.floor(endMins / 60) % 24;
  const em = endMins % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

function fmtDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export interface AddTimeBlockDialogProps {
  day: string;
  durationMin: number;
  existingBlocks: AdminTimeBlock[];
  onConfirm: (block: AdminTimeBlock) => void;
  onCancel: () => void;
}

export default function AddTimeBlockDialog({
  day,
  durationMin,
  existingBlocks,
  onConfirm,
  onCancel,
}: AddTimeBlockDialogProps) {
  const [start, setStart] = useState('09:00');
  const atCapacity = existingBlocks.length >= 2;

  const handleConfirm = () => {
    onConfirm({ start, durationMin });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${fmtDuration(durationMin)} to ${day}`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Clock size={16} className="text-primary" />
            <div>
              <p className="text-sm font-bold text-foreground">
                Add {fmtDuration(durationMin)} to {day}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">When would you like to schedule this?</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        {atCapacity ? (
          <div className="px-5 py-6 space-y-3">
            <p className="text-sm text-foreground">
              <strong>{day}</strong> already has 2 admin blocks — the maximum allowed per day.
            </p>
            <p className="text-xs text-muted-foreground">
              To adjust the existing blocks, open <strong>This week's availability</strong> in the Calendar tab.
            </p>
            <button
              type="button"
              onClick={onCancel}
              className="w-full text-sm font-bold px-4 py-2.5 rounded-xl border border-border bg-white hover:bg-accent transition-colors"
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="px-5 py-5 space-y-5">
            {/* Quick picks */}
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Quick pick</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_TIMES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setStart(t.value)}
                    className={cn(
                      'text-xs font-bold px-3 py-1.5 rounded-full border transition-colors',
                      start === t.value
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-slate-700 border-border hover:border-primary/40',
                    )}
                  >
                    {t.label} · {t.value}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom time */}
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Or choose a time</p>
              <div className="flex items-center gap-2">
                <select
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="add-block-start-time"
                >
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  → {blockEnd(start, durationMin)}
                </span>
              </div>
            </div>

            {/* Existing blocks hint */}
            {existingBlocks.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {day} already has a block at {existingBlocks[0].start}. This will be added as a second block.
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 text-sm font-bold px-4 py-2.5 rounded-xl border border-border bg-white hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 text-sm font-bold px-4 py-2.5 rounded-xl bg-primary text-white hover:bg-primary/90 transition-colors"
                data-testid="add-block-confirm"
              >
                Add block
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
