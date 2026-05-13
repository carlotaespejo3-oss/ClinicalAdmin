import { AlertTriangle, AlertOctagon, CheckCircle2, Clock, HelpCircle, Mail, FileText, Link2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DailyPlan, PlanItem, OverallStatus } from '@/lib/planner';

interface Props {
  todaysPlan: DailyPlan;
  overallStatus: OverallStatus;
  unclearCount: number;
  onTriageUnclear?: () => void;
  onItemClick?: (item: PlanItem) => void;
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

const CATEGORY_PILL: Record<string, string> = {
  SAFEGUARDING: 'bg-rose-100 text-rose-800 border-rose-200',
  URGENT_CLINICAL: 'bg-red-100 text-red-800 border-red-200',
  LEGAL: 'bg-purple-100 text-purple-800 border-purple-200',
  CLINICAL: 'bg-blue-100 text-blue-800 border-blue-200',
  PROFESSIONAL: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  ADMIN: 'bg-slate-100 text-slate-700 border-slate-200',
  CPD: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  NONE: 'bg-slate-50 text-slate-500 border-slate-200',
  UNCLEAR: 'bg-amber-100 text-amber-800 border-amber-200',
};

const CATEGORY_LABEL: Record<string, string> = {
  SAFEGUARDING: 'Safeguarding',
  URGENT_CLINICAL: 'Urgent clinical',
  LEGAL: 'Legal',
  CLINICAL: 'Clinical',
  PROFESSIONAL: 'Professional',
  ADMIN: 'Admin',
  CPD: 'CPD',
  NONE: 'No action',
  UNCLEAR: 'Unclear',
};

const STATUS_THEME: Record<OverallStatus, { dot: string; bg: string; text: string; ring: string }> = {
  green: { dot: 'bg-green-500', bg: 'bg-green-50', text: 'text-green-800', ring: 'ring-green-200' },
  amber: { dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-200' },
  red: { dot: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-800', ring: 'ring-red-200' },
};

function ItemRow({ item, onClick }: { item: PlanItem; onClick?: () => void }) {
  const isUnclearGate = item.kind === 'unclear_gate';
  const isOverdue = item.reason === 'overdue';
  const isLinked = item.reason === 'linked_task';

  if (isUnclearGate) {
    const Wrapper: any = onClick ? 'button' : 'div';
    return (
      <Wrapper
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={cn(
          'w-full flex items-start gap-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-left transition-colors',
          onClick && 'hover:bg-amber-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400',
        )}
        data-testid="planner-item-unclear-gate"
      >
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-amber-900">{item.title}</div>
          <div className="text-xs text-amber-800 mt-0.5">{item.detail}</div>
        </div>
        {onClick && (
          <span className="text-[11px] font-bold text-amber-700 whitespace-nowrap mt-0.5 flex items-center gap-0.5">
            Triage now <ChevronRight size={12} />
          </span>
        )}
      </Wrapper>
    );
  }

  const Icon = item.kind === 'task' ? FileText : Mail;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 rounded-lg border bg-white p-3 text-left transition-colors',
        onClick ? 'hover:bg-slate-50' : 'cursor-default',
        isOverdue && 'border-red-300 bg-red-50',
        isLinked && 'ml-6 border-l-2 border-l-slate-300',
      )}
      data-testid={`planner-item-${item.refId ?? item.title}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {isOverdue ? (
          <AlertOctagon size={18} className="text-red-600" />
        ) : isLinked ? (
          <Link2 size={16} className="text-slate-500" />
        ) : (
          <Icon size={18} className="text-slate-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{item.title}</span>
          <span
            className={cn(
              'inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border',
              CATEGORY_PILL[item.category] ?? CATEGORY_PILL.ADMIN,
            )}
          >
            {CATEGORY_LABEL[item.category] ?? item.category}
          </span>
        </div>
        {item.detail && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.detail}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
          <Clock size={12} />
          <span>{fmtMin(item.estMin)}</span>
          <span className="text-slate-300">·</span>
          <span className={cn(isOverdue && 'text-red-700 font-medium')}>{item.reasonText}</span>
        </div>
      </div>
    </button>
  );
}

export default function TodaysPlan({ todaysPlan, overallStatus, unclearCount, onTriageUnclear, onItemClick }: Props) {
  const theme = STATUS_THEME[overallStatus];
  const items = todaysPlan.items;
  const hasItems = items.length > 0;
  const idle = todaysPlan.minutesAvailable === 0;

  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden" data-testid="todays-plan-card">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn('w-2.5 h-2.5 rounded-full ring-4', theme.dot, theme.ring)} aria-hidden />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">Today's plan</h2>
            <p className="text-xs text-muted-foreground">{todaysPlan.displayLabel}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Planned / available</div>
          <div className="text-sm font-bold tabular-nums">
            {fmtMin(todaysPlan.totalPlannedMin)}
            <span className="text-slate-400 font-normal"> / </span>
            {fmtMin(todaysPlan.minutesAvailable)}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-2">
        {idle && !hasItems && (
          <div className="text-sm text-muted-foreground italic px-2 py-6 text-center">
            No admin time scheduled today. Items have been pushed to your next available admin day.
          </div>
        )}

        {!hasItems && !idle && (
          <div className="flex items-center gap-2 text-sm text-green-700 px-2 py-4">
            <CheckCircle2 size={18} className="text-green-600" />
            Inbox is empty for today. Use the time however you like.
          </div>
        )}

        {hasItems && (
          <ol className="space-y-2">
            {items.map((item, i) => (
              <li key={`${item.kind}:${item.refId ?? i}`}>
                <ItemRow
                  item={item}
                  // Email rows (numeric refId) and task rows (string refId)
                  // open the relevant detail. The unclear-gate banner uses
                  // its own onTriageUnclear handler so it can jump straight
                  // to the inbox filtered to the unclassified emails.
                  onClick={
                    item.kind === 'unclear_gate'
                      ? onTriageUnclear
                      : onItemClick && item.refId != null
                        ? () => onItemClick(item)
                        : undefined
                  }
                />
              </li>
            ))}
          </ol>
        )}

        {/* Buffer footer */}
        {hasItems && todaysPlan.bufferMin > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 px-1">
            <HelpCircle size={12} />
            <span>
              {fmtMin(todaysPlan.bufferMin)} buffer left after today's plan — room for unexpected
              items.
            </span>
          </div>
        )}

        {unclearCount > 0 && items[0]?.kind !== 'unclear_gate' && (
          onTriageUnclear ? (
            <button
              type="button"
              onClick={onTriageUnclear}
              className="text-xs text-amber-700 hover:text-amber-900 hover:underline px-1 pt-1 inline-flex items-center gap-1"
              data-testid="link-triage-unclear-trailing"
            >
              {unclearCount} email{unclearCount === 1 ? '' : 's'} still need classifying.
              <ChevronRight size={11} />
            </button>
          ) : (
            <div className="text-xs text-amber-700 px-1 pt-1">
              {unclearCount} email{unclearCount === 1 ? '' : 's'} still need classifying.
            </div>
          )
        )}
      </div>
    </div>
  );
}
