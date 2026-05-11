import { useState, useEffect } from 'react';
import { Sparkles, X, ChevronRight, TrendingUp, Mail, ClipboardList, AlertTriangle, CalendarDays, Check } from 'lucide-react';
import { emails, weekHistory, manualTasks } from '@/lib/data';
import { cn } from '@/lib/utils';

interface Props {
  onComplete: (hours: number, days: string[]) => void;
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

// Workload calculations
const emailMins = emails.reduce((a, e) => a + e.estMin, 0);          // 104 min
const taskMins = manualTasks.reduce((a, t) => a + t.estMin, 0);       // 88 min
const highRiskEmails = emails.filter(e => e.risk === 'high').length;
const mediumEmails = emails.filter(e => e.risk === 'medium').length;
const projectedExtra = 45; // buffer for projected incoming
const totalRecommendedMins = emailMins + taskMins + projectedExtra;   // ~237 min ≈ 3h 57min → round to 4h 30min with safety

// Historical averages from weekHistory (last 4 weeks)
const last4 = weekHistory.slice(-4);
const histAvgMins = Math.round(
  last4.reduce((a, w) => a + w.high + w.medium + w.low + w.admin, 0) / last4.length
);
// Recommendation = max of (current workload, historical avg) + 10% buffer
const recommendedMins = Math.round(Math.max(totalRecommendedMins, histAvgMins) * 1.1 / 10) * 10;

const SCAN_STEPS = [
  'Scanning your inbox...',
  'Classifying email urgency...',
  'Reviewing manual task backlog...',
  'Analysing last 4 weeks...',
  'Calculating projected workload...',
  'Generating recommendation...',
];

export default function WeeklySetupModal({ onComplete, onDismiss }: Props) {
  const [phase, setPhase] = useState<'scan' | 'plan'>('scan');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStep, setScanStep] = useState(0);
  const [hours, setHours] = useState(String(Math.ceil(recommendedMins / 60)));
  const [selectedDays, setSelectedDays] = useState<string[]>(['Tue', 'Wed', 'Thu']);

  // Scan animation
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

  const toggleDay = (day: string) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleBuild = () => {
    const h = parseFloat(hours) || Math.ceil(recommendedMins / 60);
    onComplete(h, selectedDays);
  };

  const prevWeekMins = last4[last4.length - 1]
    ? last4[last4.length - 1].high + last4[last4.length - 1].medium +
      last4[last4.length - 1].low + last4[last4.length - 1].admin
    : histAvgMins;

