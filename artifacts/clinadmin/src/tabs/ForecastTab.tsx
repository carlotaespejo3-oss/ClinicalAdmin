import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, TrendingUp, CheckCircle2, Sparkles, Loader2, CalendarDays, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { emails } from '@/lib/data';
import { cn, getEmailPriority } from '@/lib/utils';
import { useAiComplete } from '@workspace/api-client-react';
import type { WeekSetup } from '../pages/ClinAdmin';

interface Props {
  weekSetup?: WeekSetup | null;
  onOpenWeeklySetup: () => void;
}

const NEW_PER_WEEK = 60;
const HIGH_SLA_DAYS = 5;
const LOW_SLA_DAYS = 14;

const fmtH = (mins: number) => {
  const h = mins / 60;
  if (h < 1) return `${Math.round(mins)}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
};

export default function ForecastTab({ weekSetup, onOpenWeeklySetup }: Props) {
  const aiComplete = useAiComplete();
  const [aiNote, setAiNote] = useState<string>('');
  const [aiError, setAiError] = useState<string>('');

  // Available hours per week (from settings, or sensible default)
  const weeklyCapacityH = weekSetup?.hours ?? 4;
  const weeklyCapacityMin = weeklyCapacityH * 60;

  // ---- Backlog by priority (using each email's actual estMin) ----
  const backlog = useMemo(() => {
    const groups = { High: [] as typeof emails, Medium: [] as typeof emails, Low: [] as typeof emails };
    for (const e of emails) {
      groups[getEmailPriority(e)].push(e);
    }
    const sumMin = (arr: typeof emails) => arr.reduce((a, e) => a + e.estMin, 0);
    return {
      High: { count: groups.High.length, mins: sumMin(groups.High) },
      Medium: { count: groups.Medium.length, mins: sumMin(groups.Medium) },
      Low: { count: groups.Low.length, mins: sumMin(groups.Low) },
    };
  }, []);

  const totalBacklogMin = backlog.High.mins + backlog.Medium.mins + backlog.Low.mins;
  const totalBacklogCount = backlog.High.count + backlog.Medium.count + backlog.Low.count;

  // ---- Average minutes per email by priority (used to project incoming workload) ----
  const avgMin = useMemo(() => {
    const safe = (m: number, c: number, fallback: number) => (c > 0 ? m / c : fallback);
    return {
      High: safe(backlog.High.mins, backlog.High.count, 15),
      Medium: safe(backlog.Medium.mins, backlog.Medium.count, 8),
      Low: safe(backlog.Low.mins, backlog.Low.count, 3),
    };
  }, [backlog]);

  // ---- Mix of incoming emails: assume the new 60/wk follow the same priority mix as backlog ----
  const mix = useMemo(() => {
    const total = totalBacklogCount || 1;
    return {
      High: backlog.High.count / total,
      Medium: backlog.Medium.count / total,
      Low: backlog.Low.count / total,
    };
  }, [backlog, totalBacklogCount]);

  const incomingPerWeek = useMemo(() => {
    const high = NEW_PER_WEEK * mix.High;
    const med = NEW_PER_WEEK * mix.Medium;
    const low = NEW_PER_WEEK * mix.Low;
    return {
      counts: { High: high, Medium: med, Low: low },
      mins: { High: high * avgMin.High, Medium: med * avgMin.Medium, Low: low * avgMin.Low },
      totalMin: high * avgMin.High + med * avgMin.Medium + low * avgMin.Low,
    };
  }, [mix, avgMin]);

  // ---- Realistic ask: this week MUST clear all High (5-day SLA) + ideally Medium + a chunk of Low ----
  // To stay inside 14-day SLA for current Low backlog, those Low items must clear within 2 weeks.
  const requiredThisWeekMin = backlog.High.mins + backlog.Medium.mins + Math.min(backlog.Low.mins, weeklyCapacityMin); // try to do as much Low as fits
  const minimumSafeThisWeekMin = backlog.High.mins; // bare minimum to avoid clinical SLA breach
  const idealTwoWeekMin = totalBacklogMin + incomingPerWeek.totalMin; // current backlog + 1 week of new mail

  const gapThisWeekMin = Math.max(0, requiredThisWeekMin - weeklyCapacityMin);
  const gapTwoWeekMin = Math.max(0, idealTwoWeekMin - weeklyCapacityMin * 2);

  // ---- Will any Low priority breach 14 days? ----
  // After 2 weeks of capacity at weeklyCapacityMin, can we clear (current Low + 2 weeks of incoming Low + High + Medium)?
  const twoWeekCapacityMin = weeklyCapacityMin * 2;
  const twoWeekDemandMin =
    backlog.High.mins +
    backlog.Medium.mins +
    backlog.Low.mins +
    incomingPerWeek.mins.High +
    incomingPerWeek.mins.Medium +
    incomingPerWeek.mins.Low;
  const willBreachLowSla = twoWeekDemandMin > twoWeekCapacityMin;
  const lowBreachMin = Math.max(0, twoWeekDemandMin - twoWeekCapacityMin);

  // ---- High SLA (5 days) — would current backlog plus this week's incoming high exceed weekly capacity for High alone? ----
  const highThisWeekMin = backlog.High.mins + incomingPerWeek.mins.High;
  const highSlaAtRisk = highThisWeekMin > weeklyCapacityMin;

  // ---- 4-week simulation ----
  const weeks = useMemo(() => {
    let curHigh = backlog.High.mins;
    let curMed = backlog.Medium.mins;
    let curLow = backlog.Low.mins;
    const out: Array<{
      label: string;
      capacityMin: number;
      clearedMin: number;
      remainingMin: number;
      incomingMin: number;
      breakdown: { high: number; med: number; low: number };
    }> = [];
    for (let w = 0; w < 4; w++) {
      // Add this week's incoming (week 0 = backlog only at start of week, plus incoming during the week)
      const incHigh = w === 0 ? 0 : incomingPerWeek.mins.High;
      const incMed = w === 0 ? 0 : incomingPerWeek.mins.Medium;
      const incLow = w === 0 ? 0 : incomingPerWeek.mins.Low;
      curHigh += incHigh;
      curMed += incMed;
      curLow += incLow;
      let cap = weeklyCapacityMin;
      // Clear High first, then Medium, then Low
      const clearH = Math.min(cap, curHigh);
      curHigh -= clearH;
      cap -= clearH;
      const clearM = Math.min(cap, curMed);
      curMed -= clearM;
      cap -= clearM;
      const clearL = Math.min(cap, curLow);
      curLow -= clearL;
      cap -= clearL;
      out.push({
        label: w === 0 ? 'This week' : w === 1 ? 'Next week' : `Week +${w}`,
        capacityMin: weeklyCapacityMin,
        clearedMin: clearH + clearM + clearL,
        remainingMin: curHigh + curMed + curLow,
        incomingMin: incHigh + incMed + incLow,
        breakdown: { high: clearH, med: clearM, low: clearL },
      });
    }
    return out;
  }, [backlog, weeklyCapacityMin, incomingPerWeek]);

  const generateNarrative = async () => {
    setAiError('');
    setAiNote('');
    const facts = `
Workload snapshot for Dr. A. Patterson (NHS CAMHS):
- ${totalBacklogCount} emails in backlog (${fmtH(totalBacklogMin)} of work)
- High priority: ${backlog.High.count} emails, ${fmtH(backlog.High.mins)}
- Medium priority: ${backlog.Medium.count} emails, ${fmtH(backlog.Medium.mins)}
- Low priority: ${backlog.Low.count} emails, ${fmtH(backlog.Low.mins)}
- Weekly admin capacity: ${weeklyCapacityH}h
- Expected new emails per week: ${NEW_PER_WEEK}
- SLA: high-risk clinical replies within 5 days, low priority within 14 days
- Required this week to clear High + Medium + as much Low as fits: ${fmtH(requiredThisWeekMin)}
- Capacity gap this week: ${gapThisWeekMin > 0 ? fmtH(gapThisWeekMin) + ' short' : 'none'}
- Two-week SLA breach risk for Low priority: ${willBreachLowSla ? `Yes — about ${fmtH(lowBreachMin)} of work will spill past 14 days` : 'No'}
- High-risk SLA risk this week: ${highSlaAtRisk ? 'Yes' : 'No'}
`;
    const prompt = `You are writing a short, plain-English workload summary for a busy NHS CAMHS consultant. British spelling. No jargon. 4-6 sentences max.\n\nUsing the facts below, write a calm, direct paragraph that:\n1. Tells her how many hours she realistically needs this week to stay safe.\n2. Tells her if there is a gap and how to handle it (carry low-priority into next week is fine; high-risk clinical work cannot wait).\n3. If a 14-day low-priority breach is likely, flag it once, gently, and suggest the simplest mitigation (e.g. add 1-2 hours next week, or accept the breach and document why).\n4. End with one specific concrete action she can do today.\n\nDo NOT repeat the numbers verbatim — interpret them. Speak to her as "you".\n\nFacts:\n${facts}`;
    try {
      const res = await aiComplete.mutateAsync({ data: { prompt } });
      setAiNote(res.text ?? '');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not generate summary.');
    }
  };

  // ---- UI ----
  const headlineNeed = requiredThisWeekMin;
  const headlineNeedH = headlineNeed / 60;
  const status: 'ok' | 'tight' | 'short' =
    weeklyCapacityMin >= requiredThisWeekMin ? 'ok' : weeklyCapacityMin >= minimumSafeThisWeekMin ? 'tight' : 'short';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Headline */}
      <Card className={cn(
        "border-2",
        status === 'ok' && "border-green-200 bg-green-50/40",
        status === 'tight' && "border-amber-200 bg-amber-50/40",
        status === 'short' && "border-red-200 bg-red-50/40",
      )}>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className={cn(
              "p-3 rounded-xl flex-shrink-0",
              status === 'ok' && "bg-green-100 text-green-700",
              status === 'tight' && "bg-amber-100 text-amber-700",
              status === 'short' && "bg-red-100 text-red-700",
            )}>
              {status === 'ok' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Workload forecast</p>
              <h2 className="text-xl font-bold mb-2">
                You realistically need <span className="text-primary">{headlineNeedH.toFixed(1)} hours</span> this week to stay on top of {totalBacklogCount} emails.
              </h2>
              <p className="text-sm text-muted-foreground">
                You have <strong className="text-foreground">{weeklyCapacityH} hours</strong> scheduled
                {weekSetup?.days?.length ? <> across {weekSetup.days.join(', ')}</> : ''}.
                {' '}
                {status === 'ok' && <span className="text-green-700 font-semibold">That's enough — you're inside both the 5-day and 14-day windows.</span>}
                {status === 'tight' && <span className="text-amber-700 font-semibold">That covers the urgent clinical work but Low-priority items will spill into next week.</span>}
                {status === 'short' && <span className="text-red-700 font-semibold">Even the urgent clinical replies won't all fit — see suggestions below.</span>}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={onOpenWeeklySetup}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity uppercase tracking-wider"
                  data-testid="button-edit-availability"
                >
                  Edit my availability
                </button>
                <button
                  onClick={generateNarrative}
                  disabled={aiComplete.isPending}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-border hover:bg-muted/50 transition-colors uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-60"
                  data-testid="button-ai-summary"
                >
                  {aiComplete.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Plain-English summary
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI narrative */}
      {(aiNote || aiError) && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <Sparkles size={16} className="text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm leading-relaxed whitespace-pre-wrap">
                {aiError ? <span className="text-destructive">{aiError}</span> : aiNote}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Priority breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {([
          { key: 'High', label: 'High priority', sla: '5-day window', tone: 'red', data: backlog.High },
          { key: 'Medium', label: 'Medium priority', sla: '7-day window', tone: 'amber', data: backlog.Medium },
          { key: 'Low', label: 'Low priority', sla: '14-day window', tone: 'slate', data: backlog.Low },
        ] as const).map((row) => (
          <Card key={row.key} className="border-border/50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded",
                  row.tone === 'red' && "bg-red-100 text-red-700",
                  row.tone === 'amber' && "bg-amber-100 text-amber-700",
                  row.tone === 'slate' && "bg-slate-100 text-slate-700",
                )}>
                  {row.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{row.sla}</span>
              </div>
              <p className="text-3xl font-bold tabular-nums">{row.data.count}</p>
              <p className="text-xs text-muted-foreground mt-1">
                emails · <strong className="text-foreground">{fmtH(row.data.mins)}</strong> of work
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* SLA flag */}
      {willBreachLowSla && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-bold text-amber-900 mb-1">Low-priority 14-day breach likely</p>
              <p className="text-amber-900/80">
                At your current {weeklyCapacityH}h/week, roughly <strong>{fmtH(lowBreachMin)}</strong> of low-priority work will spill past the 14-day mark over the next two weeks.
                That's clinically acceptable, but worth documenting. Adding about <strong>{Math.ceil(lowBreachMin / 60 / 2)}h to each of the next two weeks</strong> would close the gap.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4-week simulation */}
      <Card className="border-border/50">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp size={18} className="text-primary" />
            Four-week outlook
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Assumes ~{NEW_PER_WEEK} new emails arrive each week, in the same priority mix you're seeing now.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {weeks.map((w, i) => {
              const utilisation = w.capacityMin > 0 ? Math.min(100, (w.clearedMin / w.capacityMin) * 100) : 0;
              const overflow = w.remainingMin > 0;
              return (
                <div key={i} className="p-4 flex items-center gap-4">
                  <div className="w-28 flex-shrink-0">
                    <p className="text-sm font-bold">{w.label}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtH(w.capacityMin)} scheduled</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                      <div className="bg-red-500 h-full" style={{ width: `${(w.breakdown.high / w.capacityMin) * 100}%` }} />
                      <div className="bg-amber-500 h-full" style={{ width: `${(w.breakdown.med / w.capacityMin) * 100}%` }} />
                      <div className="bg-blue-400 h-full" style={{ width: `${(w.breakdown.low / w.capacityMin) * 100}%` }} />
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                      <span>Cleared {fmtH(w.clearedMin)} ({Math.round(utilisation)}%)</span>
                      {i > 0 && <span>· +{fmtH(w.incomingMin)} new in</span>}
                      {overflow && <span className="text-amber-700 font-semibold">· {fmtH(w.remainingMin)} carried over</span>}
                      {!overflow && i === 0 && <span className="text-green-700 font-semibold">· backlog cleared</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Methodology */}
      <Card className="border-dashed border-border/60 bg-muted/20">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1.5">
          <p className="font-bold text-foreground flex items-center gap-2"><Mail size={12} /> How this is calculated</p>
          <p>· Each email's time estimate is based on its category and complexity (current average: <strong>{avgMin.High.toFixed(0)}min</strong> high, <strong>{avgMin.Medium.toFixed(0)}min</strong> medium, <strong>{avgMin.Low.toFixed(0)}min</strong> low).</p>
          <p>· Forecast assumes ~{NEW_PER_WEEK} new emails arrive each week in the same priority mix as your current backlog.</p>
          <p>· SLA targets: high-risk clinical {HIGH_SLA_DAYS} days, low priority {LOW_SLA_DAYS} days.</p>
          <p>· "Required this week" = all High + all Medium + as much Low as fits in your scheduled hours.</p>
        </CardContent>
      </Card>
    </div>
  );
}
