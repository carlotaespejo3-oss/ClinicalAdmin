import { useState } from 'react';
import {
  AlertTriangle,
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
  Info
} from 'lucide-react';
import './_group.css';

// ---------------------------------------------------------------------------
// Self-contained CalmClinical.tsx — exact visual snapshot of HomeTab.tsx +
// TodaysPlan.tsx but redesigned with a calm clinical aesthetic.
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

// Subdued colours for pills
const PRIORITY_PILL: Record<'High' | 'Medium' | 'Low', string> = {
  High: 'bg-red-50 text-red-700 border-red-100',
  Medium: 'bg-amber-50 text-amber-700 border-amber-100',
  Low: 'bg-slate-50 text-slate-600 border-slate-200',
};

const CATEGORY_PILL: Record<string, string> = {
  SAFEGUARDING: 'bg-red-50 text-red-700 border-red-100',
  URGENT_CLINICAL: 'bg-red-50 text-red-700 border-red-100',
  LEGAL: 'bg-purple-50 text-purple-700 border-purple-100',
  CLINICAL: 'bg-blue-50 text-blue-700 border-blue-100',
  PROFESSIONAL: 'bg-slate-100 text-slate-700 border-slate-200',
  ADMIN: 'bg-slate-50 text-slate-600 border-slate-200',
  CPD: 'bg-teal-50 text-teal-700 border-teal-100',
  NONE: 'bg-slate-50 text-slate-500 border-slate-200',
  UNCLEAR: 'bg-amber-50 text-amber-700 border-amber-100',
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
const STATUS_THEME: Record<OverallStatus, { border: string; bg: string, text: string, icon: string }> = {
  green: { border: 'border-l-teal-500', bg: 'bg-teal-50/30', text: 'text-teal-800', icon: 'text-teal-600' },
  amber: { border: 'border-l-amber-400', bg: 'bg-amber-50/40', text: 'text-amber-800', icon: 'text-amber-600' },
  red:   { border: 'border-l-red-500', bg: 'bg-red-50/30', text: 'text-red-800', icon: 'text-red-600' },
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
const statusHeadline = 'On track but tight';
const statusDetail = "2 deferred items must land this week. Today's plan fits if Section 12 doesn't slip.";

// ---- Inline subcomponents -------------------------
function UnclearGateBlock({ item }: { item: PlanItem }) {
  return (
    <div className="border border-amber-200 border-l-4 border-l-amber-400 bg-amber-50/30 p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-900">{item.title}</div>
          <div className="text-xs text-amber-800 mt-0.5">{item.detail}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
        {unclearEmails.map((e, i) => (
          <button
            key={e.id}
            type="button"
            className="flex flex-col text-left bg-white border border-amber-200 p-2 hover:bg-amber-50 transition-colors"
          >
            <div className="flex justify-between items-start mb-1">
              <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1 py-0.5 tabular-nums">
                {i + 1} of {unclearEmails.length}
              </span>
              <Mail size={12} className="text-amber-600" />
            </div>
            <div className="text-xs font-medium text-amber-900 truncate w-full">{e.subject}</div>
            <div className="text-[11px] text-amber-700 truncate w-full mt-0.5">{e.from}</div>
          </button>
        ))}
      </div>
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
    <div
      className={cn(
        'group flex items-start gap-4 p-4 border-b border-slate-200 bg-white hover:bg-slate-50/50 transition-colors relative',
        isLinked && 'ml-6 border-l-2 border-l-slate-300',
        hardWarn && !isOverdue && 'bg-amber-50/10'
      )}
    >
      {isOverdue && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-400" />
      )}
      <div className="flex-shrink-0 mt-0.5">
        {isOverdue ? (
          <AlertOctagon size={18} className="text-red-500" />
        ) : (
          <Icon size={18} className="text-slate-400" />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <button className="text-sm font-medium text-slate-900 truncate hover:text-blue-600 hover:underline text-left">
            {item.title}
          </button>
          
          <span
            className={cn(
              'inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 border',
              CATEGORY_PILL[item.category] ?? CATEGORY_PILL.ADMIN,
            )}
          >
            {CATEGORY_LABEL[item.category] ?? item.category}
          </span>
          
          {wasDeferred && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 border',
                hardWarn
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200',
              )}
            >
              <History size={10} />
              Deferred {item.deferralCount}×
            </span>
          )}
        </div>
        
        {item.detail && (
          <div className="text-xs text-slate-500 mt-1 truncate">{item.detail}</div>
        )}
        
        <div className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Clock size={11} className="text-slate-400" />
            <span>{fmtMin(item.estMin)}</span>
          </div>
          <span className="text-slate-300">|</span>
          <span className={cn(isOverdue && 'text-red-600 font-medium')}>{item.reasonText}</span>
        </div>

        {hardWarn && (
          <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 px-2 py-1.5 inline-block">
            Deferred twice already — priority scheduling required.
          </div>
        )}
      </div>
    </div>
  );
}

