import { useState, useEffect } from 'react';
import { RefreshCcw, Sparkles, ChevronRight, AlertTriangle, Clock, Inbox, ShieldCheck, Loader2, Phone, Mail, FileText, Users, CalendarClock, Gavel, ClipboardList, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import { histEmails, scanSteps } from '@/lib/data';
import { cn } from '@/lib/utils';
import { useAiComplete } from '@workspace/api-client-react';

type AbsenceType = 'annual' | 'sick' | 'maternity' | 'study' | 'other';
type AbsenceDuration = '1w' | '2w' | '4w' | '3m' | 'longer';

interface FormData {
  absenceType: AbsenceType;
  duration: AbsenceDuration;
  extraCapacity: string;
}

const ABSENCE_LABELS: Record<AbsenceType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  maternity: 'Maternity / paternity',
  study: 'Study leave',
  other: 'Other',
};

const DURATION_LABELS: Record<AbsenceDuration, string> = {
  '1w': '1 week',
  '2w': '2 weeks',
  '4w': '3–4 weeks',
  '3m': '1–3 months',
  'longer': 'Longer',
};

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

const CAT_ICON: Record<string, any> = {
  'Urgent clinical': AlertTriangle,
  'Requires clinical assessment': Phone,
  'Professional — high priority': Users,
  'Needs clinician review': FileText,
  'Meeting / event deadline': CalendarClock,
  'Medico-legal': Gavel,
  'Admin only': ClipboardList,
  default: Mail,
};

const RISK_CONFIG = {
  high:   { label: 'Immediate — Act Today',     dot: 'bg-red-500',   badge: 'bg-red-50 text-red-700 border-red-200',   bar: 'border-l-red-500',   heading: 'text-red-700' },
  medium: { label: 'This Week',                  dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'border-l-amber-400', heading: 'text-amber-700' },
  low:    { label: 'Next 2 Weeks',               dot: 'bg-slate-300', badge: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'border-l-slate-300',  heading: 'text-slate-500' },
};

const WEEK_COLOURS = [
  { bg: 'bg-red-50', border: 'border-red-200', heading: 'text-red-700', badge: 'bg-red-100 text-red-800', dot: 'bg-red-400' },
  { bg: 'bg-amber-50', border: 'border-amber-200', heading: 'text-amber-700', badge: 'bg-amber-100 text-amber-800', dot: 'bg-amber-400' },
  { bg: 'bg-blue-50', border: 'border-blue-200', heading: 'text-blue-700', badge: 'bg-blue-100 text-blue-800', dot: 'bg-blue-400' },
];

const highItems   = histEmails.filter(e => e.risk === 'high');
const medItems    = histEmails.filter(e => e.risk === 'medium');
const lowItems    = histEmails.filter(e => e.risk === 'low' || e.risk === 'none');
const totalMins   = histEmails.reduce((a, e) => a + e.estMin, 0);
const breachCount = histEmails.filter(e => e.deadline !== null && e.deadline <= 0).length;

// Pre-compute week plan (static for mock)
const WEEK_PLAN = [
  {
    label: 'Week 1 — Return Week',
    sublabel: 'High-risk & time-critical items',
    items: highItems.concat(medItems.slice(0, 2)),
    totalMin: highItems.concat(medItems.slice(0, 2)).reduce((a, e) => a + e.estMin, 0),
    note: 'Phone calls first — do not email on unsafe items.',
  },
  {
    label: 'Week 2',
    sublabel: 'Professional, clinical & legal',
    items: medItems.slice(2),
    totalMin: medItems.slice(2).reduce((a, e) => a + e.estMin, 0),
    note: 'Aim for one admin block of 2–3h on Tuesday and Thursday.',
  },
  {
    label: 'Week 3',
    sublabel: 'Admin, scheduling & low-priority',
    items: lowItems,
    totalMin: lowItems.reduce((a, e) => a + e.estMin, 0),
    note: 'Batch admin tasks where possible to minimise context-switching.',
  },
];

