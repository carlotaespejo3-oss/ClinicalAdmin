import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Sun,
  Settings2,
  Minus,
  Plus,
  RotateCcw,
  Check,
  ChevronRight,
  ChevronLeft,
  AlertOctagon,
  Clock,
  HelpCircle,
  Mail,
  FileText,
  History,
} from 'lucide-react';
import './_group.css';

// ---------------------------------------------------------------------------
// Self-contained Current.tsx — exact visual snapshot of HomeTab.tsx +
// TodaysPlan.tsx from artifacts/clinadmin/src as of 2026-05-18, with realistic
// mock data inlined so the dashboard renders without any stores or API.
// ---------------------------------------------------------------------------

type ClassValue = string | undefined | null | false;
const cn = (...inputs: ClassValue[]) => inputs.filter(Boolean).join(' ');

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

const PRIORITY_PILL: Record<'High' | 'Medium' | 'Low', string> = {
  High: 'bg-red-100 text-red-800 border-red-200',
  Medium: 'bg-amber-100 text-amber-800 border-amber-200',
  Low: 'bg-slate-100 text-slate-700 border-slate-200',
};

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

type OverallStatus = 'green' | 'amber' | 'red';
const STATUS_THEME: Record<OverallStatus, { dot: string; ring: string }> = {
  green: { dot: 'bg-green-500', ring: 'ring-green-200' },
  amber: { dot: 'bg-amber-500', ring: 'ring-amber-200' },
  red:   { dot: 'bg-red-500',   ring: 'ring-red-200'   },
};

interface PlanItem {
  kind: 'email' | 'task' | 'unclear_gate';
  refId?: number | string;
  title: string;
  detail?: string;
  category: string;
  estMin: number;
  reason: 'overdue' | 'due_soon' | 'linked_task' | 'fits' | 'gate';
  reasonText: string;
  deferralCount?: number;
  deferralWarning?: 'twice_or_more';
}

interface DailyPlan {
  dayLabel: string;
  displayLabel: string;
  minutesAvailable: number;
  totalPlannedMin: number;
  bufferMin: number;
  items: PlanItem[];
}

// ---- Mock planner output ---------------------------------------------------
const todaysPlan: DailyPlan = {
  dayLabel: 'Mon',
  displayLabel: 'Mon 18 May · 1h 40min planned',
  minutesAvailable: 120,
  totalPlannedMin: 100,
  bufferMin: 20,
  items: [
    {
      kind: 'unclear_gate',
      title: '3 emails need classifying first',
      detail: 'Triage these before today\'s runway is reliable.',
      category: 'UNCLEAR',
      estMin: 0,
      reason: 'gate',
      reasonText: '',
    },
    {
      kind: 'email',
      refId: 101,
      title: 'Section 12 assessment — J. Patel, urgent review',
      detail: 'Trust safeguarding lead flagged risk escalation overnight.',
      category: 'SAFEGUARDING',
      estMin: 25,
      reason: 'overdue',
      reasonText: 'Overdue by 1 day',
      deferralCount: 2,
      deferralWarning: 'twice_or_more',
    },
    {
      kind: 'email',
      refId: 102,
      title: 'CAMHS team — clinical handover for Thursday clinic',
      detail: 'Confirm slot allocation and discuss two new referrals.',
      category: 'CLINICAL',
      estMin: 20,
      reason: 'due_soon',
      reasonText: 'Due Wed',
    },
    {
      kind: 'task',
      refId: 'task-1',
      title: 'Sign off Trust supervision notes (Q2)',
      category: 'PROFESSIONAL',
      estMin: 30,
      reason: 'due_soon',
      reasonText: 'Due Fri',
    },
    {
      kind: 'email',
      refId: 103,
      title: 'Re: tribunal report — A. Hussain',
      detail: 'Solicitor following up on the addendum.',
      category: 'LEGAL',
      estMin: 25,
      reason: 'fits',
      reasonText: 'Fits today',
      deferralCount: 1,
    },
  ],
};

const priorityCounts: Record<'High' | 'Medium' | 'Low', number> = { High: 4, Medium: 7, Low: 3 };

const unclearEmails = [
  { id: 201, subject: 'Could you have a look at this please?', from: 'r.osborne@nhs.uk' },
  { id: 202, subject: 'Quick question about Friday clinic', from: 'practice.manager@nhs.uk' },
  { id: 203, subject: 'FW: form attached', from: 'admin.team@nhs.uk' },
];

const status: OverallStatus = 'amber';
const statusHeadline = 'on track but tight';
const statusDetail = "2 deferred items must land this week. Today's plan fits if Section 12 doesn't slip.";

