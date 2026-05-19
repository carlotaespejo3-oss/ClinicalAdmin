// Non-intrusive toast that appears when the clinician spent significantly
// longer on an email than the estimate predicted. Quick-pick minute buttons
// let them correct the record in one tap; Skip discards without recording.
// Shown only when the timer raises a pending sample (> 2× estMin elapsed).

import { useState } from 'react';
import { Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePendingSample, clearPendingSample, recordSample } from '@/lib/timeTrackingStore';

const QUICK_PICKS = [5, 10, 15, 20, 30, 45, 60];

export default function TimingPrompt() {
  const pending = usePendingSample();
  const [custom, setCustom] = useState('');

  if (!pending) return null;

  const suggested = Math.round(pending.activeMin);

  const confirm = (minutes: number) => {
    if (minutes > 0) recordSample(pending.category, minutes, pending.estMin);
    clearPendingSample();
    setCustom('');
  };

  const handleCustom = () => {
    const v = parseInt(custom, 10);
    if (v > 0) confirm(v);
  };

  return (
    <div
      role="dialog"
      aria-label="How long did that take?"
      className="fixed bottom-5 right-5 z-50 w-80 bg-white border border-border rounded-2xl shadow-xl p-4 space-y-3"
      data-testid="timing-prompt"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-primary">
          <Clock size={15} />
          <p className="text-sm font-bold text-foreground">How long did that take?</p>
        </div>
        <button
          type="button"
          onClick={() => { clearPendingSample(); setCustom(''); }}
          className="text-muted-foreground hover:text-foreground transition-colors -mt-0.5"
          aria-label="Skip"
          data-testid="timing-skip"
        >
          <X size={15} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground leading-snug">
        Estimate was <strong>{pending.estMin} min</strong> — active time was around{' '}
        <strong>{suggested} min</strong>. Tap the actual time to help the planner learn.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_PICKS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => confirm(m)}
            className={cn(
              'text-xs font-bold px-2.5 py-1 rounded-full border transition-colors',
              m === suggested
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-slate-700 border-border hover:border-primary/40',
            )}
            data-testid={`timing-pick-${m}`}
          >
            {m} min
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={240}
          placeholder="Other…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCustom()}
          className="flex-1 text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
          data-testid="timing-custom"
        />
        <button
          type="button"
          onClick={handleCustom}
          disabled={!custom || parseInt(custom, 10) <= 0}
          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-40"
          data-testid="timing-confirm"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => { clearPendingSample(); setCustom(''); }}
          className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          data-testid="timing-skip-btn"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
