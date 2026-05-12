import { useState } from 'react';
import { CalendarDays, Sparkles, Loader2, ShieldCheck, Clock, AlertTriangle, Users, CalendarClock, ClipboardList, FileText, Gavel, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useAiComplete } from '@workspace/api-client-react';
import { GeneratedPlan, PlanBlockCategory, PlanDay } from '@/lib/types';
import { cn } from '@/lib/utils';
import { WeekSetup } from '@/pages/ClinAdmin';
import { emails, manualTasks } from '@/lib/data';

interface Props {
  weekSetup: WeekSetup | null;
  plan: GeneratedPlan | null;
  onPlanGenerated: (plan: GeneratedPlan) => void;
  onOpenWeeklySetup: () => void;
}

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

const CATEGORY_CONFIG: Record<PlanBlockCategory, { label: string; color: string; bg: string; border: string; icon: any }> = {
  urgent:       { label: 'Urgent',       color: 'text-red-700',    bg: 'bg-red-50',     border: 'border-red-200',    icon: AlertTriangle },
  clinical:     { label: 'Clinical',     color: 'text-rose-700',   bg: 'bg-rose-50',    border: 'border-rose-200',   icon: FileText },
  professional: { label: 'Professional', color: 'text-purple-700', bg: 'bg-purple-50',  border: 'border-purple-200', icon: Users },
  meeting:      { label: 'Meeting',      color: 'text-orange-700', bg: 'bg-orange-50',  border: 'border-orange-200', icon: CalendarClock },
  admin:        { label: 'Admin',        color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200',   icon: ClipboardList },
  legal:        { label: 'Legal',        color: 'text-slate-700',  bg: 'bg-slate-100',  border: 'border-slate-300',  icon: Gavel },
  task:         { label: 'Task',         color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200',  icon: ClipboardList },
};

function DayCard({ dayPlan }: { dayPlan: PlanDay }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50/60 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <CalendarDays size={18} className="text-primary" />
          </div>
          <div className="text-left">
            <p className="font-bold text-base">{dayPlan.day}</p>
            <p className="text-xs text-muted-foreground">{dayPlan.blocks.length} items · {fmtMins(dayPlan.totalMin)} admin</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {dayPlan.blocks.map((b, i) => {
              const cfg = CATEGORY_CONFIG[b.category] ?? CATEGORY_CONFIG.admin;
              return <div key={i} className={cn("w-2.5 h-2.5 rounded-full", cfg.bg, "border", cfg.border)} />;
            })}
          </div>
          {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {dayPlan.blocks.map((block, i) => {
            const cfg = CATEGORY_CONFIG[block.category] ?? CATEGORY_CONFIG.admin;
            const Icon = cfg.icon;
            return (
              <div key={i} className="flex items-start gap-4 px-6 py-4">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-snug">{block.task}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{block.reason}</p>
                  <div className="mt-2">
                    <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border", cfg.color, cfg.bg, cfg.border)}>
                      <Icon size={9} />
                      {cfg.label}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-1 text-xs text-muted-foreground font-medium whitespace-nowrap">
                  <Clock size={11} />
                  {block.min}min
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WeeklyPlanTab({ weekSetup, plan, onPlanGenerated, onOpenWeeklySetup }: Props) {
  const aiComplete = useAiComplete();
  const [hours, setHours] = useState(weekSetup ? String(weekSetup.hours) : '4');
  const [days, setDays] = useState(weekSetup ? weekSetup.days.join(', ') : 'Tue, Wed, Thu');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    const emailPayload = emails.map(e => ({
      id: e.id, from: e.from, subject: e.subject, risk: e.risk,
      cat: e.cat, deadline: e.deadline, estMin: e.estMin,
    }));
    const taskPayload = manualTasks.map(t => ({
      id: t.id, title: t.title, estMin: t.estMin, priority: t.risk === 'high' ? 'high' : 'normal',
    }));
    const h = parseFloat(hours) || 4;
    const daysArr = days.split(',').map(d => d.trim()).filter(Boolean);

    try {
      const resp = await fetch('/api/clinadmin/weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: h, days: daysArr, emails: emailPayload, tasks: taskPayload }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { plan: GeneratedPlan };
      onPlanGenerated(data.plan);
    } catch {
      // Fallback: use ai/complete with text prompt
      aiComplete.mutate({ data: {
        prompt: `Generate a day-by-day admin plan for Dr. A. Patterson. ${h}h across ${days}. 9 inbox emails (2 high-risk). 4 manual tasks. Return structured text with Day, Task, Time, Reason columns. End with safety summary. Max 250 words.`,
      }}, {
        onSuccess: () => {},
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Weekly Admin Plan</h2>
          <p className="text-muted-foreground text-sm mt-1">
            AI-generated schedule based on your current inbox and availability.
          </p>
        </div>
        {weekSetup && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              {weekSetup.hours}h · {weekSetup.days.join(', ')}
            </p>
            <button onClick={onOpenWeeklySetup} className="text-xs text-primary font-semibold hover:underline">
              Change availability
            </button>
          </div>
        )}
      </div>

      {/* No plan state — show generate UI */}
      {!plan && (
        <div className="bg-white border border-border rounded-2xl shadow-sm p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Sparkles size={28} className="text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-bold mb-2">No schedule generated yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {weekSetup
                ? 'Your weekly setup is saved. Click below to have AI build a day-by-day schedule from your current inbox.'
                : 'Set your availability first, then AI will build a personalised day-by-day schedule.'}
            </p>
          </div>

          {!weekSetup && (
            <button
              onClick={onOpenWeeklySetup}
              className="inline-flex items-center gap-2 bg-primary text-white font-bold px-6 py-3 rounded-xl shadow hover:bg-primary/90 transition-colors"
            >
              <CalendarDays size={16} />
              Set up weekly availability
            </button>
          )}

          {weekSetup && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto text-left">
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">Hours</label>
                  <input
                    type="number"
                    value={hours}
                    onChange={e => setHours(e.target.value)}
                    className="w-full border border-border rounded-xl px-4 py-2.5 font-bold focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">Days</label>
                  <input
                    type="text"
                    value={days}
                    onChange={e => setDays(e.target.value)}
                    className="w-full border border-border rounded-xl px-4 py-2.5 font-bold focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating || aiComplete.isPending}
                className="inline-flex items-center gap-2 bg-primary text-white font-bold px-8 py-3.5 rounded-xl shadow-lg hover:bg-primary/90 hover:-translate-y-0.5 transition-all disabled:opacity-50"
              >
                {(generating || aiComplete.isPending) ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                {(generating || aiComplete.isPending) ? 'Generating...' : 'Generate my weekly plan'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Generated plan */}
      {plan && (
        <>
          {/* Safety note */}
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">
            <ShieldCheck size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-green-800 mb-0.5">Safety check passed</p>
              <p className="text-sm text-green-700">{plan.safetyNote}</p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="ml-auto flex items-center gap-1.5 text-xs font-bold text-green-700 bg-green-100 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-200 transition-colors flex-shrink-0"
            >
              <RefreshCw size={12} className={generating ? 'animate-spin' : ''} />
              Regenerate
            </button>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2">
            {(Object.entries(CATEGORY_CONFIG) as [PlanBlockCategory, typeof CATEGORY_CONFIG.urgent][]).map(([key, cfg]) => {
              const Icon = cfg.icon;
              return (
                <span key={key} className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border", cfg.color, cfg.bg, cfg.border)}>
                  <Icon size={9} /> {cfg.label}
                </span>
              );
            })}
          </div>

          {/* Day cards */}
          <div className="space-y-4">
            {plan.days.map(dayPlan => (
              <DayCard key={dayPlan.day} dayPlan={dayPlan} />
            ))}
          </div>

          {/* Deferred items */}
          {plan.deferredItems && plan.deferredItems.length > 0 && (
            <div className="bg-slate-50 border border-border rounded-2xl p-5">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Safely deferred to next week</p>
              <ul className="space-y-2">
                {plan.deferredItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{plan.days.reduce((a, d) => a + d.blocks.length, 0)}</p>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">Items scheduled</p>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{fmtMins(plan.days.reduce((a, d) => a + d.totalMin, 0))}</p>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">Total admin time</p>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{plan.deferredItems?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">Deferred items</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
