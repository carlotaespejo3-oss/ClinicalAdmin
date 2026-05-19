// Reusable editor for per-day admin time blocks.
// Renders 1–2 blocks per day, each with a 15-min-increment start-time
// dropdown and ±15 min duration stepper. Used in both WeeklySetupModal
// and AvailabilityPanel.

import { Plus, Minus, X, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdminTimeBlock } from '@/pages/ClinAdmin';

// Generate time options from 07:00 to 20:00 in 15-min steps.
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

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

function blockEnd(block: AdminTimeBlock): string {
  const [h, m] = block.start.split(':').map(Number);
  const endMins = h * 60 + m + block.durationMin;
  const eh = Math.floor(endMins / 60) % 24;
  const em = endMins % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

interface Props {
  day: string;
  blocks: AdminTimeBlock[];
  onChange: (day: string, blocks: AdminTimeBlock[]) => void;
  compact?: boolean;
}

export default function TimeBlockEditor({ day, blocks, onChange, compact = false }: Props) {
  const updateBlock = (idx: number, patch: Partial<AdminTimeBlock>) => {
    const next = blocks.map((b, i) => i === idx ? { ...b, ...patch } : b);
    onChange(day, next);
  };

  const addBlock = () => {
    if (blocks.length >= 2) return;
    // Default second block to 2h after the first block ends, or 13:00.
    const prev = blocks[0];
    let defaultStart = '13:00';
    if (prev) {
      const [h, m] = prev.start.split(':').map(Number);
      const afterEnd = h * 60 + m + prev.durationMin + 60;
      const clampedH = Math.min(Math.floor(afterEnd / 60), 18);
      const clampedM = Math.round((afterEnd % 60) / 15) * 15 % 60;
      defaultStart = `${String(clampedH).padStart(2, '0')}:${String(clampedM).padStart(2, '0')}`;
    }
    onChange(day, [...blocks, { start: defaultStart, durationMin: 60 }]);
  };

  const removeBlock = (idx: number) => {
    onChange(day, blocks.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      {blocks.map((block, idx) => (
        <div key={idx} className={cn("flex items-center gap-1.5", compact ? "flex-wrap" : "")}>
          {/* Block label */}
          <span className={cn("text-[10px] font-bold text-muted-foreground uppercase tracking-wide w-10 flex-shrink-0", compact && "w-auto mr-0.5")}>
            {blocks.length > 1 ? (idx === 0 ? 'AM' : 'PM') : ''}
          </span>

          {/* Start time */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Clock size={10} className="text-muted-foreground" />
            <select
              value={block.start}
              onChange={e => updateBlock(idx, { start: e.target.value })}
              className="text-xs font-semibold bg-white border border-border rounded-lg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
            >
              {TIME_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Arrow + end time */}
          <span className="text-[10px] text-muted-foreground flex-shrink-0">→ {blockEnd(block)}</span>

          {/* Duration stepper */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={() => updateBlock(idx, { durationMin: Math.max(15, block.durationMin - 15) })}
              className="w-5 h-5 rounded border border-border bg-white hover:bg-accent flex items-center justify-center transition-colors"
              aria-label="Decrease by 15 min"
            >
              <Minus size={9} />
            </button>
            <span className="text-[11px] font-bold text-foreground w-12 text-center">{fmtMins(block.durationMin)}</span>
            <button
              onClick={() => updateBlock(idx, { durationMin: Math.min(480, block.durationMin + 15) })}
              className="w-5 h-5 rounded border border-border bg-white hover:bg-accent flex items-center justify-center transition-colors"
              aria-label="Increase by 15 min"
            >
              <Plus size={9} />
            </button>
          </div>

          {/* Remove second block */}
          {idx > 0 && (
            <button
              onClick={() => removeBlock(idx)}
              className="w-5 h-5 rounded border border-border bg-white hover:bg-red-50 hover:border-red-300 flex items-center justify-center transition-colors flex-shrink-0"
              aria-label="Remove block"
            >
              <X size={9} className="text-red-500" />
            </button>
          )}
        </div>
      ))}

      {/* Add second block */}
      {blocks.length < 2 && (
        <button
          onClick={addBlock}
          className="flex items-center gap-1 text-[10px] font-bold text-primary hover:text-primary/80 transition-colors mt-0.5"
        >
          <Plus size={10} />
          Add second block
        </button>
      )}
    </div>
  );
}
