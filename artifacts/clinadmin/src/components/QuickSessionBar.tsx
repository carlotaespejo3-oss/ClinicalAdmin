// QuickSessionBar.tsx
//
// Countdown strip shown at the top of the Home tab while a quick session
// is active. Updates every second. Turns amber in the last 5 minutes.
// "End session" fires the parent's onEnd callback immediately.

import { useEffect, useState } from 'react';
import { Timer, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActiveSession } from '@/lib/quickSessionStore';

interface Props {
  session: ActiveSession;
  onEnd: () => void;
}

export default function QuickSessionBar({ session, onEnd }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const totalMs = session.durationMin * 60 * 1000;
  const elapsedMs = Math.max(0, now - session.startedAt);
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const progress = Math.min(1, elapsedMs / totalMs);

  const remainingSec = Math.ceil(remainingMs / 1000);
  const dispMin = Math.floor(remainingSec / 60);
  const dispSec = remainingSec % 60;

  const isWarning = remainingMs < 5 * 60 * 1000 && remainingMs > 0;
  const isDone = remainingMs === 0;

  // Auto-end when the timer naturally expires.
  useEffect(() => {
    if (isDone) onEnd();
  // onEnd is stable (useCallback in parent) — disable exhaustive-deps warning
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone]);

  const elapsedMin = Math.round(elapsedMs / 60000);
  const totalMin = session.durationMin;

  return (
    <div
      className={cn(
        'rounded-xl border px-5 py-3.5 flex items-center gap-4 transition-colors',
        isWarning
          ? 'border-amber-200 bg-amber-50'
          : 'border-sky-200 bg-sky-50',
      )}
      data-testid="quick-session-bar"
    >
      {/* Icon */}
      <div
        className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
          isWarning ? 'bg-amber-100' : 'bg-sky-100',
        )}
      >
        <Timer
          size={18}
          className={isWarning ? 'text-amber-600' : 'text-sky-600'}
        />
      </div>

      {/* Label + progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 mb-1.5">
          <span className="text-sm font-bold text-foreground">
            Quick session — {session.dayAbbr}
          </span>
          <span
            className={cn(
              'text-xs font-mono font-semibold tabular-nums',
              isWarning ? 'text-amber-700' : 'text-sky-700',
            )}
          >
            {String(dispMin).padStart(2, '0')}:{String(dispSec).padStart(2, '0')} remaining
          </span>
          <span className="text-xs text-muted-foreground ml-auto">
            {elapsedMin} / {totalMin} min
          </span>
        </div>
        {/* Progress track */}
        <div className="h-1.5 bg-white/80 rounded-full overflow-hidden border border-white/60">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-1000',
              isWarning ? 'bg-amber-400' : 'bg-sky-400',
            )}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* End button */}
      <button
        type="button"
        onClick={onEnd}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border bg-white px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 hover:border-foreground/30"
        data-testid="button-end-session"
      >
        <CheckCircle2 size={13} />
        End session
      </button>
    </div>
  );
}
