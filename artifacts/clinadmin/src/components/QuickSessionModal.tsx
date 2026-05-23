// QuickSessionModal.tsx
//
// Duration picker shown when a clinician chooses to start an
// unscheduled session on a day they normally don't work.
// Chips for common durations; custom text-input for anything else.

import { useState } from 'react';
import { Timer, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  dayAbbr: string;      // e.g. 'Tuesday'
  onStart: (durationMin: number) => void;
  onCancel: () => void;
}

const PRESET_DURATIONS = [
  { label: '15 min', value: 15 },
  { label: '20 min', value: 20 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1 hour', value: 60 },
  { label: '1.5 hours', value: 90 },
];

export default function QuickSessionModal({ dayAbbr, onStart, onCancel }: Props) {
  const [selected, setSelected] = useState<number>(30);
  const [custom, setCustom] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  const effectiveMins = useCustom
    ? Math.max(5, Math.min(480, Number(custom) || 0))
    : selected;

  const canStart = useCustom
    ? Number(custom) >= 5 && Number(custom) <= 480
    : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Start a quick session"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
              <Timer size={18} className="text-sky-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold">Start a quick session</h2>
              <p className="text-xs text-muted-foreground">
                {dayAbbr} isn't in your schedule — how long do you have?
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground p-1 rounded"
            aria-label="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        {/* Duration picker */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {PRESET_DURATIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => { setSelected(value); setUseCustom(false); }}
                className={cn(
                  'py-2.5 rounded-xl text-sm font-semibold border transition-colors',
                  !useCustom && selected === value
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                    : 'bg-muted/40 text-foreground border-border hover:border-sky-400 hover:bg-sky-50',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Custom duration */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUseCustom(true)}
              className={cn(
                'text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors',
                useCustom
                  ? 'border-sky-500 text-sky-700 bg-sky-50'
                  : 'border-border text-muted-foreground hover:border-sky-400 hover:bg-sky-50',
              )}
            >
              Custom
            </button>
            {useCustom && (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="number"
                  min={5}
                  max={480}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="e.g. 25"
                  className="w-20 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            You'll see a countdown timer. When it ends, ClinAdmin will summarise
            what you got done and give you the option to add {dayAbbr}s to your
            regular schedule.
          </p>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 text-sm font-semibold rounded-xl border border-border hover:bg-muted/40 transition-colors"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={!canStart || (useCustom && !custom)}
            onClick={() => canStart && onStart(effectiveMins)}
            className="flex-1 py-2.5 text-sm font-bold rounded-xl bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Start {effectiveMins > 0 ? `${effectiveMins}-min` : ''} session
          </button>
        </div>
      </div>
    </div>
  );
}
