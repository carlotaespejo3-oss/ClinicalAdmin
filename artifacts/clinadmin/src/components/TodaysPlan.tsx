import { AlertTriangle, AlertOctagon, CheckCircle2, Clock, HelpCircle, Mail, FileText, Link2, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DailyPlan, PlanItem, OverallStatus } from '@/lib/planner';

export interface UnclearEmailSummary {
  id: number;
  subject: string;
  from: string;
}

interface Props {
  todaysPlan: DailyPlan;
  overallStatus: OverallStatus;
  unclearCount: number;
  unclearEmails?: UnclearEmailSummary[];
  onTriageUnclear?: (id: number) => void;
  onItemClick?: (item: PlanItem) => void;
  // Day navigation — when provided, the header shows prev/next chevrons
  // so the clinician can step through the runway without leaving Home.
  dayIndex?: number;
  totalDays?: number;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onJumpToday?: () => void;
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

function UnclearGateBlock({
  item,
  unclearEmails,
  onTriage,
}: {
  item: PlanItem;
  unclearEmails?: UnclearEmailSummary[];
  onTriage?: (id: number) => void;
}) {
  const list = unclearEmails ?? [];
  return (
    <div
      className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 space-y-2"
      data-testid="planner-item-unclear-gate"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-amber-900">{item.title}</div>
          <div className="text-xs text-amber-800 mt-0.5">{item.detail}</div>
        </div>
      </div>
      {list.length > 0 && onTriage && (
        // Inline triage queue — every unclassified email is its own
        // clickable row so the clinician can work through them one after
        // another without bouncing back to the dashboard between each.
        <ul className="space-y-1.5 pl-1" data-testid="unclear-gate-list">
          {list.map((e, i) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onTriage(e.id)}
                className="w-full flex items-center gap-2 text-left bg-white border border-amber-200 rounded-md px-2.5 py-1.5 hover:bg-amber-100 hover:border-amber-300 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
                data-testid={`unclear-gate-row-${e.id}`}
              >
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full tabular-nums flex-shrink-0">
                  {i + 1} of {list.length}
                </span>
                <Mail size={13} className="text-amber-700 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-amber-900 truncate">{e.subject}</div>
                  <div className="text-[11px] text-amber-700 truncate">{e.from}</div>
                </div>
                <ChevronRight size={12} className="text-amber-600 flex-shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemRow({ item, onClick }: { item: PlanItem; onClick?: () => void }) {
  const isOverdue = item.reason === 'overdue';
  const isLinked = item.reason === 'linked_task';

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

export default function TodaysPlan({
  todaysPlan,
  overallStatus,
  unclearCount,
  unclearEmails,
  onTriageUnclear,
  onItemClick,
  dayIndex,
  totalDays,
  onPrevDay,
  onNextDay,
  onJumpToday,
}: Props) {
  const theme = STATUS_THEME[overallStatus];
  const items = todaysPlan.items;
  const hasItems = items.length > 0;
  const idle = todaysPlan.minutesAvailable === 0;
  const isToday = dayIndex == null || dayIndex === 0;
  const navEnabled = dayIndex != null && totalDays != null && totalDays > 1;
  const canPrev = navEnabled && dayIndex! > 0;
  const canNext = navEnabled && dayIndex! < totalDays! - 1;
  // Title: "Today's plan" on day 0, "Tomorrow's plan" on day 1, otherwise
  // the day label ("Wed's plan"). Empty days still get a title.
  const headerTitle = isToday
    ? "Today's plan"
    : dayIndex === 1
      ? "Tomorrow's plan"
      : `${todaysPlan.dayLabel}'s plan`;

  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden" data-testid="todays-plan-card">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {navEnabled && (
            <button
              type="button"
              onClick={canPrev ? onPrevDay : undefined}
              disabled={!canPrev}
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-full border border-border transition-colors flex-shrink-0',
                canPrev ? 'hover:bg-slate-100 text-slate-700' : 'text-slate-300 cursor-not-allowed',
              )}
              aria-label="Previous day"
              data-testid="day-nav-prev"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <span className={cn('w-2.5 h-2.5 rounded-full ring-4', theme.dot, theme.ring)} aria-hidden />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground" data-testid="day-plan-title">
              {headerTitle}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <span>{todaysPlan.displayLabel}</span>
              {!isToday && onJumpToday && (
                <button
                  type="button"
                  onClick={onJumpToday}
                  className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                  data-testid="day-nav-today"
                >
                  ← back to today
                </button>
              )}
            </p>
          </div>
          {navEnabled && (
            <button
              type="button"
              onClick={canNext ? onNextDay : undefined}
              disabled={!canNext}
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-full border border-border transition-colors flex-shrink-0',
                canNext ? 'hover:bg-slate-100 text-slate-700' : 'text-slate-300 cursor-not-allowed',
              )}
              aria-label="Next day"
              data-testid="day-nav-next"
            >
              <ChevronRight size={16} />
            </button>
          )}
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
                {item.kind === 'unclear_gate' ? (
                  <UnclearGateBlock
                    item={item}
                    unclearEmails={unclearEmails}
                    onTriage={onTriageUnclear}
                  />
                ) : (
                  <ItemRow
                    item={item}
                    onClick={
                      onItemClick && item.refId != null
                        ? () => onItemClick(item)
                        : undefined
                    }
                  />
                )}
              </li>
            ))}
          </ol>
        )}

        {/* Buffer footer */}
        {hasItems && todaysPlan.bufferMin > 10 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 px-1">
            <HelpCircle size={12} />
            <span>
              {fmtMin(todaysPlan.bufferMin)} spare after today's plan — your inbox is on track and
              nothing else is due today.
            </span>
          </div>
        )}

        {/* Trailing "X emails still need classifying" only makes sense on
            today's view — the unclear gate is a today-only prompt. */}
        {isToday && unclearCount > 0 && items[0]?.kind !== 'unclear_gate' && (
          onTriageUnclear && unclearEmails && unclearEmails[0] ? (
            <button
              type="button"
              onClick={() => onTriageUnclear(unclearEmails[0].id)}
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
