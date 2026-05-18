import { Plane, Inbox, Clock, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  daysAway: number;
  pendingCount: number;
  pendingByPriority: { High: number; Medium: number; Low: number };
  totalEstimateMin: number;
  weekCapacityMin: number;
  routineBreachCount: number;
  urgentBreachCount: number;
  onNavigateInbox?: () => void;
}

function fmtHours(min: number): string {
  if (min <= 0) return '0h';
  const h = min / 60;
  if (h < 1) return `${Math.round(min)}min`;
  if (h < 10) return `${h.toFixed(1).replace(/\.0$/, '')}h`;
  return `${Math.round(h)}h`;
}

export default function CatchUpPlanCard({
  daysAway,
  pendingCount,
  pendingByPriority,
  totalEstimateMin,
  weekCapacityMin,
  routineBreachCount,
  urgentBreachCount,
  onNavigateInbox,
}: Props) {
  const shortfallMin = Math.max(0, totalEstimateMin - weekCapacityMin);
  const fits = shortfallMin === 0;
  const perDayTopUp = Math.ceil(shortfallMin / 5 / 15) * 15;

  return (
    <div
      className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white shadow-sm overflow-hidden"
      data-testid="home-catchup-plan"
    >
      <div className="px-5 py-4 border-b border-sky-100 bg-sky-50/60 flex items-start gap-3">
        <div className="rounded-full bg-sky-100 p-2 flex-shrink-0">
          <Plane size={18} className="text-sky-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sky-900 text-sm">
            Welcome back — catch-up plan for this week
          </p>
          <p className="text-xs text-sky-800/80 mt-0.5">
            You were away for {daysAway} {daysAway === 1 ? 'day' : 'days'}. Here's
            what built up and how it fits into your week.
          </p>
        </div>
      </div>

      <div className="px-5 py-4 grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={onNavigateInbox}
          className={cn(
            'flex flex-col items-start gap-1 p-3 rounded-lg border border-border/60 bg-white text-left',
            onNavigateInbox && 'hover:bg-sky-50/50 hover:border-sky-200 transition-colors',
          )}
          data-testid="catchup-stat-inbox"
          disabled={!onNavigateInbox}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Inbox size={11} /> Inbox waiting
          </div>
          <div className="text-2xl font-bold tabular-nums">{pendingCount}</div>
          <div className="text-[11px] text-muted-foreground leading-tight">
            {pendingByPriority.High} urgent · {pendingByPriority.Medium} medium ·{' '}
            {pendingByPriority.Low} low
          </div>
        </button>

        <div
          className="flex flex-col items-start gap-1 p-3 rounded-lg border border-border/60 bg-white"
          data-testid="catchup-stat-estimate"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Clock size={11} /> Estimated work
          </div>
          <div className="text-2xl font-bold tabular-nums">{fmtHours(totalEstimateMin)}</div>
          <div className="text-[11px] text-muted-foreground leading-tight">
            to clear the pile
          </div>
        </div>

        <div
          className="flex flex-col items-start gap-1 p-3 rounded-lg border border-border/60 bg-white"
          data-testid="catchup-stat-capacity"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <CheckCircle2 size={11} /> Available
          </div>
          <div className="text-2xl font-bold tabular-nums">{fmtHours(weekCapacityMin)}</div>
          <div className="text-[11px] text-muted-foreground leading-tight">
            this week (after recovery ramp)
          </div>
        </div>
      </div>

      {/* Plan narrative — either "fits" or "shortfall + your options" */}
      <div className="px-5 pb-4">
        {fits ? (
          <div
            className="flex items-start gap-2.5 rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5"
            data-testid="catchup-fits"
          >
            <CheckCircle2 size={16} className="text-green-700 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-green-900 leading-snug">
              <strong>Comfortably fits this week.</strong> Work through the inbox at
              your normal pace — the runway has room for everything that piled up.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5"
              data-testid="catchup-shortfall"
            >
              <AlertTriangle size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-900 leading-snug min-w-0">
                <p>
                  <strong>About {fmtHours(shortfallMin)} short.</strong> Two ways to
                  handle it:
                </p>
                <ul className="mt-1.5 ml-1 space-y-1 list-disc list-inside">
                  <li>
                    Add roughly{' '}
                    <strong>{perDayTopUp} min</strong> per working day this week, or
                  </li>
                  <li>
                    Let the low-priority admin emails wait a bit longer — see below.
                  </li>
                </ul>
              </div>
            </div>

            {routineBreachCount > 0 && (
              <div
                className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5"
                data-testid="catchup-leave-excused"
              >
                <Info size={16} className="text-sky-700 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-sky-900 leading-snug">
                  <strong>
                    {routineBreachCount} low-priority{' '}
                    {routineBreachCount === 1 ? 'email' : 'emails'} may breach the
                    14-day rule
                  </strong>{' '}
                  this week. That's expected — they're admin/acknowledgement items
                  and you've just come back from leave. Treat as{' '}
                  <strong>leave-excused</strong>, not a miss.
                </p>
              </div>
            )}

            {urgentBreachCount > 0 && (
              <div
                className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5"
                data-testid="catchup-urgent-breach"
              >
                <AlertTriangle size={16} className="text-red-700 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-900 leading-snug">
                  <strong>
                    {urgentBreachCount} clinical or urgent{' '}
                    {urgentBreachCount === 1 ? 'item' : 'items'} won't fit
                  </strong>{' '}
                  this week on the current plan. These can't be left to slip — add
                  hours or move other work.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
