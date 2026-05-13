import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Mail, ClipboardList, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MorningBrief, TrajectoryState } from '@/lib/morningBrief';

interface Props {
  brief: MorningBrief;
  onOpenEmail: (id: number) => void;
  onOpenTasks: () => void;
  onOpenInbox: () => void;
  // Action when the trajectory is not ON_TRACK — usually wired to the
  // existing "Add 1h" availability adjustment.
  onAddHour?: () => void;
  addHourLabel?: string;
}

const TRAJECTORY_THEME: Record<TrajectoryState, {
  badge: string;
  headlineColor: string;
  iconBg: string;
  iconColor: string;
}> = {
  ON_TRACK: {
    badge: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    headlineColor: 'text-emerald-700',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  DRIFTING: {
    badge: 'bg-amber-50 border-amber-200 text-amber-700',
    headlineColor: 'text-amber-700',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  OVERLOADED: {
    badge: 'bg-red-50 border-red-200 text-red-700',
    headlineColor: 'text-red-700',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
  },
};

function fmt(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export default function MorningBriefCard({
  brief,
  onOpenEmail,
  onOpenTasks,
  onOpenInbox,
  onAddHour,
  addHourLabel,
}: Props) {
  const { cannotWait, cannotWaitOverflow, cannotWaitTotal, trajectory } = brief;
  const theme = TRAJECTORY_THEME[trajectory.state];
  const nothingUrgent = cannotWaitTotal === 0;
  const TrajectoryIcon = trajectory.state === 'ON_TRACK' ? CheckCircle2 : TrendingUp;

  return (
    <section
      data-testid="morning-brief"
      className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden"
      aria-label="Morning brief"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
        {/* Left — Cannot wait today */}
        <div className="p-6">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Cannot wait today
            </p>
            {cannotWaitTotal > 0 && (
              <span
                data-testid="morning-brief-total"
                className="text-[10px] font-bold text-muted-foreground"
              >
                {cannotWaitTotal} total
              </span>
            )}
          </div>

          {nothingUrgent ? (
            <div
              className="flex items-start gap-3"
              data-testid="morning-brief-nothing-urgent"
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={20} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-base font-bold text-emerald-700">Nothing urgent</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Clear morning — work the inbox at your own pace.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2" data-testid="morning-brief-items">
              {cannotWait.map((item) => {
                const Icon = item.kind === 'email' ? Mail : ClipboardList;
                const onClick =
                  item.kind === 'email'
                    ? () => onOpenEmail(item.id as number)
                    : () => onOpenTasks();
                const reasonIsRisk = item.rank <= 1;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    onClick={onClick}
                    data-testid={`morning-brief-item-${item.kind}-${item.id}`}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors',
                      reasonIsRisk
                        ? 'bg-red-50/60 border-red-200 hover:bg-red-50'
                        : 'bg-amber-50/60 border-amber-200 hover:bg-amber-50',
                    )}
                  >
                    <div
                      className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                        reasonIsRisk ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600',
                      )}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{item.title}</p>
                      <p
                        className={cn(
                          'text-xs font-medium mt-0.5',
                          reasonIsRisk ? 'text-red-700' : 'text-amber-700',
                        )}
                      >
                        {item.reason}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground bg-white border border-border px-2 py-1 rounded">
                      <Clock size={10} />
                      {fmt(item.estMin)}
                    </span>
                    <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
                  </button>
                );
              })}
              {cannotWaitOverflow > 0 && (
                <button
                  onClick={onOpenInbox}
                  data-testid="morning-brief-overflow"
                  className="w-full text-left text-xs font-bold text-primary hover:underline pl-3 pt-1"
                >
                  + {cannotWaitOverflow} more urgent {cannotWaitOverflow === 1 ? 'item' : 'items'} in the inbox →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right — Week trajectory */}
        <div className="p-6 bg-slate-50/40">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
            This week
          </p>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                theme.iconBg,
              )}
            >
              {trajectory.state === 'OVERLOADED' ? (
                <AlertTriangle size={20} className={theme.iconColor} />
              ) : (
                <TrajectoryIcon size={20} className={theme.iconColor} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p
                data-testid="morning-brief-trajectory-headline"
                className={cn('text-base font-bold', theme.headlineColor)}
              >
                {trajectory.headline}
              </p>
              <p className="text-sm text-foreground mt-1 leading-snug">
                {trajectory.detail}
              </p>
              {trajectory.state !== 'ON_TRACK' && onAddHour && addHourLabel && (
                <button
                  onClick={onAddHour}
                  data-testid="morning-brief-add-hour"
                  className="mt-3 inline-flex items-center gap-1.5 bg-primary text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                >
                  {addHourLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
