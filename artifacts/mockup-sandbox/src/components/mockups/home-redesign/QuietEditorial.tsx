import './_group.css';
import React, { useState } from 'react';
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
} from 'lucide-react';

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

const CATEGORY_COLOR: Record<string, string> = {
  SAFEGUARDING: 'text-red-700',
  URGENT_CLINICAL: 'text-red-700',
  LEGAL: 'text-purple-700',
  CLINICAL: 'text-blue-700',
  PROFESSIONAL: 'text-indigo-700',
  ADMIN: 'text-slate-600',
  CPD: 'text-emerald-700',
  NONE: 'text-slate-500',
  UNCLEAR: 'text-amber-700',
};

type OverallStatus = 'green' | 'amber' | 'red';
const STATUS_THEME: Record<OverallStatus, { dot: string; text: string }> = {
  green: { dot: 'bg-green-500', text: 'text-green-700' },
  amber: { dot: 'bg-[#d97706]', text: 'text-[#92400e]' }, // Warm amber/clay
  red: { dot: 'bg-red-500', text: 'text-red-700' },
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

// ---- Inline subcomponents ---------------------------------------------------

function UnclearGateBlock({ item }: { item: PlanItem }) {
  return (
    <div className="py-4 border-b border-[#e5e1d8] last:border-0 relative">
      <div className="absolute left-0 top-4 bottom-4 w-1 bg-[#d97706] rounded-r-sm opacity-60"></div>
      <div className="pl-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-[#92400e]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[#451a03] font-serif tracking-wide">{item.title}</div>
            <div className="text-sm text-[#78350f] mt-0.5 mb-3">{item.detail}</div>
            
            <ul className="space-y-px">
              {unclearEmails.map((e, i) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 text-left bg-white/50 border border-[#e5e1d8] rounded px-3 py-2 hover:bg-white transition-colors"
                  >
                    <span className="text-[10px] font-bold text-[#92400e] uppercase tracking-widest flex-shrink-0 w-8">
                      {i + 1} / {unclearEmails.length}
                    </span>
                    <Mail size={14} className="text-[#92400e] flex-shrink-0 opacity-70" />
                    <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2">
                      <div className="text-sm font-medium text-[#451a03] truncate">{e.subject}</div>
                      <div className="text-xs text-[#78350f] truncate max-w-[120px]">{e.from}</div>
                    </div>
                    <ChevronRight size={14} className="text-[#92400e] flex-shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
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
    <div className={cn(
      "py-4 border-b border-[#e5e1d8] last:border-0 relative transition-colors hover:bg-black/[0.01]",
      isLinked && 'pl-8'
    )}>
      {isOverdue && <div className="absolute left-0 top-4 bottom-4 w-1 bg-red-600 rounded-r-sm opacity-60"></div>}
      {hardWarn && !isOverdue && <div className="absolute left-0 top-4 bottom-4 w-1 bg-[#d97706] rounded-r-sm opacity-60"></div>}
      
      <div className={cn("flex items-start gap-4", (isOverdue || hardWarn) && "pl-4")}>
        <div className="flex-shrink-0 mt-1">
          {isOverdue ? (
            <AlertOctagon size={18} className="text-red-700" />
          ) : (
            <Icon size={18} className="text-slate-400" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
            <span className="text-base font-medium text-[#1c212b]">{item.title}</span>
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              CATEGORY_COLOR[item.category] || CATEGORY_COLOR.ADMIN
            )}>
              {CATEGORY_LABEL[item.category] || item.category}
            </span>
            
            {wasDeferred && (
              <span className={cn(
                "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest ml-1",
                hardWarn ? "text-[#92400e]" : "text-slate-500"
              )}>
                <History size={10} />
                Deferred {item.deferralCount}×
              </span>
            )}
          </div>
          
          {item.detail && (
            <div className="text-sm text-[#4b5563] mt-0.5 mb-1.5 leading-relaxed">{item.detail}</div>
          )}
          
          <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
            <span className="flex items-center gap-1"><Clock size={12} className="opacity-70"/> {fmtMin(item.estMin)}</span>
            <span className="text-slate-300">|</span>
            <span className={cn(
              "font-medium",
              isOverdue ? 'text-red-700' : 'text-slate-500'
            )}>{item.reasonText}</span>
          </div>
          
          {hardWarn && (
            <div className="mt-2.5 text-sm text-[#92400e] bg-[#fef3c7]/50 border border-[#fde68a] rounded px-3 py-2 font-serif italic">
              Deferred twice already — must be scheduled this week.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TodaysPlanCard() {
  const theme = STATUS_THEME[status];
  const items = todaysPlan.items;

  return (
    <div className="mt-12">
      <div className="flex items-end justify-between border-b-2 border-[#1c212b] pb-3 mb-2">
        <div className="flex items-baseline gap-4">
          <h2 className="text-2xl font-serif text-[#1c212b]">Today's Agenda</h2>
          <span className="text-sm text-slate-500 font-medium">{todaysPlan.displayLabel}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-0.5">Planned / Available</div>
            <div className="text-sm font-medium tabular-nums text-[#1c212b]">
              {fmtMin(todaysPlan.totalPlannedMin)} <span className="text-slate-400 font-normal mx-0.5">/</span> {fmtMin(todaysPlan.minutesAvailable)}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="w-8 h-8 flex items-center justify-center rounded border border-[#e5e1d8] text-slate-300 cursor-not-allowed">
              <ChevronLeft size={16} />
            </button>
            <button className="w-8 h-8 flex items-center justify-center rounded border border-[#d1ccc0] text-[#1c212b] hover:bg-[#ebe6db] transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-[#fcfbf9]">
        {items.map((item, i) => (
          <React.Fragment key={`${item.kind}:${item.refId ?? i}`}>
            {item.kind === 'unclear_gate' ? <UnclearGateBlock item={item} /> : <ItemRow item={item} />}
          </React.Fragment>
        ))}
      </div>
      
      {todaysPlan.bufferMin > 10 && (
        <div className="mt-4 flex items-start gap-2 text-sm text-slate-500 italic font-serif">
          <HelpCircle size={14} className="mt-0.5 opacity-70" />
          <p>
            {fmtMin(todaysPlan.bufferMin)} spare after today's plan — your inbox is on track and nothing else is due today.
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Main component --------------------------------------------------------
export default function QuietEditorial() {
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

  const statusTheme = STATUS_THEME[status];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&family=Inter:wght@400;500;600;700&display=swap');
        
        .variant-quiet-editorial {
          background-color: #f7f5ef; /* Parchment off-white */
          color: #1c212b; /* Deep ink blue/black */
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
        }
        
        .variant-quiet-editorial h1,
        .variant-quiet-editorial h2,
        .variant-quiet-editorial h3,
        .variant-quiet-editorial .font-serif {
          font-family: 'Newsreader', serif;
        }
      `}</style>
      
      <div className="home-redesign-scope variant-quiet-editorial">
        <div className="max-w-4xl mx-auto p-8 lg:p-12 lg:pt-16">
          
          <header className="mb-12">
            <div className="flex items-center gap-3 text-sm font-medium text-slate-500 uppercase tracking-widest mb-6">
              <Sun size={16} className="text-[#d97706]" />
              <span>Morning Briefing</span>
            </div>
            
            <h1 className="text-4xl lg:text-5xl font-medium text-[#0f172a] tracking-tight mb-4">
              Good morning, Dr. Morgan.
            </h1>
            
            <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-6 text-lg text-[#334155] font-serif italic border-l-2 border-[#d1ccc0] pl-4">
              <p>Here is your plan for today.</p>
              <div className="flex items-center gap-1.5 text-sm not-italic font-sans">
                <span className={cn("w-2 h-2 rounded-full", statusTheme.dot)}></span>
                <span className="font-medium text-[#1c212b]">Status: {statusHeadline}</span>
                <span className="text-slate-400 mx-1">—</span>
                <span className="text-slate-600">{statusDetail}</span>
              </div>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-6 mb-8 border-y border-[#e5e1d8] py-4">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Inbox Priority</div>
            <div className="flex gap-6">
              {[
                { key: 'High' as const, label: 'Urgent', color: 'text-red-700', dot: 'bg-red-500' },
                { key: 'Medium' as const, label: 'Medium', color: 'text-[#92400e]', dot: 'bg-[#d97706]' },
                { key: 'Low' as const, label: 'Low', color: 'text-slate-600', dot: 'bg-slate-400' },
              ].map(({ key, label, color, dot }) => {
                const count = priorityCounts[key];
                const zero = count === 0;
                return (
                  <div key={key} className={cn("flex items-center gap-2", zero && "opacity-50 grayscale")}>
                    <span className={cn("w-2 h-2 rounded-full", dot)}></span>
                    <span className="text-sm font-medium text-[#1c212b]">{label} <span className={cn("ml-1 font-bold", color)}>{count}</span></span>
                  </div>
                );
              })}
            </div>
          </div>

          <TodaysPlanCard />

          <div className="mt-16 pt-8 border-t border-[#e5e1d8]">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-2xl font-serif text-[#1c212b] flex items-center gap-3">
                  Availability <span className="text-[#d1ccc0] font-sans font-light">/</span> This Week
                  {savedFlash && (
                    <span className="text-xs font-sans font-bold text-green-700 uppercase tracking-widest bg-green-50 px-2 py-0.5 rounded ml-2">Saved</span>
                  )}
                </h3>
                <p className="text-sm text-slate-500 mt-1">Adjust your daily admin capacity. Total: <span className="font-semibold text-[#1c212b]">{fmtMins(draftTotalMins)}</span>.</p>
              </div>
              <div className="flex gap-4">
                <button className="text-sm font-medium text-[#1c212b] hover:text-slate-600 flex items-center gap-1.5 transition-colors">
                  <RotateCcw size={14} className="opacity-70" /> Re-run brief
                </button>
                {draftDays.length > 1 && (
                  <button className="text-sm font-medium text-[#1c212b] hover:text-slate-600 transition-colors">
                    Spread evenly
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-px bg-[#e5e1d8] border border-[#e5e1d8] rounded overflow-hidden">
              {ALL_DAYS.map((d) => {
                const mins = draftMinutesByDay[d];
                const active = mins != null && mins > 0;
                return (
                  <div key={d} className="bg-[#f7f5ef] p-4 flex flex-col items-center">
                    <button
                      onClick={() => toggleDraftDay(d)}
                      className={cn(
                        "text-sm font-bold uppercase tracking-widest mb-4 transition-colors",
                        active ? "text-[#1c212b]" : "text-slate-400"
                      )}
                    >
                      {d}
                    </button>
                    
                    {active ? (
                      <div className="flex items-center justify-between w-full">
                        <button
                          onClick={() => adjustDayMins(d, -15)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-[#1c212b] transition-colors"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="text-base font-serif font-medium text-[#1c212b]">{fmtMins(mins!)}</span>
                        <button
                          onClick={() => adjustDayMins(d, 15)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-[#1c212b] transition-colors"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400 italic font-serif py-1">Off</div>
                    )}
                  </div>
                );
              })}
            </div>

            {dirty && (
              <div className="mt-4 p-4 bg-white/50 border border-[#e5e1d8] rounded flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-[#92400e] font-medium">
                  <AlertTriangle size={14} />
                  Unsaved changes
                </div>
                <div className="flex gap-3">
                  <button className="text-sm font-medium text-slate-500 hover:text-[#1c212b] transition-colors px-2">Discard</button>
                  <button className="text-sm font-bold text-white bg-[#1c212b] px-4 py-1.5 rounded hover:bg-[#334155] transition-colors">Save updates</button>
                </div>
              </div>
            )}
          </div>
          
        </div>
      </div>
    </>
  );
}
