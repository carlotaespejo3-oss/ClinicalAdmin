import { useState } from 'react';
import { CalendarDays, Sparkles, Loader2, ShieldCheck, Clock, AlertTriangle, Users, CalendarClock, ClipboardList, FileText, Gavel, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useAiComplete } from '@workspace/api-client-react';
import { GeneratedPlan, PlanBlockCategory, PlanDay } from '@/lib/types';
import { cn } from '@/lib/utils';
import { WeekSetup } from '@/pages/ClinAdmin';
import { emails, manualTasks } from '@/lib/data';
import { useLinkedDocTasks } from '@/lib/linkedDocTasksStore';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { useArchivedEmails } from '@/lib/archivedStore';

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
  const linkedDocTasks = useLinkedDocTasks();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const [hours, setHours] = useState(weekSetup ? String(weekSetup.hours) : '4');
  const [days, setDays] = useState(weekSetup ? weekSetup.days.join(', ') : 'Tue, Wed, Thu');
  const [generating, setGenerating] = useState(false);

  // Document/form detection summary: count auto-created doc tasks that are
  // still open (linked email is not yet archived/acknowledged and the task
  // itself isn't done). Each one is a single 20/30 min combined block.
  const docSummary = (() => {
    let count = 0;
    let mins = 0;
    for (const t of linkedDocTasks.values()) {
      if (t.done) continue;
      if (acknowledged.has(t.linkedEmailId)) continue;
      if (archived.has(t.linkedEmailId)) continue;
      count++;
      mins += t.estMin;
    }
    return { count, mins };
  })();

  const handleGenerate = async () => {
    setGenerating(true);
    // Only send emails that are still active (not acknowledged or archived)
    // — settled items should not consume capacity in next week's plan.
    const activeEmails = emails.filter(
      e => !acknowledged.has(e.id) && !archived.has(e.id),
    );
    const emailPayload = activeEmails.map(e => ({
      id: e.id, from: e.from, subject: e.subject, risk: e.risk,
      cat: e.cat, deadline: e.deadline, estMin: e.estMin,
    }));
    const taskPayload = manualTasks
      .filter(t => !t.done)
      .map(t => ({
        id: t.id, title: t.title, estMin: t.estMin,
        priority: t.risk === 'high' ? 'high' : 'normal',
      }));

    // Linked tasks payload: auto-detected document tasks (still open & email
    // still active) AND any hand-authored manual task with linkedEmailId
    // pointing at an active email. The packer uses these to keep email +
    // task on the same day and never split them across days.
    type LinkedTaskPayload = {
      emailId: number; taskId: string; title: string;
      estMin: number; isLinkedDoc: boolean;
    };
    const linkedPayload: LinkedTaskPayload[] = [];
    for (const t of linkedDocTasks.values()) {
      if (t.done) continue;
      if (acknowledged.has(t.linkedEmailId)) continue;
      if (archived.has(t.linkedEmailId)) continue;
      linkedPayload.push({
        emailId: t.linkedEmailId, taskId: t.id, title: t.title,
        estMin: t.estMin, isLinkedDoc: true,
      });
    }
    const seen = new Set(linkedPayload.map(l => l.emailId));
    for (const t of manualTasks) {
      if (t.done || !t.linkedEmailId) continue;
      if (seen.has(t.linkedEmailId)) continue;
      if (acknowledged.has(t.linkedEmailId)) continue;
      if (archived.has(t.linkedEmailId)) continue;
      linkedPayload.push({
        emailId: t.linkedEmailId, taskId: t.id, title: t.title,
        estMin: t.estMin, isLinkedDoc: false,
      });
    }

    const h = parseFloat(hours) || 4;
    const daysArr = days.split(',').map(d => d.trim()).filter(Boolean);
    const minutesByDay = weekSetup?.minutesByDay;

    try {
      const resp = await fetch('/api/clinadmin/weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours: h,
          days: daysArr,
          minutesByDay,
          emails: emailPayload,
          tasks: taskPayload,
          linkedTasks: linkedPayload,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { plan: GeneratedPlan };
      onPlanGenerated(data.plan);
    } catch {
      // Fallback: use ai/complete with text prompt
      const highRiskCount = emailPayload.filter(e => e.risk === 'high').length;
      aiComplete.mutate({ data: {
        prompt: `Generate a day-by-day admin plan for Dr. A. Patterson. ${h}h across ${days}. ${emailPayload.length} inbox emails (${highRiskCount} high-risk). ${taskPayload.length} manual tasks. Return structured text with Day, Task, Time, Reason columns. End with safety summary. Max 250 words.`,
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
            <p className="text-xs text-muted-foreground" data-testid="weekly-plan-availability-summary">
              {(() => {
                const totalMins = Math.round(weekSetup.hours * 60);
                const overrides = weekSetup.minutesByDay ?? {};
                const evenSplit = weekSetup.days.length > 0 ? Math.round(totalMins / weekSetup.days.length) : 0;
                return weekSetup.days.map(d => {
                  const m = overrides[d] != null ? overrides[d] : evenSplit;
                  return `${d} ${fmtMins(m)}`;
                }).join(' · ');
              })()}
            </p>
            <p className="text-[10px] text-muted-foreground">{weekSetup.hours}h total this week</p>
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

      {/* Document summary — surfaces auto-detected document/form work.
          Prefer the server-returned summary (in sync with the actual
          packed plan) when available, otherwise fall back to the live
          client-side count. */}
      {(() => {
        const ds = plan?.docSummary ?? (docSummary.count > 0 ? docSummary : null);
        if (!ds || ds.count === 0) return null;
        return (
          <div
            className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex items-center gap-3"
            data-testid="weekly-doc-summary"
          >
            <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center text-base flex-shrink-0">
              📄
            </div>
            <p className="text-sm text-purple-800">
              <strong>
                Includes {ds.count} document{ds.count === 1 ? '' : 's'} or
                form{ds.count === 1 ? '' : 's'} to complete — estimated{' '}
                {fmtMins(ds.mins)} additional.
              </strong>{' '}
              Each one is scheduled on the same day as the email it belongs
              to, so the pair is never split across days.
            </p>
          </div>
        );
      })()}

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{plan.days.reduce((a, d) => a + d.blocks.length, 0)}</p>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">Items scheduled</p>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{fmtMins(plan.days.reduce((a, d) => a + d.totalMin, 0))}</p>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">Total admin time</p>
            </div>
            <div
              className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center"
              data-testid="weekly-buffer-stat"
            >
              <p className="text-2xl font-bold text-amber-700">
                {plan.bufferMin != null ? fmtMins(plan.bufferMin) : '—'}
              </p>
              <p className="text-xs text-amber-700 font-medium mt-0.5 leading-snug">
                Buffer for unexpected urgent emails
              </p>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{plan.deferredItems?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">Deferred items</p>
            </div>
          </div>

          {plan.bufferMin != null && (
            <p
              className="text-xs text-muted-foreground text-center"
              data-testid="weekly-buffer-line"
            >
              Buffer for unexpected urgent emails:{' '}
              <strong className="text-amber-700">{fmtMins(plan.bufferMin)}</strong>
              {' '}— each day is filled to 80% of its capacity, leaving the
              remaining 20% free for items that arrive during the week.
            </p>
          )}
        </>
      )}
    </div>
  );
}