function TodaysPlanCard() {
  const items = todaysPlan.items;
  const visibleItemCount = items.filter((i) => i.kind !== 'unclear_gate').length;

  return (
    <div className="border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight">Today's plan</h2>
          <div className="h-4 w-px bg-slate-300"></div>
          <p className="text-sm text-slate-600">{todaysPlan.displayLabel}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-slate-600 flex items-center gap-1.5">
            <span>{visibleItemCount} items</span>
            <span className="text-slate-300">|</span>
            <span className="tabular-nums font-medium">{fmtMin(todaysPlan.totalPlannedMin)}</span>
            <span className="text-slate-400">/ {fmtMin(todaysPlan.minutesAvailable)} available</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled
              className="w-7 h-7 flex items-center justify-center border border-slate-200 text-slate-300 cursor-not-allowed bg-white"
              aria-label="Previous day"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 transition-colors bg-white"
              aria-label="Next day"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div>
        {items.map((item, i) => (
          <div key={`${item.kind}:${item.refId ?? i}`}>
            {item.kind === 'unclear_gate' ? (
              <div className="p-4 border-b border-slate-200"><UnclearGateBlock item={item} /></div>
            ) : (
              <ItemRow item={item} />
            )}
          </div>
        ))}
        {todaysPlan.bufferMin > 10 && (
          <div className="flex items-start gap-2 text-xs text-slate-500 p-4 bg-slate-50/50">
            <Info size={14} className="mt-0.5 text-slate-400 flex-shrink-0" />
            <p>
              <span className="font-medium text-slate-700">{fmtMin(todaysPlan.bufferMin)} spare</span> after today's plan. Your inbox is on track and nothing else is due today.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Main component --------------------------------------------------------
export default function CalmClinical() {
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

  const theme = STATUS_THEME[status];

  return (
    <div className="home-redesign-scope min-h-screen bg-[#F8F9FA] text-slate-800 font-sans">
      {/* Top clinical branding bar */}
      <div className="h-1 bg-blue-600 w-full" />
      
      <div className="max-w-[1000px] mx-auto p-8">
        <div className="space-y-8">
          
          {/* Header Area */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">Good morning, Dr. Morgan</h1>
              <p className="text-sm text-slate-500 mt-1">
                Your workstation summary for today.
              </p>
            </div>
            
            {/* Priority summary */}
            <div className="flex items-center gap-2 border border-slate-200 bg-white p-1.5 shadow-sm">
              <span className="text-xs text-slate-500 font-medium px-2 uppercase tracking-wide">Inbox</span>
              <div className="w-px h-4 bg-slate-200 mx-1"></div>
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
                  <div
                    key={key}
                    className={cn(
                      'flex items-center gap-1.5 text-[11px] font-medium px-2 py-1',
                      zero
                        ? 'text-slate-400 opacity-60'
                        : PRIORITY_PILL[key]
                    )}
                  >
                    <span className="tabular-nums font-semibold">{count}</span>
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Status banner */}
          <div className={cn("border bg-white shadow-sm flex items-start gap-4 p-4", theme.border, theme.bg.replace('/30', '/10'))}>
            <div className={cn("mt-0.5", theme.icon)}>
              <Info size={20} />
            </div>
            <div className="space-y-1 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status</p>
              <p className={cn("text-[15px] font-medium", theme.text)}>{statusHeadline}</p>
              <p className="text-sm text-slate-600">{statusDetail}</p>
            </div>
            <button className="text-xs text-blue-600 font-medium hover:text-blue-800 transition-colors mt-1">
              Detailed view &rarr;
            </button>
          </div>

          {/* Today's plan */}
          <TodaysPlanCard />

          {/* Availability panel */}
          <div className="border border-slate-200 bg-white shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                  <Settings2 size={16} className="text-slate-400" />
                  Adjust this week's availability
                  {savedFlash && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 ml-2">
                      <Check size={10} /> Saved
                    </span>
                  )}
                </h3>
                <p className="text-[13px] text-slate-500 mt-1 ml-6">
                  Set different time for each day. Total this week: <strong className="text-slate-700 font-medium">{fmtMins(draftTotalMins)}</strong>.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {draftDays.length > 1 && (
                  <button className="text-xs text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1.5 border border-slate-200 bg-white px-2 py-1.5">
                    <RotateCcw size={12} /> Spread evenly
                  </button>
                )}
                <button className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1.5">
                  <RotateCcw size={12} /> Re-run weekly brief
                </button>
              </div>
            </div>

            <div className="p-5">
              <div className="flex border border-slate-200 divide-x divide-slate-200">
                {ALL_DAYS.map((d) => {
                  const mins = draftMinutesByDay[d];
                  const active = mins != null && mins > 0;
                  return (
                    <div
                      key={d}
                      className={cn(
                        'flex-1 flex flex-col items-center p-3 transition-colors',
                        active ? 'bg-blue-50/30' : 'bg-slate-50/50'
                      )}
                    >
                      <button
                        onClick={() => toggleDraftDay(d)}
                        className={cn(
                          'text-sm font-medium mb-3',
                          active ? 'text-blue-700' : 'text-slate-400'
                        )}
                      >
                        {d}
                      </button>
                      {active ? (
                        <>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => adjustDayMins(d, -15)}
                              className="w-6 h-6 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 flex items-center justify-center transition-colors"
                              aria-label={`Decrease ${d} by 15 min`}
                            >
                              <Minus size={12} />
                            </button>
                            <span className="text-[13px] font-medium text-slate-900 w-12 text-center tabular-nums">
                              {fmtMins(mins!)}
                            </span>
                            <button
                              onClick={() => adjustDayMins(d, 15)}
                              className="w-6 h-6 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 flex items-center justify-center transition-colors"
                              aria-label={`Increase ${d} by 15 min`}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-2">±15 min</div>
                        </>
                      ) : (
                        <div className="text-[12px] text-slate-400 py-2">Off</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {dirty && (
              <div className="px-5 py-3 border-t border-amber-200 bg-amber-50/50 flex items-center justify-between">
                <p className="text-xs text-amber-800 font-medium flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  Unsaved changes
                </p>
                <div className="flex items-center gap-3">
                  <button className="text-xs text-slate-600 hover:text-slate-900 font-medium">
                    Discard
                  </button>
                  <button className="bg-blue-600 text-white text-xs font-medium px-4 py-1.5 hover:bg-blue-700 transition-colors shadow-sm">
                    Save changes
                  </button>
                </div>
              </div>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}
