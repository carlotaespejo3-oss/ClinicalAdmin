import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectedReservation } from '@/lib/planner';

interface Props {
  reservation: ProjectedReservation;
  weeklyCapacityMin: number;
}

function fmtMin(min: number): string {
  if (min <= 0) return '0min';
  if (min < 60) return `${Math.round(min)}min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

const BANDS = [
  {
    key: 'high' as const,
    label: 'Urgent',
    detail: 'safeguarding · urgent clinical · legal',
    swatch: 'bg-red-500',
    pill: 'bg-red-50 text-red-700 border-red-200',
  },
  {
    key: 'medium' as const,
    label: 'Medium',
    detail: 'clinical · professional',
    swatch: 'bg-blue-500',
    pill: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    key: 'low' as const,
    label: 'Low',
    detail: 'admin · CPD',
    swatch: 'bg-slate-400',
    pill: 'bg-slate-50 text-slate-700 border-slate-200',
  },
];

export default function ProjectedWorkload({ reservation, weeklyCapacityMin }: Props) {
  const counts: Record<'high' | 'medium' | 'low', number> = {
    high: reservation.highCount,
    medium: reservation.mediumCount,
    low: reservation.lowCount,
  };
  const reserves: Record<'high' | 'medium' | 'low', number> = {
    high: reservation.highReserveMin,
    medium: reservation.mediumReserveMin,
    low: reservation.lowReserveMin,
  };

  const totalReserve = reservation.totalReserveMin;
  // Effective reservation can be capped by weekly capacity (planner does this
  // when capacity is tight). Show the user the truth: if there isn't room for
  // the full reservation, surface what was actually held back.
  const effectiveReserve =
    weeklyCapacityMin > 0 ? Math.min(totalReserve, weeklyCapacityMin) : 0;
  const capped = effectiveReserve < totalReserve;
  const pctOfCapacity =
    weeklyCapacityMin > 0 ? Math.round((effectiveReserve / weeklyCapacityMin) * 100) : 0;

  return (
    <section
      className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden"
      data-testid="projected-workload"
      aria-label="Projected weekly workload reservation"
    >
      <header className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} className="text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h3 className="text-base font-bold">Projected workload</h3>
              <span
                className="text-xs text-muted-foreground"
                data-testid="projected-workload-total"
              >
                <strong className="text-foreground tabular-nums">
                  {fmtMin(effectiveReserve)}
                </strong>{' '}
                held back this week
                {weeklyCapacityMin > 0 && (
                  <> · ~{pctOfCapacity}% of capacity</>
                )}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Based on history, you typically receive ~{reservation.highCount + reservation.mediumCount + reservation.lowCount} emails a week. We hold time aside so new arrivals don't push existing work past its deadline.
            </p>
            {capped && (
              <p
                className="text-xs text-amber-700 mt-1"
                data-testid="projected-workload-capped"
              >
                Your weekly capacity is below the full {fmtMin(totalReserve)} reserve — only {fmtMin(effectiveReserve)} could be set aside.
              </p>
            )}
          </div>
        </div>
      </header>

      <ul className="divide-y divide-border">
        {BANDS.map((band) => {
          const count = counts[band.key];
          const reserve = reserves[band.key];
          const perItem = count > 0 ? Math.round(reserve / count) : 0;
          return (
            <li
              key={band.key}
              className="flex items-center gap-3 px-5 py-2.5"
              data-testid={`projected-workload-row-${band.key}`}
            >
              <span
                className={cn('inline-block w-2 h-2 rounded-sm flex-shrink-0', band.swatch)}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-foreground">{band.label}</span>
                  <span
                    className={cn(
                      'inline-flex items-center text-[10px] font-bold border px-1.5 py-0.5 rounded-full tabular-nums',
                      band.pill,
                    )}
                  >
                    ~{count}/wk
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{band.detail}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-bold text-foreground tabular-nums">
                  {fmtMin(reserve)}
                </div>
                {count > 0 && (
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    ~{perItem}min each
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
