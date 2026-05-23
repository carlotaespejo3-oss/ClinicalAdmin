import { AlertTriangle, AlertOctagon, CheckCircle2, Clock, HelpCircle, Mail, FileText, Link2, ChevronRight, ChevronLeft, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DailyPlan, PlanItem, OverallStatus } from '@/lib/planner';
import { emails } from '@/lib/data';

export interface UnclearEmailSummary {
  id: number;
  subject: string;
  from: string;
}

export type PlanViewMode = 'day' | 'week';

interface Props {
  todaysPlan: DailyPlan;
  overallStatus: OverallStatus;
  unclearCount: number;
  unclearEmails?: UnclearEmailSummary[];
  onTriageUnclear?: (id: number) => void;
  onItemClick?: (item: PlanItem, dateIso: string) => void;
  // Day navigation — when provided, the header shows prev/next chevrons
  // so the clinician can step through the runway without leaving Home.
  dayIndex?: number;
  totalDays?: number;
  onPrevDay?: () => void;
  onNextDay?: () => void;
  onJumpToday?: () => void;
  // Day/Week toggle — when `runway` + `onChangeViewMode` are both
  // provided, the header renders a segmented control. In 'week' mode
  // the body switches to a parallel-columns layout over all runway
  // days. Day navigation chevrons hide in week mode (they're moot).
  viewMode?: PlanViewMode;
  onChangeViewMode?: (mode: PlanViewMode) => void;
  runway?: DailyPlan[];
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
  NONE: 'Acknowledge',
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
  const wasDeferred = (item.deferralCount ?? 0) > 0;
  const hardWarn = item.deferralWarning === 'twice_or_more';

  // Look up the email's original received date so a previously-
  // deferred email shows when it ACTUALLY arrived, not the date it
  // re-entered the runway. Only relevant for email items with a
  // numeric refId.
  const originalReceived =
    wasDeferred && item.kind === 'email' && typeof item.refId === 'number'
      ? emails.find((e) => e.id === item.refId)?.date ?? null
      : null;

  const Icon = item.kind === 'task' ? FileText : Mail;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 rounded-lg border bg-white p-3 text-left transition-colors',
        onClick ? 'hover:bg-slate-50' : 'cursor-default',
        isOverdue && 'border-red-300 bg-red-50',
        // Hard warn (deferred 2+ times) outranks linked-task styling.
        hardWarn && !isOverdue && 'border-amber-400 bg-amber-50',
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
          {wasDeferred && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border',
                hardWarn
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-slate-100 text-slate-700 border-slate-300',
              )}
              data-testid={`planner-item-deferred-${item.refId}`}
              title={
                hardWarn
                  ? 'This email has been deferred twice. It needs to be scheduled this week.'
                  : 'This email was deferred from a previous planning window.'
              }
            >
              <History size={10} />
              Deferred {item.deferralCount}×
            </span>
          )}
        </div>
        {item.detail && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.detail}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
          <Clock size={12} />
          <span>{fmtMin(item.estMin)}</span>
          <span className="text-slate-300">·</span>
          <span className={cn(isOverdue && 'text-red-700 font-medium')}>{item.reasonText}</span>
          {originalReceived && (
            <>
              <span className="text-slate-300">·</span>
              <span className={cn(hardWarn && 'text-amber-800 font-medium')}>
                Received {originalReceived}
              </span>
            </>
          )}
        </div>
        {hardWarn && (
          <div className="mt-2 text-xs text-amber-900 font-medium bg-amber-100/60 border border-amber-200 rounded px-2 py-1">
            Deferred twice already — must be scheduled this week.
          </div>
        )}
      </div>
    </button>
  );
}