  const diffVsPrev = recommendedMins - prevWeekMins;

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
                {phase === 'scan'
                  ? 'Analysing your current workload and history...'
                  : "Here's what we found. Set your available time to build your plan."}
              </p>
            </div>
            <button
              onClick={onDismiss}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X size={16} />
            </button>
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
                <div
                  className="h-full bg-primary rounded-full transition-all duration-75"
                  style={{ width: `${scanProgress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">{scanProgress}%</p>
            </div>
          </div>
        )}

        {/* Plan phase */}
        {phase === 'plan' && (
          <div className="px-8 py-6 space-y-5 max-h-[70vh] overflow-y-auto">

            {/* Workload breakdown */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">What we found</p>
              <div className="grid grid-cols-2 gap-3">
                {/* Inbox */}
                <div className="bg-slate-50 border border-border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Mail size={14} className="text-blue-600" />
                    </div>
                    <span className="text-sm font-bold">Current inbox</span>
                  </div>
                  <p className="text-2xl font-bold mb-2">{emails.length} emails</p>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full" /> {highRiskEmails} high risk
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" /> {mediumEmails} medium
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Estimated time: <span className="font-bold text-foreground">{fmtMins(emailMins)}</span>
                  </p>
                </div>

                {/* Manual tasks */}
                <div className="bg-slate-50 border border-border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center">
                      <ClipboardList size={14} className="text-green-600" />
                    </div>
                    <span className="text-sm font-bold">Pending tasks</span>
                  </div>
                  <p className="text-2xl font-bold mb-2">{manualTasks.length} tasks</p>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                      Reports, letters, calls
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Estimated time: <span className="font-bold text-foreground">{fmtMins(taskMins)}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Historical trend */}
            <div className="bg-slate-50 border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center">
                    <TrendingUp size={14} className="text-purple-600" />
                  </div>
                  <span className="text-sm font-bold">Historical trend</span>
                </div>
                <span className="text-xs text-muted-foreground">Last 4 weeks</span>
              </div>
              <div className="flex items-end gap-2 h-12">
                {last4.map((w, i) => {
                  const total = w.high + w.medium + w.low + w.admin;
                  const maxVal = Math.max(...last4.map(x => x.high + x.medium + x.low + x.admin));
                  const pct = (total / maxVal) * 100;
                  return (
                    <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex flex-col justify-end h-10">
                        <div
                          className={cn(
                            "w-full rounded-t-sm transition-all",
                            i === last4.length - 1 ? "bg-primary" : "bg-primary/30"
                          )}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-muted-foreground font-medium">{w.week}</span>
                    </div>
                  );
                })}
                <div className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col justify-end h-10">
                    <div
                      className="w-full rounded-t-sm bg-amber-300 border-2 border-dashed border-amber-500"
                      style={{ height: `${Math.min((recommendedMins / Math.max(...last4.map(x => x.high + x.medium + x.low + x.admin))) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-amber-600 font-bold">This wk</span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  4-week avg: <span className="font-bold text-foreground">{fmtMins(histAvgMins)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Last week: <span className="font-bold text-foreground">{fmtMins(prevWeekMins)}</span>
                </p>
              </div>
            </div>

            {/* AI Recommendation */}
            <div className="bg-gradient-to-br from-primary/8 to-primary/4 border border-primary/25 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={16} className="text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">AI Recommendation</p>
                  <div className="flex items-baseline gap-2 mb-1">
                    <p className="text-2xl font-bold text-foreground">{fmtMins(recommendedMins)}</p>
                    <span className="text-sm text-muted-foreground">this week</span>
                    {diffVsPrev > 0 && (
                      <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <AlertTriangle size={9} /> +{fmtMins(diffVsPrev)} vs last week
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Based on <strong>{emails.length} current emails</strong> (~{fmtMins(emailMins)}),{' '}
                    <strong>{manualTasks.length} pending tasks</strong> (~{fmtMins(taskMins)}), plus
                    a ~{fmtMins(projectedExtra)} buffer for projected incoming items based on your recent history.
                  </p>
                </div>
              </div>
            </div>

            {/* User input */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Set your availability</p>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-foreground block mb-2">
                    How many admin hours can you give this week?
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="relative w-32">
                      <input
                        type="number"
                        min="1"
                        max="20"
                        step="0.5"
                        value={hours}
                        onChange={e => setHours(e.target.value)}
                        className="w-full border border-border rounded-xl px-4 py-2.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground font-medium">hours / week</span>
                    {parseFloat(hours) < recommendedMins / 60 && (
                      <span className="text-xs text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl flex items-center gap-1">
                        <AlertTriangle size={11} /> Below recommended
                      </span>
                    )}
                    {parseFloat(hours) >= recommendedMins / 60 && (
                      <span className="text-xs text-green-600 font-semibold bg-green-50 border border-green-200 px-3 py-1.5 rounded-xl flex items-center gap-1">
                        <Check size={11} /> Covers workload
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-foreground block mb-2">
                    Which days are your admin blocks?
                  </label>
                  <div className="flex gap-2">
                    {DAYS.map(day => (
                      <button
                        key={day}
                        onClick={() => toggleDay(day)}
                        className={cn(
                          "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border-2",
                          selectedDays.includes(day)
                            ? "bg-primary text-white border-primary shadow-sm"
                            : "bg-white text-muted-foreground border-border hover:border-primary/50"
                        )}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  {selectedDays.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {fmtMins(Math.round((parseFloat(hours) * 60) / selectedDays.length))} per day across {selectedDays.length} day{selectedDays.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
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