// ---- Inline subcomponents (mirrors TodaysPlan.tsx) -------------------------
function UnclearGateBlock({ item }: { item: PlanItem }) {
  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-amber-900">{item.title}</div>
          <div className="text-xs text-amber-800 mt-0.5">{item.detail}</div>
        </div>
      </div>
      <ul className="space-y-1.5 pl-1">
        {unclearEmails.map((e, i) => (
          <li key={e.id}>
            <button
              type="button"
              className="w-full flex items-center gap-2 text-left bg-white border border-amber-200 rounded-md px-2.5 py-1.5 hover:bg-amber-100 hover:border-amber-300 transition-colors"
            >
              <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full tabular-nums flex-shrink-0">
                {i + 1} of {unclearEmails.length}
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
    </div>
  );
}

function ItemRow({ item }: { item: PlanItem }) {
  const isOverdue = item.reason === 'overdue';
  const isLinked = item.reason === 'linked_task';
  const wasDeferred = (item.deferralCount ?? 0) > 0;
  const hardWarn = item.deferralWarning === 'twice_or_more';
  const Icon = item.kind === 'task' ? FileText : Mail;

  return (
    <button
      type="button"
      className={cn(
        'w-full flex items-start gap-3 rounded-lg border bg-white p-3 text-left transition-colors hover:bg-slate-50',
        isOverdue && 'border-red-300 bg-red-50',
        hardWarn && !isOverdue && 'border-amber-400 bg-amber-50',
        isLinked && 'ml-6 border-l-2 border-l-slate-300',
      )}
    >
      <div className="flex-shrink-0 mt-0.5">
        {isOverdue ? (
          <AlertOctagon size={18} className="text-red-600" />
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

function TodaysPlanCard() {
  const theme = STATUS_THEME[status];
  const items = todaysPlan.items;
  const visibleItemCount = items.filter((i) => i.kind !== 'unclear_gate').length;

  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            disabled
            className="w-8 h-8 flex items-center justify-center rounded-full border border-border text-slate-300 cursor-not-allowed flex-shrink-0"
            aria-label="Previous day"
          >
            <ChevronLeft size={16} />
          </button>
          <span className={cn('w-2.5 h-2.5 rounded-full ring-4', theme.dot, theme.ring)} aria-hidden />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">Today's plan</h2>
            <p className="text-xs text-muted-foreground">{todaysPlan.displayLabel}</p>
          </div>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-full border border-border hover:bg-slate-100 text-slate-700 transition-colors flex-shrink-0"
            aria-label="Next day"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">
            Planned / available
            <span className="ml-2 text-slate-400">· {visibleItemCount} items</span>
          </div>
          <div className="text-sm font-bold tabular-nums">
            {fmtMin(todaysPlan.totalPlannedMin)}
            <span className="text-slate-400 font-normal"> / </span>
            {fmtMin(todaysPlan.minutesAvailable)}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-2">
        <ol className="space-y-2">
          {items.map((item, i) => (
            <li key={`${item.kind}:${item.refId ?? i}`}>
              {item.kind === 'unclear_gate' ? <UnclearGateBlock item={item} /> : <ItemRow item={item} />}
            </li>
          ))}
        </ol>
        {todaysPlan.bufferMin > 10 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 px-1">
            <HelpCircle size={12} />
            <span>
              {fmtMin(todaysPlan.bufferMin)} spare after today's plan — your inbox is on track and nothing else is due today.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Main component --------------------------------------------------------
export default function Current() {
  const [draftMinutesByDay, setDraftMinutesByDay] = useState<Record<string, number>>({
    Tue: 90,
    Wed: 120,
    Thu: 90,
  });
  const [savedFlash] = useState(false);

  const draftDays = ALL_DAYS.filter((d) => draftMinutesByDay[d] != null && draftMinutesByDay[d] > 0);
  const draftTotalMins = draftDays.reduce((a, d) => a + (draftMinutesByDay[d] ?? 0), 0);
  const draftHours = +(draftTotalMins / 60).toFixed(2);
  const dirty = true;

  const toggleDraftDay = (d: string) => {
    setDraftMinutesByDay((prev) => {
      const next = { ...prev };
      if (next[d] != null) {
        delete next[d];
        return next;
      }
      next[d] = 60;
      return next;
    });
  };

  const adjustDayMins = (d: string, delta: number) => {
    setDraftMinutesByDay((prev) => {
      const cur = prev[d] ?? 0;
      const nextVal = Math.max(0, Math.min(600, cur + delta));
      if (nextVal === 0) {
        const { [d]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [d]: nextVal };
    });
  };

  return (
    <div className="home-redesign-scope min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 lg:p-8">
        <div className="space-y-5">
          {/* Greeting */}
          <div className="flex items-center gap-4 pb-1">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Sun size={26} className="text-amber-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Good morning, Dr. Morgan</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Here's your plan for today. Follow it and you're on top of your admin.
              </p>
            </div>
          </div>

          {/* Priority summary bar */}
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: 'High' as const, label: 'Urgent' },
                { key: 'Medium' as const, label: 'Medium' },
                { key: 'Low' as const, label: 'Low' },
              ]
            ).map(({ key, label }) => {
              const count = priorityCounts[key];
              const zero = count === 0;
              return (
                <span
                  key={key}
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border',
                    zero
                      ? 'text-muted-foreground bg-slate-50 border-slate-200 opacity-60'
                      : PRIORITY_PILL[key],
                  )}
                >
                  <span className="tabular-nums">{count}</span>
                  <span>{label}</span>
                </span>
              );
            })}
          </div>

          {/* Slim status banner */}
          <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100">
              <AlertTriangle size={24} className="text-amber-500" />
            </div>
            <div className="space-y-1 flex-1 min-w-0">
              <p className="text-sm text-muted-foreground font-medium">You're currently:</p>
              <p className="text-xl font-bold text-amber-600">Tight — {statusHeadline}</p>
              <p className="text-sm text-foreground">{statusDetail}</p>
            </div>
            <button className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline whitespace-nowrap flex-shrink-0 mt-1">
              Detailed view <ChevronRight size={12} />
            </button>
          </div>

          {/* Today's plan */}
          <TodaysPlanCard />

          {/* Availability adjustment panel */}
          <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 pt-5 pb-4 border-b border-border flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
                  <Settings2 size={17} className="text-slate-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    Adjust this week's availability
                    {savedFlash && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                        <Check size={10} /> Saved
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Plans change. Tweak your hours or days here without re-running the weekly brief.
                  </p>
                </div>
              </div>
              <button className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline whitespace-nowrap">
                <RotateCcw size={11} /> Re-run weekly brief
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-1">
                    Per-day admin hours
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Set different time for each day — not every week is balanced. Total this week:{' '}
                    <strong className="text-foreground">{fmtMins(draftTotalMins)}</strong>
                    {draftDays.length > 0 && (
                      <> across {draftDays.length} day{draftDays.length !== 1 ? 's' : ''}</>
                    )}
                    .
                  </p>
                </div>
                {draftDays.length > 1 && (
                  <button
                    className="text-[11px] font-bold text-primary bg-primary/5 border border-primary/20 px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw size={11} /> Spread evenly
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {ALL_DAYS.map((d) => {
                  const mins = draftMinutesByDay[d];
                  const active = mins != null && mins > 0;
                  return (
                    <div
                      key={d}
                      className={cn(
                        'rounded-xl border p-3 transition-colors',
                        active ? 'border-primary/40 bg-primary/5' : 'border-border bg-white',
                      )}
                    >
                      <button
                        onClick={() => toggleDraftDay(d)}
                        className={cn(
                          'w-full text-sm font-bold mb-2 py-1 rounded-md transition-colors',
                          active ? 'text-primary hover:bg-primary/10' : 'text-slate-500 hover:bg-slate-50',
                        )}
                      >
                        {d}
                      </button>
                      {active ? (
                        <>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => adjustDayMins(d, -15)}
                              className="w-7 h-7 rounded-md border border-border bg-white hover:bg-accent flex items-center justify-center transition-colors flex-shrink-0"
                              aria-label={`Decrease ${d} by 15 min`}
                            >
                              <Minus size={12} />
                            </button>
                            <div className="flex-1 text-center">
                              <span className="text-sm font-bold text-foreground">{fmtMins(mins!)}</span>
                            </div>
                            <button
                              onClick={() => adjustDayMins(d, 15)}
                              className="w-7 h-7 rounded-md border border-border bg-white hover:bg-accent flex items-center justify-center transition-colors flex-shrink-0"
                              aria-label={`Increase ${d} by 15 min`}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          <p className="text-[10px] text-muted-foreground text-center mt-1.5">±15 min</p>
                        </>
                      ) : (
                        <p className="text-[11px] text-muted-foreground text-center py-2 italic">Off</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-muted-foreground">
                {draftDays.length === 0
                  ? 'No admin days selected — your week is unscheduled.'
                  : (
                    <>
                      {draftHours}h total / week. Tap a day name to switch it on or off.
                    </>
                  )}
              </p>
            </div>

            {dirty && (
              <div className="px-6 py-3 border-t border-border bg-amber-50/50 flex items-center justify-between gap-3">
                <p className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  Unsaved changes — your dashboard won't update until you save.
                </p>
                <div className="flex items-center gap-2">
                  <button className="text-xs text-muted-foreground font-semibold px-3 py-1.5 rounded-lg hover:bg-white transition-colors">
                    Discard
                  </button>
                  <button className="bg-primary text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-primary/90 transition-colors">
                    Save changes
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Just-for-completeness footer marker so 'green' state path is exercised visually */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <CheckCircle2 size={12} className="text-green-600" />
            Live data flows from Outlook + planner; this view is a static snapshot of the current design.
          </div>
        </div>
      </div>
    </div>
  );
}