function BacklogItem({ email, idx }: { email: (typeof histEmails)[0]; idx: number }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const Icon = CAT_ICON[email.cat] ?? CAT_ICON.default;
  const risk = RISK_CONFIG[email.risk as 'high' | 'medium' | 'low'] ?? RISK_CONFIG.low;
  const breached = email.deadline !== null && email.deadline <= 0;

  return (
    <div className={cn(
      "border-l-4 border border-border rounded-xl overflow-hidden transition-all",
      risk.bar,
      done && "opacity-40"
    )}>
      <button
        className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50/60 transition-colors text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className={cn(
          "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors",
          done ? "bg-green-500 border-green-500" : "border-muted-foreground/40"
        )}
          onClick={e => { e.stopPropagation(); setDone(v => !v); }}
        >
          {done && <Check size={10} className="text-white" />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={cn("text-sm font-bold leading-snug", done && "line-through")}>{email.from}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{email.subject}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {breached && (
                <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1">
                  <AlertTriangle size={8} /> BREACHED
                </span>
              )}
              <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">{email.date}</span>
              <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">{email.estMin}min</span>
              {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border", risk.badge)}>
              <Icon size={8} /> {email.cat}
            </span>
            {email.deadline !== null && email.deadline > 0 && (
              <span className="text-[10px] text-muted-foreground font-medium">Deadline: {email.deadline}d</span>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-border bg-slate-50/40">
          <p className="text-sm text-foreground leading-relaxed mt-3">{email.body}</p>
          <div className="flex gap-2 mt-3">
            <button className="text-xs font-bold text-primary bg-primary/8 border border-primary/25 px-3 py-1.5 rounded-lg hover:bg-primary/15 transition-colors flex items-center gap-1.5">
              <Sparkles size={11} /> Generate reply
            </button>
            <button
              onClick={e => { e.stopPropagation(); setDone(true); setOpen(false); }}
              className="text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors flex items-center gap-1.5"
            >
              <Check size={11} /> Mark handled
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CatchUpTab() {
  const [step, setStep] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [activeStepText, setActiveStepText] = useState(scanSteps[0]);
  const [form, setForm] = useState<FormData>({ absenceType: 'annual', duration: '2w', extraCapacity: '2' });
  const [aiPlan, setAiPlan] = useState<string | null>(null);
  const [expandedRisk, setExpandedRisk] = useState<'high' | 'medium' | 'low' | null>('high');
  const aiComplete = useAiComplete();

  useEffect(() => {
    if (step !== 1) return;
    const interval = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => setStep(2), 600);
          return 100;
        }
        const next = prev + 1.4;
        const capped = Math.min(next, 100);
        const idx = Math.min(Math.floor((capped / 100) * scanSteps.length), scanSteps.length - 1);
        setActiveStepText(scanSteps[idx]);
        return capped;
      });
    }, 40);
    return () => clearInterval(interval);
  }, [step]);

  const handleGenerateAiPlan = () => {
    const backlogDesc = histEmails
      .map(e => `- [${e.risk.toUpperCase()}] ${e.from}: "${e.subject}" (${e.date}, ~${e.estMin}min, deadline: ${e.deadline ?? 'none'}d)`)
      .join('\n');
    aiComplete.mutate({ data: {
      prompt: `Catch-up plan for Dr. A. Patterson returning from ${DURATION_LABELS[form.duration]} ${ABSENCE_LABELS[form.absenceType]}.
Extra capacity: ${form.extraCapacity}h/week above normal.
Backlog (${histEmails.length} items):
${backlogDesc}

Write a detailed 3-week staged return plan. Week 1: immediate safety actions. Week 2: professional/clinical catch-up. Week 3: admin clearance. Include specific actions and safety note. British English. Max 250 words.`,
    }}, { onSuccess: res => setAiPlan(res.text) });
  };

  // Step 0: Welcome form
  if (step === 0) {
    return (
      <div className="max-w-xl mx-auto py-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-3">
            <RefreshCcw size={26} />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Welcome back, Dr. Patterson</h2>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
            Let's scan your clinical inbox and build a safe, staged plan to clear the backlog from your absence.
          </p>
        </div>

        <div className="bg-white border border-border rounded-2xl shadow-sm p-6 space-y-5">
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Type of absence</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(ABSENCE_LABELS) as [AbsenceType, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setForm(f => ({ ...f, absenceType: key }))}
                  className={cn(
                    "py-2 px-3 rounded-xl text-xs font-bold transition-all border-2 text-center",
                    form.absenceType === key
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-muted-foreground border-border hover:border-primary/40"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">How long were you away?</p>
            <div className="flex gap-2">
              {(Object.entries(DURATION_LABELS) as [AbsenceDuration, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setForm(f => ({ ...f, duration: key }))}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2 text-center",
                    form.duration === key
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-muted-foreground border-border hover:border-primary/40"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Extra catch-up capacity (hours/week)</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                max="10"
                step="0.5"
                value={form.extraCapacity}
                onChange={e => setForm(f => ({ ...f, extraCapacity: e.target.value }))}
                className="w-28 border border-border rounded-xl px-4 py-2.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
              />
              <span className="text-sm text-muted-foreground">hours above your normal weekly admin time</span>
            </div>
          </div>

          <button
            onClick={() => setStep(1)}
            className="w-full bg-primary text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-primary/90 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
          >
            <Sparkles size={17} /> Start clinical scan <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // Step 1: Scan animation
  if (step === 1) {
    return (
      <div className="max-w-md mx-auto py-20 flex flex-col items-center gap-8 animate-in fade-in duration-300">
        <div className="relative w-24 h-24">
          <div className="absolute inset-0 rounded-full border-8 border-primary/10 border-t-primary animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="text-primary animate-pulse" size={28} />
          </div>
        </div>
        <div className="text-center space-y-3 w-full">
          <h3 className="text-xl font-bold">Scanning clinical backlog...</h3>
          <p className="text-sm font-semibold text-primary h-5">{activeStepText}</p>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-100"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{Math.round(scanProgress)}% complete</p>
        </div>
      </div>
    );
  }

  // Step 2: Full results
  const doneCount = 0; // would be tracked in real app

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Catch-up Overview</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {DURATION_LABELS[form.duration]} {ABSENCE_LABELS[form.absenceType]} · {histEmails.length} items found · 3-week clearance plan
          </p>
        </div>
        <button
          onClick={() => { setStep(0); setScanProgress(0); setAiPlan(null); }}
          className="text-xs text-muted-foreground font-semibold flex items-center gap-1 hover:text-foreground transition-colors border border-border px-3 py-2 rounded-xl"
        >
          <RefreshCcw size={12} /> Rescan
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Inbox,         val: histEmails.length.toString(), label: 'Total items',         bg: 'bg-blue-100',  color: 'text-blue-600' },
          { icon: AlertTriangle, val: highItems.length.toString(),   label: 'Immediate action',   bg: 'bg-red-100',   color: 'text-red-600' },
          { icon: Clock,         val: fmtMins(totalMins),            label: 'Est. clearance time',bg: 'bg-amber-100', color: 'text-amber-600' },
          { icon: ShieldCheck,   val: breachCount.toString(),        label: 'Already breached',   bg: 'bg-slate-100', color: 'text-slate-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-border rounded-2xl p-4 flex items-center gap-3">
            <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", s.bg)}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className="text-xl font-bold leading-tight">{s.val}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Backlog list */}
        <div className="lg:col-span-3 space-y-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Backlog — sorted by risk</p>

          {(['high', 'medium', 'low'] as const).map(risk => {
            const items = risk === 'high' ? highItems : risk === 'medium' ? medItems : lowItems;
            const cfg = RISK_CONFIG[risk];
            const isOpen = expandedRisk === risk;
            return (
              <div key={risk} className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
                <button
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/60 transition-colors"
                  onClick={() => setExpandedRisk(isOpen ? null : risk)}
                >
                  <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", cfg.dot)} />
                  <span className={cn("text-sm font-bold", cfg.heading)}>{cfg.label}</span>
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border ml-1", cfg.badge)}>
                    {items.length} item{items.length !== 1 ? 's' : ''}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground font-medium">
                    ~{fmtMins(items.reduce((a, e) => a + e.estMin, 0))}
                  </span>
                  {isOpen ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                    {items.map((email, idx) => (
                      <BacklogItem key={email.id} email={email} idx={idx} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: 3-week plan */}
        <div className="lg:col-span-2 space-y-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">3-Week Clearance Plan</p>

          {WEEK_PLAN.map((week, wi) => {
            const col = WEEK_COLOURS[wi];
            return (
              <div key={wi} className={cn("border rounded-2xl overflow-hidden", col.border, col.bg)}>
                <div className="px-5 py-4 border-b border-inherit">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className={cn("text-sm font-bold", col.heading)}>{week.label}</p>
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", col.badge)}>
                      ~{fmtMins(week.totalMin)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{week.sublabel}</p>
                </div>
                <div className="px-5 py-3 space-y-2">
                  {week.items.map(e => (
                    <div key={e.id} className="flex items-start gap-2">
                      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5", col.dot)} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold leading-snug truncate">{e.subject}</p>
                        <p className="text-[10px] text-muted-foreground">{e.from} · {e.estMin}min</p>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground italic pt-1 border-t border-inherit mt-2">{week.note}</p>
                </div>
              </div>
            );
          })}

          {/* AI narrative plan */}
          <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-gradient-to-r from-primary to-primary/80 px-5 py-4 text-white">
              <div className="flex items-center gap-2 mb-0.5">
                <Sparkles size={15} />
                <p className="text-sm font-bold">AI Narrative Plan</p>
              </div>
              <p className="text-xs opacity-75">Personalised return strategy from Claude</p>
            </div>
            <div className="p-5">
              {!aiPlan && !aiComplete.isPending && (
                <button
                  onClick={handleGenerateAiPlan}
                  className="w-full py-3 text-sm font-bold text-primary bg-primary/8 border border-primary/25 rounded-xl hover:bg-primary/15 transition-colors flex items-center justify-center gap-2"
                >
                  <Sparkles size={15} /> Generate personalised plan
                </button>
              )}
              {aiComplete.isPending && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 size={22} className="text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground font-medium">Writing your return plan...</p>
                </div>
              )}
              {aiPlan && (
                <div className="space-y-3 animate-in fade-in duration-500">
                  <pre className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-sans">{aiPlan}</pre>
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <button
                      className="flex-1 text-xs font-bold text-primary bg-primary/8 border border-primary/20 py-2 rounded-xl hover:bg-primary/15 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Check size={12} /> Adopt plan
                    </button>
                    <button
                      onClick={() => { setAiPlan(null); handleGenerateAiPlan(); }}
                      className="text-xs font-bold text-muted-foreground border border-border px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      <RefreshCcw size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