function WeekColumn({
  day,
  isTodayCol,
  onItemClick,
}: {
  day: DailyPlan;
  isTodayCol: boolean;
  onItemClick?: (item: PlanItem, dateIso: string) => void;
}) {
  const items = day.items.filter((i) => i.kind !== 'unclear_gate');
  const idle = day.minutesAvailable === 0;
  const empty = items.length === 0;
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border bg-white min-w-0',
        isTodayCol ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border',
      )}
      data-testid={`week-column-${day.dayLabel.toLowerCase()}`}
    >
      <div className="px-3 py-2.5 border-b border-border/70">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-foreground">
            {day.dayLabel}
            {isTodayCol && (
              <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                Today
              </span>
            )}
          </h3>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {fmtMin(day.totalPlannedMin)}
            <span className="text-slate-300"> / </span>
            {fmtMin(day.minutesAvailable)}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{day.displayLabel}</p>
      </div>
      <div className="p-2 space-y-1.5 flex-1">
        {empty && idle && (
          <p className="text-[11px] text-muted-foreground italic px-1 py-3 text-center">
            No admin time.
          </p>
        )}
        {empty && !idle && (
          <p className="text-[11px] text-green-700 px-1 py-3 inline-flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-green-600" /> Slot free.
          </p>
        )}
        {items.map((item, i) => (
          <button
            type="button"
            key={`${item.kind}:${item.refId ?? i}`}
            onClick={
              onItemClick && item.refId != null ? () => onItemClick(item, day.date) : undefined
            }
            className={cn(
              'w-full text-left rounded-md border border-border bg-white px-2 py-1.5 transition-colors',
              onItemClick && item.refId != null
                ? 'hover:bg-slate-50'
                : 'cursor-default',
              item.reason === 'overdue' && 'border-red-300 bg-red-50',
              item.deferralWarning === 'twice_or_more' &&
                item.reason !== 'overdue' &&
                'border-amber-300 bg-amber-50',
            )}
            data-testid={`week-item-${day.dayLabel.toLowerCase()}-${item.refId ?? i}`}
          >
            <div className="flex items-start gap-1.5">
              {item.kind === 'task' ? (
                <FileText size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />
              ) : (
                <Mail size={11} className="text-slate-500 mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-foreground truncate leading-snug">
                  {item.title}
                </div>
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                  <span
                    className={cn(
                      'inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1 py-px rounded border',
                      CATEGORY_PILL[item.category] ?? CATEGORY_PILL.ADMIN,
                    )}
                  >
                    {CATEGORY_LABEL[item.category] ?? item.category}
                  </span>
                  <Clock size={9} />
                  <span className="tabular-nums">{fmtMin(item.estMin)}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
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
  viewMode = 'day',
  onChangeViewMode,
  runway,
}: Props) {
  const theme = STATUS_THEME[overallStatus];
  const items = todaysPlan.items;
  const hasItems = items.length > 0;
  // Count of real work rows (excludes the unclear-gate banner). Shown in the
  // header so the clinician can see at a glance how many items are queued
  // for this day — and it always matches the number of rows below.
  const visibleItemCount = items.filter((i) => i.kind !== 'unclear_gate').length;
  const idle = todaysPlan.minutesAvailable === 0;
  const isToday = dayIndex == null || dayIndex === 0;
  const isWeekMode = viewMode === 'week' && !!runway && !!onChangeViewMode;
  const toggleEnabled = !!runway && !!onChangeViewMode;
  const navEnabled = !isWeekMode && dayIndex != null && totalDays != null && totalDays > 1;
  const canPrev = navEnabled && dayIndex! > 0;
  const canNext = navEnabled && dayIndex! < totalDays! - 1;
  // Title: "Today's plan" on day 0, "Tomorrow's plan" on day 1, otherwise
  // the day label ("Wed's plan"). Empty days still get a title.
  const dayHeaderTitle = isToday
    ? "Today's plan"
    : dayIndex === 1
      ? "Tomorrow's plan"
      : `${todaysPlan.dayLabel}'s plan`;
  const headerTitle = isWeekMode ? "This week's plan" : dayHeaderTitle;

  // Week-mode totals across the runway.
  const weekTotals = isWeekMode && runway
    ? runway.reduce(
        (a, d) => ({
          planned: a.planned + d.totalPlannedMin,
          available: a.available + d.minutesAvailable,
          items: a.items + d.items.filter((i) => i.kind !== 'unclear_gate').length,
        }),
        { planned: 0, available: 0, items: 0 },
      )
    : null;

  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden" data-testid="todays-plan-card">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
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
            {!isWeekMode && (
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
            )}
            {isWeekMode && runway && (
              <p className="text-xs text-muted-foreground">
                {runway.length} day{runway.length === 1 ? '' : 's'} ahead
              </p>
            )}
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
        <div className="flex items-center gap-3">
          {toggleEnabled && (
            <div
              className="inline-flex rounded-lg border border-border bg-slate-50 p-0.5 text-[11px] font-semibold"
              role="tablist"
              aria-label="Plan view mode"
              data-testid="plan-view-toggle"
            >
              {(['day', 'week'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === m}
                  onClick={() => onChangeViewMode?.(m)}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-colors',
                    viewMode === m
                      ? 'bg-white text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  data-testid={`plan-view-toggle-${m}`}
                >
                  {m === 'day' ? 'Day' : 'Week'}
                </button>
              ))}
            </div>
          )}
          <div className="text-right">
            <div className="text-xs text-muted-foreground">
              Planned / available
              {!isWeekMode && visibleItemCount > 0 && (
                <span className="ml-2 text-slate-400" data-testid="day-plan-item-count">
                  · {visibleItemCount} item{visibleItemCount === 1 ? '' : 's'}
                </span>
              )}
              {isWeekMode && weekTotals && weekTotals.items > 0 && (
                <span className="ml-2 text-slate-400" data-testid="week-plan-item-count">
                  · {weekTotals.items} item{weekTotals.items === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="text-sm font-bold tabular-nums">
              {isWeekMode && weekTotals ? (
                <>
                  {fmtMin(weekTotals.planned)}
                  <span className="text-slate-400 font-normal"> / </span>
                  {fmtMin(weekTotals.available)}
                </>
              ) : (
                <>
                  {fmtMin(todaysPlan.totalPlannedMin)}
                  <span className="text-slate-400 font-normal"> / </span>
                  {fmtMin(todaysPlan.minutesAvailable)}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      {isWeekMode && runway ? (
        <div className="p-3">
          {/* Narrow screens (<760px) wrap to two rows of 4 + 3 so
              the last day never gets clipped off-screen. From 760px
              upwards, fan out into a single row of 7 equal columns. */}
          <div
            className="grid gap-1.5 grid-cols-4 min-[760px]:gap-2 min-[760px]:grid-cols-7"
            data-testid="week-columns-grid"
          >
            {runway.map((day, i) => (
              <WeekColumn
                key={`${day.dayLabel}-${i}`}
                day={day}
                isTodayCol={i === 0}
                onItemClick={onItemClick}
              />
            ))}
          </div>
          {unclearCount > 0 && (
            onTriageUnclear && unclearEmails && unclearEmails[0] ? (
              <button
                type="button"
                onClick={() => onTriageUnclear(unclearEmails[0].id)}
                className="text-xs text-amber-700 hover:text-amber-900 hover:underline pt-3 inline-flex items-center gap-1"
                data-testid="link-triage-unclear-week"
              >
                {unclearCount} email{unclearCount === 1 ? '' : 's'} still need classifying.
                <ChevronRight size={11} />
              </button>
            ) : (
              <div className="text-xs text-amber-700 pt-3">
                {unclearCount} email{unclearCount === 1 ? '' : 's'} still need classifying.
              </div>
            )
          )}
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {idle && !hasItems && (
            <div className="text-sm text-muted-foreground italic px-2 py-6 text-center">
              {isToday
                ? 'No admin time scheduled today. Items have been pushed to your next available admin day.'
                : `No admin time scheduled on ${todaysPlan.dayLabel}.`}
            </div>
          )}

          {!hasItems && !idle && (
            <div className="flex items-center gap-2 text-sm text-green-700 px-2 py-4">
              <CheckCircle2 size={18} className="text-green-600" />
              {isToday
                ? 'Inbox is empty for today. Use the time however you like.'
                : `Nothing scheduled on ${todaysPlan.dayLabel} — earlier days absorbed the workload, so this slot is free.`}
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
                          ? () => onItemClick(item, todaysPlan.date)
                          : undefined
                      }
                    />
                  )}
                </li>
              ))}
            </ol>
          )}

          {/* Buffer footer — three states:
               • comfortable buffer (>10 min): show spare time
               • tight but within capacity (safe/tight, small buffer): neutral
               • over-capacity (breach, today only): calm rollover note          */}
          {hasItems && todaysPlan.bufferMin > 10 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 px-1">
              <HelpCircle size={12} />
              <span>
                {fmtMin(todaysPlan.bufferMin)} spare — your inbox is on track and nothing else is due today.
              </span>
            </div>
          )}
          {hasItems && isToday && todaysPlan.status === 'breach' &&
            !items.some((i) => i.reason === 'overdue') && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-slate-50 border border-border/60 rounded-lg px-3 py-2.5 mt-2">
              <HelpCircle size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <span>
                Today's plan runs a bit over your session length. Whatever you don't get to will
                move to your next admin day automatically — no action needed. Your plan updates itself.
              </span>
            </div>
          )}
          {hasItems && isToday && todaysPlan.status === 'tight' && todaysPlan.bufferMin <= 10 && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground pt-2 px-1">
              <HelpCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                Today's plan is full. If anything runs over time, it'll shift to your next session — your plan adjusts automatically.
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
      )}
    </div>
  );
}
