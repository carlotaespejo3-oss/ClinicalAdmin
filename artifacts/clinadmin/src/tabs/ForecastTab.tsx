import { useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp, CheckCircle2, Sparkles, Loader2, Mail, Wand2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { emails, CAT } from '@/lib/data';
import { cn, getEmailPriority } from '@/lib/utils';
import { useAiComplete } from '@workspace/api-client-react';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { useAiClassifications } from '@/lib/aiClassifyStore';
import { useArrivalsConfig, setArrivalsConfig, resetArrivalsConfig } from '@/lib/arrivalsConfigStore';
import { recommendArrivals } from '@/lib/arrivalsLearning';
import { DEFAULT_ARRIVAL_CONFIG } from '@/lib/planner';
import type { WeekSetup } from '../pages/ClinAdmin';
import type { GeneratedPlan } from '@/lib/types';

interface Props {
  weekSetup?: WeekSetup | null;
  plan?: GeneratedPlan | null;
  onOpenWeeklySetup: () => void;
}

function fmtMinsLong(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

const HIGH_SLA_DAYS = 5;
const LOW_SLA_DAYS = 14;

const fmtH = (mins: number) => {
  const h = mins / 60;
  if (h < 1) return `${Math.round(mins)}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
};

export default function ForecastTab({ weekSetup, plan, onOpenWeeklySetup }: Props) {
  const aiComplete = useAiComplete();
  const acknowledged = useAcknowledgedEmails();
  // Subscribe so memos below recompute when classifications stream in
  // and mutate emails[].estMin via the rules-based estimator.
  const classifications = useAiClassifications();
  const arrivalsConfig = useArrivalsConfig();
  const NEW_PER_WEEK = arrivalsConfig.emailsPerWeek;
  const [aiNote, setAiNote] = useState<string>('');
  const [aiError, setAiError] = useState<string>('');
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);

  // ---- Suggest-mode self-learning over observed email history ----
  const arrivalsSuggestion = useMemo(
    () => recommendArrivals(emails, new Date(), arrivalsConfig),
    [acknowledged, classifications, arrivalsConfig],
  );
  const showSuggestion =
    !dismissedSuggestion &&
    arrivalsSuggestion.recommendation !== null &&
    arrivalsSuggestion.diff !== null &&
    Math.abs(arrivalsSuggestion.diff.emailsPerWeekDeltaPct) >= 10;
  const showInsufficientHistory =
    !dismissedSuggestion && arrivalsSuggestion.observed === null;

  // Available hours per week (from settings, or sensible default)
  const weeklyCapacityH = weekSetup?.hours ?? 4;
  const weeklyCapacityMin = weeklyCapacityH * 60;

  // ---- Backlog by priority (using each email's actual estMin) ----
  // Acknowledged emails are excluded — they don't need clinician time.
  // CAT.NONE ("No action required") emails are noise that should be cleared with
  // the Acknowledge button — they're shown in the inbox count but excluded from
  // time totals because they don't warrant a written reply.
  const SLA_DUE_SOON_DAYS = 7; // anything with ≤7 days remaining must clear this week or it breaches 14-day SLA before next session

  const backlog = useMemo(() => {
    const active = emails.filter(e => !acknowledged.has(e.id) && e.cat !== CAT.NONE);
    const groups = { High: [] as typeof emails, Medium: [] as typeof emails, LowDueSoon: [] as typeof emails, LowDeferrable: [] as typeof emails };
    for (const e of active) {
      const p = getEmailPriority(e);
      if (p === 'High') groups.High.push(e);
      else if (p === 'Medium') groups.Medium.push(e);
      else if (e.deadline !== null && e.deadline <= SLA_DUE_SOON_DAYS) groups.LowDueSoon.push(e);
      else groups.LowDeferrable.push(e);
    }
    const sumMin = (arr: typeof emails) => arr.reduce((a, e) => a + e.estMin, 0);
    return {
      High: { count: groups.High.length, mins: sumMin(groups.High) },
      Medium: { count: groups.Medium.length, mins: sumMin(groups.Medium) },
      LowDueSoon: { count: groups.LowDueSoon.length, mins: sumMin(groups.LowDueSoon) },
      LowDeferrable: { count: groups.LowDeferrable.length, mins: sumMin(groups.LowDeferrable) },
    };
  }, [acknowledged, classifications]);

  const lowTotal = { count: backlog.LowDueSoon.count + backlog.LowDeferrable.count, mins: backlog.LowDueSoon.mins + backlog.LowDeferrable.mins };
  const totalBacklogMin = backlog.High.mins + backlog.Medium.mins + lowTotal.mins;
  const totalBacklogCount = backlog.High.count + backlog.Medium.count + lowTotal.count;
  const noiseCount = useMemo(() => emails.filter(e => !acknowledged.has(e.id) && e.cat === CAT.NONE).length, [acknowledged]);

  // ---- Average minutes per email by priority (used to project incoming workload) ----
  const avgMin = useMemo(() => {
    const safe = (m: number, c: number, fallback: number) => (c > 0 ? m / c : fallback);
    return {
      High: safe(backlog.High.mins, backlog.High.count, 15),
      Medium: safe(backlog.Medium.mins, backlog.Medium.count, 8),
      Low: safe(lowTotal.mins, lowTotal.count, 5),
    };
  }, [backlog, lowTotal]);

  // ---- Mix of incoming emails: assume the new 60/wk follow the same priority mix as backlog ----
  const mix = useMemo(() => {
    const total = totalBacklogCount || 1;
    return {
      High: backlog.High.count / total,
      Medium: backlog.Medium.count / total,
      Low: lowTotal.count / total,
    };
  }, [backlog, lowTotal, totalBacklogCount]);

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

  // ---- Realistic ask for THIS week ----
  // We compute "what must be done this week to keep every email inside its 14-day SLA":
  //   - All High (5-day clinical SLA) — clearly this week.
  //   - All Medium (7-day SLA) — this week.
  //   - All Low items whose deadline is ≤ 7 days — if these aren't done this
  //     week, they breach 14 days before the next admin session.
  // Low items with deadline > 7 days (or no deadline) are safe to defer.
  const requiredThisWeekMin = backlog.High.mins + backlog.Medium.mins + backlog.LowDueSoon.mins;
  const minimumSafeThisWeekMin = backlog.High.mins; // bare minimum to avoid clinical SLA breach
  const gapThisWeekMin = Math.max(0, requiredThisWeekMin - weeklyCapacityMin);
  const lowDeferrableMin = backlog.LowDeferrable.mins;

  // ---- Will any Low priority breach 14 days? ----
  // After 2 weeks of capacity at weeklyCapacityMin, can we clear all current backlog + 2 weeks of incoming?
  const twoWeekCapacityMin = weeklyCapacityMin * 2;
  const twoWeekDemandMin =
    backlog.High.mins +
    backlog.Medium.mins +
    lowTotal.mins +
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
    let curLow = lowTotal.mins;
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
  }, [backlog, lowTotal, weeklyCapacityMin, incomingPerWeek]);

  const generateNarrative = async () => {
    setAiError('');
    setAiNote('');
    const facts = `
Workload snapshot for Dr. A. Patterson (NHS CAMHS):
- ${totalBacklogCount} actionable emails in backlog (${fmtH(totalBacklogMin)} of work). ${noiseCount} additional no-action emails to acknowledge.
- High priority: ${backlog.High.count} emails, ${fmtH(backlog.High.mins)}
- Medium priority: ${backlog.Medium.count} emails, ${fmtH(backlog.Medium.mins)}
- Low priority due within 7 days (must clear this week to stay inside 14-day SLA): ${backlog.LowDueSoon.count} emails, ${fmtH(backlog.LowDueSoon.mins)}
- Low priority with more than 7 days left (safe to defer to next week): ${backlog.LowDeferrable.count} emails, ${fmtH(backlog.LowDeferrable.mins)}
- Weekly admin capacity: ${weeklyCapacityH}h
- Expected new emails per week: ${NEW_PER_WEEK}
- SLA: high-risk clinical replies within 5 days, low priority within 14 days
- Required this week to keep ALL emails inside SLA = High + Medium + Low items already due within 7 days: ${fmtH(requiredThisWeekMin)}
- Capacity gap this week: ${gapThisWeekMin > 0 ? fmtH(gapThisWeekMin) + ' short' : 'none'}
- Low priority that can safely wait until next week: ${fmtH(lowDeferrableMin)} (${backlog.LowDeferrable.count} emails)
- Two-week SLA breach risk: ${willBreachLowSla ? `Yes — about ${fmtH(lowBreachMin)} of work will spill past 14 days` : 'No'}
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

  const isCustomConfig =
    arrivalsConfig.emailsPerWeek !== DEFAULT_ARRIVAL_CONFIG.emailsPerWeek ||
    arrivalsConfig.highPerWeek !== DEFAULT_ARRIVAL_CONFIG.highPerWeek ||
    arrivalsConfig.mediumPerWeek !== DEFAULT_ARRIVAL_CONFIG.mediumPerWeek ||
    arrivalsConfig.urgentDailyReserveMin !== DEFAULT_ARRIVAL_CONFIG.urgentDailyReserveMin ||
    arrivalsConfig.mediumWeeklyReserveMin !== DEFAULT_ARRIVAL_CONFIG.mediumWeeklyReserveMin;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Self-learning suggestion banner */}
      {showSuggestion && arrivalsSuggestion.recommendation && arrivalsSuggestion.observed && (
        <Card className="border-2 border-blue-200 bg-blue-50/40">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-100 text-blue-700 flex-shrink-0">
                <Wand2 size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-900/70 mb-1">
                  Suggestion · learned from your last {arrivalsSuggestion.observed.weeksObserved} weeks
                </p>
                <h3 className="text-base font-bold mb-2">
                  Adjust the planner's expected arrival rate
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {arrivalsConfig.emailsPerWeek}/wk → <strong className="text-blue-700">{arrivalsSuggestion.recommendation.emailsPerWeek}/wk</strong>
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground mb-3">{arrivalsSuggestion.reason}</p>
                <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                  <div className="rounded border border-border/60 bg-background p-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Urgent</p>
                    <p className="font-bold tabular-nums">
                      {arrivalsConfig.highPerWeek}/wk → <span className="text-blue-700">{arrivalsSuggestion.recommendation.highPerWeek}/wk</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground">daily reserve {arrivalsConfig.urgentDailyReserveMin}m → {arrivalsSuggestion.recommendation.urgentDailyReserveMin}m</p>
                  </div>
                  <div className="rounded border border-border/60 bg-background p-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Medium</p>
                    <p className="font-bold tabular-nums">
                      {arrivalsConfig.mediumPerWeek}/wk → <span className="text-blue-700">{arrivalsSuggestion.recommendation.mediumPerWeek}/wk</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground">weekly reserve {arrivalsConfig.mediumWeeklyReserveMin}m → {arrivalsSuggestion.recommendation.mediumWeeklyReserveMin}m</p>
                  </div>
                  <div className="rounded border border-border/60 bg-background p-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Low</p>
                    <p className="font-bold">no extra reserve</p>
                    <p className="text-[10px] text-muted-foreground">handled by daily 15-min admin slot</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    onClick={() => {
                      if (arrivalsSuggestion.recommendation) setArrivalsConfig(arrivalsSuggestion.recommendation);
                    }}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors uppercase tracking-wider"
                    data-testid="button-apply-arrivals-suggestion"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => setDismissedSuggestion(true)}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg border border-border hover:bg-muted/50 transition-colors uppercase tracking-wider"
                    data-testid="button-dismiss-arrivals-suggestion"
                  >
                    Not now
                  </button>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    Confidence: <strong className="text-foreground">{arrivalsSuggestion.confidence}</strong> · You stay in control — nothing changes until you click Apply.
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Insufficient history — be transparent about why suggest-mode is unavailable */}
      {showInsufficientHistory && !isCustomConfig && (
        <div className="flex items-start gap-3 text-xs text-muted-foreground bg-muted/30 border border-dashed border-border/60 rounded-lg px-3 py-2.5">
          <Wand2 size={14} className="text-muted-foreground/70 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-bold text-foreground/80 mb-0.5">Auto-tuning is warming up</p>
            <p>{arrivalsSuggestion.reason} Until then, the planner uses the default of {DEFAULT_ARRIVAL_CONFIG.emailsPerWeek} emails/week.</p>
          </div>
        </div>
      )}

      {/* Custom-config indicator: show when planner is using a non-default arrivals config */}
      {isCustomConfig && !showSuggestion && (
        <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/30 border border-border/60 rounded-lg px-3 py-2">
          <span>
            Planner is using your tuned arrivals config: <strong className="text-foreground">{arrivalsConfig.emailsPerWeek}/wk</strong> ({arrivalsConfig.highPerWeek}H / {arrivalsConfig.mediumPerWeek}M).
          </span>
          <button
            onClick={() => {
              resetArrivalsConfig();
              setDismissedSuggestion(false);
            }}
            className="text-[11px] font-bold uppercase tracking-wider hover:text-foreground transition-colors"
            data-testid="button-reset-arrivals-config"
          >
            Reset to default
          </button>
        </div>
      )}

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
                You realistically need <span className="text-primary">{headlineNeedH.toFixed(1)} hours</span> this week to keep every email inside its 14-day window.
              </h2>
              <p className="text-sm text-muted-foreground mb-2">
                That covers <strong className="text-foreground">{backlog.High.count} high-risk</strong>, <strong className="text-foreground">{backlog.Medium.count} medium</strong>, and <strong className="text-foreground">{backlog.LowDueSoon.count} low-priority emails already approaching their deadline</strong>{backlog.LowDueSoon.count > 0 ? ` (${fmtH(backlog.LowDueSoon.mins)} of low-priority work that can't wait another week)` : ''}.
              </p>
              <p className="text-sm text-muted-foreground">
                You have <strong className="text-foreground">{weeklyCapacityH} hours</strong> scheduled
                {weekSetup?.days?.length ? <> across {weekSetup.days.join(', ')}</> : ''}.
                {' '}
                {status === 'ok' && <span className="text-green-700 font-semibold">That's enough — every item stays inside SLA.</span>}
                {status === 'tight' && <span className="text-amber-700 font-semibold">That covers the high-risk clinical work; some medium or older low-priority items will slip and risk breaching SLA.</span>}
                {status === 'short' && <span className="text-red-700 font-semibold">Even the urgent clinical replies won't all fit — see suggestions below.</span>}
                {' '}
                {backlog.LowDeferrable.count > 0 && (
                  <span>A further <strong className="text-foreground">{fmtH(lowDeferrableMin)}</strong> of low-priority work ({backlog.LowDeferrable.count} emails) has more than 7 days left — safe to defer to next week.</span>
                )}
                {noiseCount > 0 && (
                  <span> Plus <strong className="text-foreground">{noiseCount} no-action emails</strong> to clear with the Acknowledge button (no time budget needed).</span>
                )}
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { key: 'High', label: 'High priority', sla: '5-day window', tone: 'red', data: backlog.High, mustDoThisWeek: true },
          { key: 'Medium', label: 'Medium priority', sla: '7-day window', tone: 'amber', data: backlog.Medium, mustDoThisWeek: true },
          { key: 'LowDueSoon', label: 'Low — due ≤ 7d', sla: 'will breach if deferred', tone: 'orange', data: backlog.LowDueSoon, mustDoThisWeek: true },
          { key: 'LowDeferrable', label: 'Low — > 7d left', sla: 'safe to defer', tone: 'slate', data: backlog.LowDeferrable, mustDoThisWeek: false },
        ] as const).map((row) => (
          <Card key={row.key} className={cn("border-border/50", row.mustDoThisWeek && "ring-1 ring-primary/10")}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded",
                  row.tone === 'red' && "bg-red-100 text-red-700",
                  row.tone === 'amber' && "bg-amber-100 text-amber-700",
                  row.tone === 'orange' && "bg-orange-100 text-orange-700",
                  row.tone === 'slate' && "bg-slate-100 text-slate-700",
                )}>
                  {row.label}
                </span>
              </div>
              <p className="text-3xl font-bold tabular-nums">{row.data.count}</p>
              <p className="text-xs text-muted-foreground mt-1">
                emails · <strong className="text-foreground">{fmtH(row.data.mins)}</strong>
              </p>
              <p className={cn("text-[10px] mt-2 font-semibold", row.mustDoThisWeek ? "text-primary" : "text-muted-foreground")}>
                {row.mustDoThisWeek ? '✓ counted in this week' : '↪ deferred to next week'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{row.sla}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* This week's plan snapshot — moved here from the Weekly Plan tab
          so the forecast page shows both the projected workload and what
          the planner actually produced for this week in one place. */}
      {plan && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{plan.days.reduce((a, d) => a + d.blocks.length, 0)}</p>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">Items scheduled</p>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-bold">{fmtMinsLong(plan.days.reduce((a, d) => a + d.totalMin, 0))}</p>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">Total admin time</p>
            </div>
            <div
              className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center"
              data-testid="weekly-buffer-stat"
            >
              <p className="text-2xl font-bold text-amber-700">
                {plan.bufferMin != null ? fmtMinsLong(plan.bufferMin) : '—'}
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
              <strong className="text-amber-700">{fmtMinsLong(plan.bufferMin)}</strong>
              {' '}— each day is filled to 80% of its capacity, leaving the
              remaining 20% free for items that arrive during the week.
            </p>
          )}
        </>
      )}

      {/* Safely deferred to next week — grouped by the email's own
          deadline so the clinician can see at a glance whether any
          deferred items are getting close to their 14-day SLA window. */}
      {plan?.deferredItems && plan.deferredItems.length > 0 && (() => {
        type Bucket = { key: string; label: string; tone: string; items: typeof plan.deferredItems };
        const buckets: Bucket[] = [
          { key: 'soon', label: 'Due within 7 days', tone: 'border-red-200 bg-red-50/40 text-red-900', items: [] },
          { key: 'next', label: 'Due in 8–14 days', tone: 'border-amber-200 bg-amber-50/40 text-amber-900', items: [] },
          { key: 'later', label: 'Due later (>14 days)', tone: 'border-slate-200 bg-slate-50 text-slate-700', items: [] },
          { key: 'none', label: 'No deadline', tone: 'border-slate-200 bg-slate-50 text-slate-700', items: [] },
        ];
        for (const it of plan.deferredItems) {
          if (it.dueDays == null) buckets[3].items.push(it);
          else if (it.dueDays <= 7) buckets[0].items.push(it);
          else if (it.dueDays <= 14) buckets[1].items.push(it);
          else buckets[2].items.push(it);
        }
        // Sort each bucket by dueDays ascending so the most urgent
        // item in each group sits at the top.
        for (const b of buckets) {
          b.items.sort((a, c) => (a.dueDays ?? 99) - (c.dueDays ?? 99));
        }
        const nonEmpty = buckets.filter(b => b.items.length > 0);
        const fmtDue = (d: number | null) => {
          if (d == null) return 'No deadline';
          if (d < 0) return `${Math.abs(d)}d overdue`;
          if (d === 0) return 'Due today';
          if (d === 1) return 'Due tomorrow';
          return `Due in ${d}d`;
        };
        return (
          <Card className="border-border/60" data-testid="forecast-deferred-list">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-700" />
                Safely deferred to next week
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {plan.deferredItems.length} item{plan.deferredItems.length === 1 ? '' : 's'} couldn't fit this week. Grouped by their own deadline so urgent ones stay visible.
              </p>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {nonEmpty.map(b => (
                <div key={b.key}>
                  <div className={cn('inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border', b.tone)}>
                    {b.label} · {b.items.length}
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {b.items.map((it, i) => (
                      <li key={`${b.key}-${i}`} className="flex items-start gap-3 text-sm">
                        <span className="text-[11px] font-bold tabular-nums text-muted-foreground w-20 flex-shrink-0 pt-0.5">
                          {fmtDue(it.dueDays)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground leading-snug">{it.label}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            ~{it.estMin}min · {it.reason}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })()}

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
          <p>· "Required this week" = all High + all Medium + any Low priority email with ≤ 7 days left on its SLA clock. Anything else is deferred to next week and still safely inside the 14-day window.</p>
          <p>· Acknowledged emails and no-action ("Acknowledge — no action") items are excluded from the time budget — they don't need a written reply.</p>
        </CardContent>
      </Card>
    </div>
  );
}
