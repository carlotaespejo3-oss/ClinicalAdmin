import { AlertTriangle, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DailyPlan, PlanItem } from '@/lib/planner';

interface Props {
  runway: DailyPlan[];
  onDayClick?: (day: DailyPlan) => void;
}

const CAT_BAR_COLOR: Record<string, string> = {
  SAFEGUARDING: 'bg-rose-500',
  URGENT_CLINICAL: 'bg-red-500',
  LEGAL: 'bg-purple-500',
  CLINICAL: 'bg-blue-500',
  PROFESSIONAL: 'bg-indigo-500',
  ADMIN: 'bg-slate-400',
  CPD: 'bg-emerald-500',
  NONE: 'bg-slate-300',
  UNCLEAR: 'bg-amber-400',
};

const STATUS_BORDER: Record<DailyPlan['status'], string> = {
  safe: 'border-l-green-400',
  tight: 'border-l-amber-400',
  breach: 'border-l-red-500',
  idle: 'border-l-slate-200',
};

const STATUS_LABEL: Record<DailyPlan['status'], string> = {
  safe: 'On track',
  tight: 'Tight',
  breach: 'Over capacity',
  idle: 'No admin time',
};

function fmtMin(min: number): string {
  if (min <= 0) return '0min';
  if (min < 60) return `${Math.round(min)}min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

function dayLegend(items: PlanItem[]): { category: string; min: number }[] {
  const totals = new Map<string, number>();
  for (const it of items) {
    if (it.kind === 'unclear_gate') continue;
    totals.set(it.category, (totals.get(it.category) ?? 0) + it.estMin);
  }
  return Array.from(totals.entries())
    .map(([category, min]) => ({ category, min }))
    .sort((a, b) => b.min - a.min);
}

function DayCard({
  day,
  isToday,
  onClick,
}: {
  day: DailyPlan;
  isToday: boolean;
  onClick?: () => void;
}) {
  const segments = dayLegend(day.items);
  const denom = Math.max(day.minutesAvailable, day.totalPlannedMin, 1);
  const filledPct = Math.min(100, (day.totalPlannedMin / denom) * 100);
  const dateNum = day.displayLabel.match(/\d+/)?.[0] ?? '';
  // Count "work blocks": linked-task rows are folded into their parent
  // email so a paired email+doc reads as one unit, not two.
  const itemCount = day.items.filter(
    (i) => i.kind !== 'unclear_gate' && i.reason !== 'linked_task',
  ).length;
  const hasFlags = day.flags.length > 0;
  const hasBuffer = day.bufferMin > 0 && day.minutesAvailable > 0;

  // Build an accessible single-line summary for assistive tech.
  const ariaLabel = [
    `${day.displayLabel}, ${STATUS_LABEL[day.status]}.`,
    day.minutesAvailable === 0
      ? 'No admin time scheduled.'
      : `${fmtMin(day.totalPlannedMin)} planned of ${fmtMin(day.minutesAvailable)} available${hasBuffer ? `, ${fmtMin(day.bufferMin)} spare` : ''}.`,
    itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}.` : '',
    day.flags.length > 0 ? `Flags: ${day.flags.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Render <div> when no click handler; <button> only when interactive.
  // Keeps the card out of the keyboard tab order when there's nothing to do.
  const interactive = !!onClick;
  const Tag: 'button' | 'div' = interactive ? 'button' : 'div';
  const interactiveProps = interactive
    ? ({
        type: 'button' as const,
        onClick,
        'aria-label': ariaLabel,
      } as const)
    : ({ role: 'group', 'aria-label': ariaLabel } as const);

  const body = (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {day.dayLabel}
        </span>
        <span
          className={cn(
            'text-sm font-bold',
            isToday ? 'text-primary' : 'text-foreground',
          )}
        >
          {dateNum}
        </span>
      </div>

      {/* Stacked capacity bar */}
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100"
        aria-hidden="true"
      >
        {day.minutesAvailable === 0 ? (
          <div className="h-full w-full bg-slate-100" />
        ) : (
          <div
            className="absolute inset-y-0 left-0 flex h-full"
            style={{ width: `${filledPct}%` }}
          >
            {segments.map((s) => {
              const segPct = (s.min / day.totalPlannedMin) * 100;
              return (
                <div
                  key={s.category}
                  className={cn('h-full', CAT_BAR_COLOR[s.category] ?? 'bg-slate-400')}
                  style={{ width: `${segPct}%` }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="tabular-nums">
          {day.minutesAvailable === 0
            ? '—'
            : `${fmtMin(day.totalPlannedMin)}/${fmtMin(day.minutesAvailable)}`}
        </span>
        <span className="flex items-center gap-1">
          {hasBuffer && (
            <span
              className="tabular-nums text-green-700/70"
              data-testid={`runway-day-${day.dayIndex}-buffer`}
              title={`${fmtMin(day.bufferMin)} spare`}
            >
              +{fmtMin(day.bufferMin)}
            </span>
          )}
          {hasFlags && (
            <AlertTriangle
              size={10}
              className="text-amber-500"
              aria-hidden="true"
              data-testid={`runway-day-${day.dayIndex}-flag`}
            />
          )}
          {itemCount > 0 && (
            <span className="tabular-nums font-semibold text-foreground/70">
              {itemCount}
            </span>
          )}
        </span>
      </div>
    </>
  );

  return (
    <Tag
      {...interactiveProps}
      data-testid={`runway-day-${day.dayIndex}`}
      className={cn(
        'flex flex-col items-stretch gap-1.5 rounded-lg border border-border border-l-4 bg-white p-2 text-left',
        STATUS_BORDER[day.status],
        isToday && 'ring-2 ring-primary/60',
        interactive &&
          'transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer',
      )}
    >
      {body}
    </Tag>
  );
}

export default function Runway14Day({ runway, onDayClick }: Props) {
  const week1 = runway.slice(0, 7);
  const week2 = runway.slice(7, 14);

  // Build a small category legend from the categories actually present
  // across the runway, so users can decode the bar colours.
  const categoriesSeen = new Set<string>();
  for (const d of runway) {
    for (const it of d.items) {
      if (it.kind !== 'unclear_gate') categoriesSeen.add(it.category);
    }
  }
  const legend = Array.from(categoriesSeen);

  return (
    <section
      className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden"
      data-testid="runway-14-day"
    >
      <header className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">14-day runway</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              How your inbox stacks up against the next two weeks of admin time.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400" /> on track
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> tight
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> over
            </span>
          </div>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {/* Week 1 */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              This week
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {week1.map((d) => (
              <DayCard
                key={d.dayIndex}
                day={d}
                isToday={d.dayIndex === 0}
                onClick={onDayClick ? () => onDayClick(d) : undefined}
              />
            ))}
          </div>
        </div>

        {/* Week 2 */}
        {week2.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Next week
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {week2.map((d) => (
                <DayCard
                  key={d.dayIndex}
                  day={d}
                  isToday={false}
                  onClick={onDayClick ? () => onDayClick(d) : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* Per-day flags surfaced once below — mirrors the bar's flag icon */}
        {runway.some((d) => d.flags.length > 0) && (
          <div className="pt-2 border-t border-border space-y-1">
            {runway
              .filter((d) => d.flags.length > 0)
              .map((d) => (
                <div
                  key={`flag-${d.dayIndex}`}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                  data-testid={`runway-flag-${d.dayIndex}`}
                >
                  <Flag size={12} className="mt-0.5 flex-shrink-0 text-amber-500" />
                  <div>
                    <strong className="text-foreground">{d.displayLabel}:</strong>{' '}
                    {d.flags.join('; ')}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Category legend, if any categories appear */}
        {legend.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[10px] text-muted-foreground">
            {legend.map((cat) => (
              <span key={cat} className="flex items-center gap-1">
                <span
                  className={cn(
                    'inline-block w-2 h-2 rounded-sm',
                    CAT_BAR_COLOR[cat] ?? 'bg-slate-400',
                  )}
                />
                {cat.toLowerCase().replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
