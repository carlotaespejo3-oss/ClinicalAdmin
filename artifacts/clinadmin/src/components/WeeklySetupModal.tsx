import { useState, useEffect } from 'react';
import { Sparkles, X, ChevronRight, TrendingUp, Mail, ClipboardList, AlertTriangle, CalendarDays, Check, RefreshCcw } from 'lucide-react';
import { emails, weekHistory, manualTasks, histEmails } from '@/lib/data';
import { GeneratedPlan } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAppSettingsCache } from '@/lib/clinicianSettingsStore';
import TimeBlockEditor from './TimeBlockEditor';
import type { AdminTimeBlock } from '@/pages/ClinAdmin';

interface Props {
  onComplete: (hours: number, days: string[], plan: GeneratedPlan | null, sessionLengthMin: number, adminBlocksByDay?: Record<string, AdminTimeBlock[]>) => void;
  onDismiss: () => void;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

function getWeekLabel() {
  const d = new Date();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Static aggregates that don't depend on per-email estMin (which is now
// mutated at runtime by the rules-based estimator) stay at module scope.
const highRiskEmails = emails.filter(e => e.risk === 'high').length;
const mediumEmails = emails.filter(e => e.risk === 'medium').length;
const projectedExtra = 45;

const last4 = weekHistory.slice(-4);
const histAvgMins = Math.round(
  last4.reduce((a, w) => a + w.high + w.medium + w.low + w.admin, 0) / last4.length
);

// Catch-up stats — histEmails is a separate seeded backlog dataset (not
// classified by the AI), so its risk-based counts are still safe to
// pre-compute at module scope.
const catchupHighRisk = histEmails.filter(e => e.risk === 'high').length;
const catchupMedRisk  = histEmails.filter(e => e.risk === 'medium').length;
const catchupMins     = histEmails.reduce((a, e) => a + e.estMin, 0);

function computeRecommendedMins(): number {
  // Recomputed per render so it reflects the rules-based estMin values
  // applied to `emails` once the AI classifications have streamed in.
  const emailMins = emails.reduce((a, e) => a + e.estMin, 0);
  const taskMins = manualTasks.reduce((a, t) => a + t.estMin, 0);
  const totalRecommendedMins = emailMins + taskMins + projectedExtra;
  return Math.round(Math.max(totalRecommendedMins, histAvgMins) * 1.1 / 10) * 10;
}

const SCAN_STEPS = [
  'Scanning your inbox...',
  'Classifying email urgency...',
  'Reviewing manual task backlog...',
  'Analysing last 4 weeks...',
  'Checking catch-up backlog...',
  'Generating recommendation...',
];

const BUILD_MESSAGES = [
  'Prioritising by clinical risk...',
  'Scheduling high-risk items first...',
  'Allocating professional emails...',
  'Fitting tasks across your days...',
  'Checking 14-day KPI compliance...',
  'Finalising your schedule...',
];

export default function WeeklySetupModal({ onComplete, onDismiss }: Props) {
  const [phase, setPhase] = useState<'scan' | 'plan' | 'building' | 'error'>('scan');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStep, setScanStep] = useState(0);
  const [buildStep, setBuildStep] = useState(0);
  const recommendedMins = computeRecommendedMins();
  const emailMins = emails.reduce((a, e) => a + e.estMin, 0);
  const taskMins = manualTasks.reduce((a, t) => a + t.estMin, 0);
  // Subscribe to the central settings cache so the modal picks up
  // hydrated values that arrived after it opened. Without this, a
  // user who hits the planner during the brief window before
  // hydration completes would see defaults locked in for the whole
  // modal session.
  const liveSettings = useAppSettingsCache();
  const deriveDefaults = (wd: typeof liveSettings.weeklyDefaults) => {
    const validDays = wd.days.filter(d => DAYS.includes(d));
    return {
      hours: wd.hoursPerWeek > 0
        ? String(wd.hoursPerWeek)
        : String(Math.ceil(recommendedMins / 60)),
      days: validDays.length > 0 ? (validDays as string[]) : ['Tue', 'Wed', 'Thu'],
      sessionLengthMin: wd.sessionLengthMin > 0 ? wd.sessionLengthMin : 90,
    };
  };
  const [initialDefaults] = useState(() => deriveDefaults(liveSettings.weeklyDefaults));
  const [hours, setHours] = useState(initialDefaults.hours);
  const [selectedDays, setSelectedDays] = useState<string[]>(initialDefaults.days);
  const [sessionLengthMin, setSessionLengthMin] = useState<number>(initialDefaults.sessionLengthMin);
  const [errorMsg, setErrorMsg] = useState('');
  // Per-day time blocks. Seeded with one default block per initially-selected day.
  const [adminBlocksByDay, setAdminBlocksByDay] = useState<Record<string, AdminTimeBlock[]>>(() => {
    const result: Record<string, AdminTimeBlock[]> = {};
    for (const d of initialDefaults.days) {
      result[d] = [{ start: '09:00', durationMin: Math.round((parseFloat(initialDefaults.hours) * 60) / Math.max(1, initialDefaults.days.length) / 15) * 15 || 90 }];
    }
    return result;
  });
  // Track whether the user has touched the form. While untouched,
  // we mirror late-arriving hydrated values into the inputs;
  // once they edit anything, we stop overwriting their input.
  const [userTouched, setUserTouched] = useState(false);
  useEffect(() => {
    if (userTouched) return;
    const next = deriveDefaults(liveSettings.weeklyDefaults);
    setHours(next.hours);
    setSelectedDays(next.days);
    setSessionLengthMin(next.sessionLengthMin);
    // deriveDefaults closes over recommendedMins which is recomputed
    // each render, but the only user-visible coupling is to the
    // hydrated weekly defaults object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSettings, userTouched]);

  useEffect(() => {
    if (phase !== 'scan') return;
    const interval = setInterval(() => {
      setScanProgress(prev => {
        const next = prev + 2;
        const stepIdx = Math.min(Math.floor((next / 100) * SCAN_STEPS.length), SCAN_STEPS.length - 1);
        setScanStep(stepIdx);
        if (next >= 100) {
          clearInterval(interval);
          setTimeout(() => setPhase('plan'), 400);
          return 100;
        }
        return next;
      });
    }, 40);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'building') return;
    const interval = setInterval(() => {
      setBuildStep(prev => (prev + 1) % BUILD_MESSAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [phase]);

  const toggleDay = (day: string) => {
    setUserTouched(true);
    setSelectedDays(prev => {
      const next = prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day];
      // Seed a default block for newly-added days.
      if (!prev.includes(day)) {
        setAdminBlocksByDay(b => b[day] ? b : { ...b, [day]: [{ start: '09:00', durationMin: 90 }] });
      }
      return next;
    });
  };

  const handleBuild = async () => {
    const h = parseFloat(hours) || Math.ceil(recommendedMins / 60);
    setPhase('building');
    setBuildStep(0);

    const emailPayload = emails.map(e => ({
      id: e.id, from: e.from, subject: e.subject,
      risk: e.risk, cat: e.cat, deadline: e.deadline, estMin: e.estMin,
    }));
    const taskPayload = manualTasks.map(t => ({
      id: t.id, title: t.title, estMin: t.estMin,
      priority: t.risk === 'high' ? 'high' : 'normal',
    }));

    // Derive total hours from block durations for days that have blocks.
    const blocksForDays = Object.fromEntries(
      selectedDays
        .filter(d => adminBlocksByDay[d]?.length)
        .map(d => [d, adminBlocksByDay[d]])
    );
    const totalFromBlocks = selectedDays.reduce((acc, d) => {
      const dayBlocks = adminBlocksByDay[d];
      if (dayBlocks?.length) return acc + dayBlocks.reduce((a, b) => a + b.durationMin, 0);
      return acc + h * 60 / selectedDays.length;
    }, 0);
    const effectiveHours = totalFromBlocks / 60;

    try {
      const resp = await fetch('/api/clinadmin/weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: effectiveHours, days: selectedDays, emails: emailPayload, tasks: taskPayload }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { plan: GeneratedPlan };
      onComplete(effectiveHours, selectedDays, data.plan, sessionLengthMin, Object.keys(blocksForDays).length ? blocksForDays : undefined);
    } catch (err) {
      setErrorMsg('Could not connect to AI. Your schedule has been saved without a generated plan.');
      onComplete(effectiveHours, selectedDays, null, sessionLengthMin, Object.keys(blocksForDays).length ? blocksForDays : undefined);
    }
  };

  const prevWeekMins = last4[last4.length - 1]
    ? last4[last4.length - 1].high + last4[last4.length - 1].medium +
      last4[last4.length - 1].low + last4[last4.length - 1].admin
    : histAvgMins;
  const diffVsPrev = recommendedMins - prevWeekMins;

  // Bar chart max for sparkline
  const allWeekTotals = [...last4.map(w => w.high + w.medium + w.low + w.admin), recommendedMins];
  const barMax = Math.max(...allWeekTotals);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-400">

        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 px-8 py-6 text-white">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <CalendarDays size={18} className="opacity-80" />
                <span className="text-sm font-medium opacity-80">Week of {getWeekLabel()}</span>
              </div>
              <h2 className="text-2xl font-bold">Your Weekly Admin Brief</h2>
              <p className="text-sm opacity-75 mt-1">
                {phase === 'scan' && 'Analysing your current workload and history...'}
                {phase === 'plan' && "Here's what we found. Set your available time to build your plan."}
                {phase === 'building' && 'AI is building your personalised weekly schedule...'}
              </p>
            </div>
            {phase !== 'building' && (
              <button onClick={onDismiss} className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Scan phase */}
        {phase === 'scan' && (
          <div className="px-8 py-12 flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Sparkles size={28} className="text-primary animate-pulse" />
            </div>
            <p className="text-base font-semibold text-foreground mb-2">{SCAN_STEPS[scanStep]}</p>
            <p className="text-sm text-muted-foreground mb-8">This only takes a moment</p>
            <div className="w-full max-w-sm">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-75" style={{ width: `${scanProgress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">{scanProgress}%</p>
            </div>
          </div>
        )}

        {/* Building phase */}
        {phase === 'building' && (
          <div className="px-8 py-16 flex flex-col items-center">
            <div className="relative w-20 h-20 mb-8">
              <div className="absolute inset-0 rounded-full border-4 border-primary/10 border-t-primary animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles size={24} className="text-primary animate-pulse" />
              </div>
            </div>
            <p className="text-lg font-bold text-foreground mb-2">Building your week...</p>
            <p className="text-sm text-primary font-medium mb-1 h-5 transition-all">{BUILD_MESSAGES[buildStep]}</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs mt-3">
              Cross-referencing {emails.length + manualTasks.length} items with your availability across {selectedDays.join(', ')}.
            </p>
          </div>
        )}

        {/* Plan phase */}
        {phase === 'plan' && (
          <div className="px-8 py-6 space-y-5 max-h-[70vh] overflow-y-auto">

            {/* What we found — 3 cards */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">What we found</p>
              <div className="grid grid-cols-3 gap-3">

                {/* Current inbox */}
                <div className="bg-slate-50 border border-border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Mail size={14} className="text-blue-600" />
                    </div>
                    <span className="text-sm font-bold">Current inbox</span>
                  </div>
                  <p className="text-2xl font-bold mb-2">{emails.length} emails</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full" /> {highRiskEmails} high
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" /> {mediumEmails} medium
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Est: <span className="font-bold text-foreground">{fmtMins(emailMins)}</span>
                  </p>
                </div>

                {/* Pending tasks */}
                <div className="bg-slate-50 border border-border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center">
                      <ClipboardList size={14} className="text-green-600" />
                    </div>
                    <span className="text-sm font-bold">Pending tasks</span>
                  </div>
                  <p className="text-2xl font-bold mb-2">{manualTasks.length} tasks</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                      Reports, letters, calls
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Est: <span className="font-bold text-foreground">{fmtMins(taskMins)}</span>
                  </p>
                </div>

                {/* Catch-up backlog */}
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
                      <RefreshCcw size={14} className="text-amber-600" />
                    </div>
                    <span className="text-sm font-bold">Catch-up</span>
                  </div>
                  <p className="text-2xl font-bold mb-2">{histEmails.length} emails</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full" /> {catchupHighRisk} urgent
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" /> {catchupMedRisk} medium
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Est: <span className="font-bold text-foreground">{fmtMins(catchupMins)}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* AI Recommendation + mini trend — side by side */}
            <div className="grid grid-cols-5 gap-3">

              {/* AI Recommendation — 3 cols */}
              <div className="col-span-3 bg-gradient-to-br from-primary/8 to-primary/4 border border-primary/25 rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={16} className="text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">AI Recommendation</p>
                    <div className="flex items-baseline gap-2 mb-2">
                      <p className="text-2xl font-bold text-foreground">{fmtMins(recommendedMins)}</p>
                      <span className="text-sm text-muted-foreground">this week</span>
                    </div>
                    {diffVsPrev > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full mb-2">
                        <AlertTriangle size={9} /> +{fmtMins(diffVsPrev)} vs last week
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Based on <strong>{emails.length} inbox</strong> (~{fmtMins(emailMins)}),{' '}
                      <strong>{manualTasks.length} tasks</strong> (~{fmtMins(taskMins)}),
                      plus ~{fmtMins(projectedExtra)} buffer.
                    </p>
                  </div>
                </div>
              </div>

              {/* Mini trend sparkline — 2 cols */}
              <div className="col-span-2 bg-slate-50 border border-border rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <TrendingUp size={13} className="text-purple-500" />
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Trend</p>
                </div>
                <div className="flex items-end gap-1.5 h-10 mb-2">
                  {last4.map((w, i) => {
                    const total = w.high + w.medium + w.low + w.admin;
                    const pct = Math.round((total / barMax) * 100);
                    return (
                      <div key={w.week} className="flex-1 flex flex-col items-center gap-0.5">
                        <div className="w-full flex flex-col justify-end h-10">
                          <div
                            className={cn("w-full rounded-sm", i === last4.length - 1 ? "bg-primary/60" : "bg-primary/20")}
                            style={{ height: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[8px] text-muted-foreground font-medium leading-none">{w.week}</span>
                      </div>
                    );
                  })}
                  {/* This week bar */}
                  <div className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex flex-col justify-end h-10">
                      <div
                        className="w-full rounded-sm bg-amber-400 border border-dashed border-amber-500"
                        style={{ height: `${Math.round((recommendedMins / barMax) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-amber-600 font-bold leading-none">Now</span>
                  </div>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200">
                  <p className="text-[9px] text-muted-foreground">Avg <span className="font-bold text-foreground">{fmtMins(histAvgMins)}</span></p>
                  <p className="text-[9px] text-muted-foreground">Last <span className="font-bold text-foreground">{fmtMins(prevWeekMins)}</span></p>
                </div>
              </div>
            </div>

            {/* User input */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Set your availability</p>
              <div className="space-y-4">
                {/* Total hours summary — derived from blocks, shown as read-only */}
                {(() => {
                  const totalMins = selectedDays.reduce((acc, d) => {
                    const db = adminBlocksByDay[d];
                    return acc + (db?.length ? db.reduce((a, b) => a + b.durationMin, 0) : 0);
                  }, 0);
                  const totalH = totalMins / 60;
                  const belowRec = totalMins < recommendedMins;
                  return (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 border border-border">
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Total admin time this week</p>
                        <p className="text-xl font-bold text-foreground">{fmtMins(totalMins)}</p>
                      </div>
                      {belowRec ? (
                        <span className="text-xs text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl flex items-center gap-1">
                          <AlertTriangle size={11} /> Below recommended ({fmtMins(recommendedMins)})
                        </span>
                      ) : (
                        <span className="text-xs text-green-600 font-semibold bg-green-50 border border-green-200 px-3 py-1.5 rounded-xl flex items-center gap-1">
                          <Check size={11} /> Covers workload
                        </span>
                      )}
                      {/* Keep hours state in sync with derived value */}
                      {totalH !== parseFloat(hours) && (() => { setHours(String(totalH)); return null; })()}
                    </div>
                  );
                })()}

                <div>
                  <label className="text-sm font-semibold text-foreground block mb-2">
                    Which days &amp; times are your admin blocks?
                  </label>
                  <div className="space-y-2">
                    {DAYS.map(day => {
                      const active = selectedDays.includes(day);
                      const dayBlocks = adminBlocksByDay[day] ?? [];
                      const dayTotal = dayBlocks.reduce((a, b) => a + b.durationMin, 0);
                      return (
                        <div
                          key={day}
                          className={cn(
                            "rounded-xl border p-3 transition-colors",
                            active ? "border-primary/40 bg-primary/5" : "border-border bg-white"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {/* Day toggle */}
                            <button
                              onClick={() => toggleDay(day)}
                              className={cn(
                                "w-12 py-1.5 rounded-lg text-xs font-bold transition-colors flex-shrink-0 mt-0.5",
                                active
                                  ? "bg-primary text-white"
                                  : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                              )}
                            >
                              {day}
                            </button>
                            {active ? (
                              <div className="flex-1 min-w-0">
                                <TimeBlockEditor
                                  day={day}
                                  blocks={dayBlocks}
                                  onChange={(d, blocks) => {
                                    setUserTouched(true);
                                    setAdminBlocksByDay(prev => ({ ...prev, [d]: blocks }));
                                  }}
                                  compact
                                />
                                {dayTotal > 0 && (
                                  <p className="text-[10px] text-muted-foreground mt-1.5">
                                    {fmtMins(dayTotal)} total on {day}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic pt-1.5">Off — tap to add</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-foreground block mb-2">
                    Typical session length
                  </label>
                  <div className="flex items-center gap-3">
                    <select
                      value={sessionLengthMin}
                      onChange={e => { setUserTouched(true); setSessionLengthMin(parseInt(e.target.value)); }}
                      className="text-sm bg-white border border-border rounded-xl px-3 py-2.5 font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
                      data-testid="select-modal-session-length"
                    >
                      {[30, 45, 60, 90, 120].map(m => (
                        <option key={m} value={m}>{m} minutes</option>
                      ))}
                    </select>
                    {selectedDays.length > 0 && parseFloat(hours) > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ≈ {Math.max(1, Math.floor(((parseFloat(hours) * 60) / selectedDays.length) / sessionLengthMin))} session{Math.floor(((parseFloat(hours) * 60) / selectedDays.length) / sessionLengthMin) !== 1 ? 's' : ''} per day
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium rounded-xl px-4 py-3">
                {errorMsg}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {phase === 'plan' && (
          <div className="px-8 py-5 border-t border-border flex items-center justify-between bg-slate-50/60">
            <button
              onClick={onDismiss}
              className="text-sm text-muted-foreground font-medium hover:text-foreground transition-colors"
            >
              Remind me tomorrow
            </button>
            <button
              onClick={handleBuild}
              disabled={selectedDays.length === 0 || !hours}
              className="flex items-center gap-2 bg-primary text-white font-bold px-6 py-3 rounded-xl shadow-lg hover:bg-primary/90 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:translate-y-0"
            >
              <Sparkles size={16} />
              Build my weekly plan
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
