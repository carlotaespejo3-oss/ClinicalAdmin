import { useState, useEffect } from 'react';
import { AlertTriangle, ChevronRight, CheckCircle2, CalendarDays, Mail, ClipboardList, ShieldCheck, X, Send, Copy, Check, Users, CalendarClock, Sun, CalendarCheck, ChevronDown, Flag, Settings2, Minus, Plus, RotateCcw } from 'lucide-react';
import { homePlan, weekData, emails } from '@/lib/data';
import { HomePlanItem, SidebarTask, TabType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { WeekSetup } from '@/pages/ClinAdmin';

interface Props {
  sidebarTasks: SidebarTask[];
  onToggleSidebarTask: (id: string) => void;
  weekSetup: WeekSetup | null;
  onOpenWeeklySetup: () => void;
  onUpdateAvailability: (hours: number, days: string[]) => void;
  onNavigate: (tab: TabType) => void;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

const emailMins = emails.reduce((a, e) => a + e.estMin, 0);
const taskMins = 88;
const projectedExtra = 45;
const recommendedMins = Math.round(Math.max(emailMins + taskMins + projectedExtra, 284) * 1.1 / 10) * 10;

type PlanEntry =
  | { kind: 'base'; item: HomePlanItem }
  | { kind: 'manual'; task: SidebarTask };

export default function HomeTab({ sidebarTasks, onToggleSidebarTask, weekSetup, onOpenWeeklySetup, onUpdateAvailability, onNavigate }: Props) {
  const [plan, setPlan] = useState(homePlan);
  const [openItem, setOpenItem] = useState<HomePlanItem | null>(null);
  const [editedDrafts, setEditedDrafts] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(false);
  const [showWhyRec, setShowWhyRec] = useState(false);

  const currentDraftBody = openItem
    ? editedDrafts[openItem.id] ?? openItem.draftReply ?? ''
    : '';

  const [draftHours, setDraftHours] = useState<number>(weekSetup?.hours ?? 4);
  const [draftDays, setDraftDays] = useState<string[]>(weekSetup?.days ?? ['Tue', 'Wed', 'Thu']);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (weekSetup) {
      setDraftHours(weekSetup.hours);
      setDraftDays(weekSetup.days);
    }
  }, [weekSetup?.hours, weekSetup?.days]);

  const dirty = !weekSetup
    || draftHours !== weekSetup.hours
    || draftDays.length !== weekSetup.days.length
    || ALL_DAYS.some(d => draftDays.includes(d) !== weekSetup.days.includes(d));

  const toggleDraftDay = (d: string) => {
    setDraftDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b)));
  };

  const saveAvailability = () => {
    onUpdateAvailability(draftHours, draftDays);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const resetDraft = () => {
    if (!weekSetup) return;
    setDraftHours(weekSetup.hours);
    setDraftDays(weekSetup.days);
  };

  const toggleBase = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlan(plan.map(item => item.id === id ? { ...item, done: !item.done } : item));
  };

  const openEmail = (item: HomePlanItem) => {
    if (item.emailId) setOpenItem(item);
  };

  const handleCopy = () => {
    if (openItem) {
      navigator.clipboard.writeText(currentDraftBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSend = () => {
    if (openItem) {
      setPlan(plan.map(item => item.id === openItem.id ? { ...item, done: true } : item));
      setEditedDrafts(prev => {
        const next = { ...prev };
        delete next[openItem.id];
        return next;
      });
      setOpenItem(null);
    }
  };

  const sourceEmail = openItem?.emailId ? emails.find(e => e.id === openItem.emailId) : null;

  const highManual = sidebarTasks.filter(t => !t.done && t.priority === 'high');
  const normalManual = sidebarTasks.filter(t => !t.done && t.priority === 'normal');
  const doneManual = sidebarTasks.filter(t => t.done);

  const entries: PlanEntry[] = [
    ...plan.map(item => ({ kind: 'base' as const, item })),
    ...highManual.map(task => ({ kind: 'manual' as const, task })),
    ...normalManual.map(task => ({ kind: 'manual' as const, task })),
    ...doneManual.map(task => ({ kind: 'manual' as const, task })),
  ];

  const planMins = plan.reduce((a, i) => a + parseInt(i.time), 0);
  const totalMins = planMins + sidebarTasks.filter(t => !t.done).reduce((a, t) => a + t.estMin, 0);

  const completedBase = plan.filter(t => t.done).length;
  const completedManual = sidebarTasks.filter(t => t.done).length;
  const totalItems = plan.length + sidebarTasks.length;
  const totalDone = completedBase + completedManual;

  const allocatedMins = weekSetup ? Math.round(weekSetup.hours * 60) : weekData.reduce((a, d) => a + d.planned, 0);
  const activeDays = weekSetup ? weekSetup.days : weekData.map(d => d.day);
  const perDayMins = activeDays.length > 0 ? Math.round(allocatedMins / activeDays.length) : 0;
  const perDayRecommended = activeDays.length > 0 ? Math.round(recommendedMins / activeDays.length) : 0;
  const isAtRisk = allocatedMins < recommendedMins;
  const shortfall = recommendedMins - allocatedMins;

  const scheduledTasks = sidebarTasks.filter(t => !t.done).length;

  return (
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* Greeting */}
      <div className="flex items-center gap-4 pb-1">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Sun size={26} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Good morning, Dr. Morgan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here's your plan. Follow it and you're on top of your admin.</p>
        </div>
      </div>

      {/* Risk / Status Banner */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Left — status */}
          <div className="p-6 flex items-start gap-4">
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0",
              isAtRisk ? "bg-amber-100" : "bg-green-100"
            )}>
              {isAtRisk
                ? <AlertTriangle size={24} className="text-amber-500" />
                : <CheckCircle2 size={24} className="text-green-600" />
              }
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground font-medium">You're currently:</p>
              <p className={cn("text-xl font-bold", isAtRisk ? "text-amber-600" : "text-green-600")}>
                {isAtRisk ? 'At risk' : 'On track'}
              </p>
              {isAtRisk ? (
                <>
                  <p className="text-sm text-foreground">
                    You have 2h booked across Tue, Wed, Thu.
                  </p>
                  <p className="text-sm font-medium text-amber-600">
                    Based on current workload and historical trends you will likely need to add 30 min more.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-foreground">
                    You have <strong>{fmtMins(allocatedMins)}</strong> admin booked this week
                    {activeDays.length > 0 && <> across <strong>{activeDays.join(', ')}</strong></>}.
                  </p>
                  <p className="text-sm text-muted-foreground">Your allocation covers this week's workload.</p>
                </>
              )}
            </div>
          </div>

          {/* Right — AI recommendation */}
          <div className="p-6 bg-slate-50/60 border-l border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">AI recommendation</p>
            {isAtRisk ? (
              <>
                <p className="text-lg font-bold text-foreground leading-tight mb-1">Add 1 extra hour this week</p>
                <div className="flex items-center gap-2 mb-4">
                  <p className="text-sm text-muted-foreground">Best option: Add 1h Wednesday afternoon.</p>
                  <span className="text-amber-500 text-xl">↷</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  <button className="bg-primary text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">
                    Add 1h Wednesday
                  </button>
                  <button className="bg-white border border-border text-foreground text-xs font-bold px-4 py-2 rounded-lg hover:bg-accent transition-colors">
                    Add 1h Thursday
                  </button>
                  <button className="bg-white border border-border text-foreground text-xs font-bold px-4 py-2 rounded-lg hover:bg-accent transition-colors">
                    Rebalance my week
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-foreground leading-tight mb-1">You're well-planned for this week</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Your {fmtMins(allocatedMins)} allocation covers all current and projected workload.
                </p>
              </>
            )}
            <button
              onClick={() => setShowWhyRec(v => !v)}
              className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
            >
              See why this is recommended
              <ChevronDown size={12} className={cn("transition-transform", showWhyRec && "rotate-180")} />
            </button>
            {showWhyRec && (
              <div className="mt-3 p-3 bg-white border border-border rounded-xl text-xs text-muted-foreground space-y-1">
                <p><strong className="text-foreground">Emails:</strong> {fmtMins(emailMins)} across {emails.length} items in your inbox.</p>
                <p><strong className="text-foreground">Tasks:</strong> {fmtMins(taskMins)} across manual and clinical tasks.</p>
                <p><strong className="text-foreground">Buffer:</strong> {fmtMins(projectedExtra)} projected overhead based on your history.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Middle grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Today's Plan */}
        <div className="lg:col-span-3 bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center">
                  <CalendarCheck size={18} className="text-green-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold">Today's Plan</h3>
                    <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full">
                      1h 30min admin
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Do these in order</p>
                </div>
              </div>
              <button className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline">
                View full list <ChevronRight size={12} />
              </button>
            </div>
          </div>

          <ul className="divide-y divide-border">
            {entries.map((entry, idx) => {
              if (entry.kind === 'base') {
                const item = entry.item;
                return (
                  <li
                    key={`base-${item.id}`}
                    onClick={() => openEmail(item)}
                    className={cn(
                      "flex items-start gap-4 px-6 py-4 transition-colors",
                      item.emailId && !item.done ? "cursor-pointer hover:bg-slate-50" : "",
                      item.done && "opacity-50"
                    )}
                  >
                    <span className={cn(
                      "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5",
                      item.done ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-600"
                    )}>
                      {item.done ? <Check size={12} /> : idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-semibold", item.done && "line-through")}>{item.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="font-medium">Why:</span> {item.why}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {item.badge === 'professional' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                            <Users size={9} /> Professional colleague
                          </span>
                        )}
                        {item.badge === 'meeting' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                            <CalendarClock size={9} /> Deadline approaching
                          </span>
                        )}
                        {item.emailId && !item.done && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/8 border border-primary/20 px-2 py-0.5 rounded-full">
                            <Mail size={9} /> Draft ready — click to review
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{item.time}</span>
                      <button
                        onClick={(e) => toggleBase(item.id, e)}
                        className={cn(
                          "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0",
                          item.done ? "bg-green-500 border-green-500" : "border-slate-300 hover:border-primary"
                        )}
                      >
                        {item.done && <Check size={11} className="text-white" />}
                      </button>
                    </div>
                  </li>
                );
              }

              const task = entry.task;
              return (
                <li
                  key={`manual-${task.id}`}
                  className={cn("flex items-start gap-4 px-6 py-4 bg-slate-50/40", task.done && "opacity-50")}
                >
                  <span className={cn(
                    "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5",
                    task.done ? "bg-green-100 text-green-600" : "bg-slate-200 text-slate-500"
                  )}>
                    {task.done ? <Check size={12} /> : idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-semibold", task.done && "line-through")}>{task.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium">Why:</span>{' '}
                      {task.priority === 'high' ? 'High priority — action required.' : 'Scheduled manual task.'}
                    </p>
                    {task.priority === 'high' && (
                      <div className="mt-1.5">
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                          High priority
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{task.estMin}min</span>
                    <button
                      onClick={() => onToggleSidebarTask(task.id)}
                      className={cn(
                        "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0",
                        task.done ? "bg-green-500 border-green-500" : "border-slate-300 hover:border-primary"
                      )}
                    >
                      {task.done && <Check size={11} className="text-white" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="px-6 py-4 border-t border-border bg-green-50/60 flex items-center gap-3">
            <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
            <p className="text-sm font-medium text-green-700">Finish this list and you're safe to close down the computer for today! 🎉</p>
          </div>
        </div>

        {/* This Week */}
        <div className="lg:col-span-2 bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
                <CalendarDays size={18} className="text-blue-600" />
              </div>
              <h3 className="text-base font-bold">This Week</h3>
            </div>
            <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-1 rounded-full uppercase tracking-wide">
              Planned workload
            </span>
          </div>

          <div className="px-6 py-5 space-y-4">
            {activeDays.map(day => {
              const maxBar = Math.max(perDayMins, perDayRecommended, 90);
              const plannedPct = Math.min((perDayMins / maxBar) * 100, 100);
              const recPct = Math.min((perDayRecommended / maxBar) * 100, 100);
              const isOver = perDayMins >= perDayRecommended;
              return (
                <div key={day}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-bold text-foreground">{day}</span>
                    <span className="text-xs text-muted-foreground">{fmtMins(perDayMins)} planned</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${plannedPct}%` }}
                      />
                      {!isOver && (
                        <div
                          className="h-full bg-primary/15 border-l-2 border-dashed border-primary/30"
                          style={{ width: `${recPct - plannedPct}%` }}
                        />
                      )}
                    </div>
                    {!isOver && (
                      <span className="text-[10px] font-bold text-amber-600 whitespace-nowrap">
                        +{fmtMins(perDayRecommended - perDayMins)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {activeDays.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No admin days set —{' '}
                <button onClick={onOpenWeeklySetup} className="text-primary font-semibold hover:underline">
                  set up your week
                </button>
              </p>
            )}
          </div>

          <div className="px-6 py-4 border-t border-border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total planned</span>
              <span className="font-semibold">{fmtMins(allocatedMins)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Recommended</span>
              <span className={cn("font-semibold", isAtRisk ? "text-amber-600" : "text-green-600")}>{fmtMins(recommendedMins)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Difference</span>
              <span className={cn("font-semibold", isAtRisk ? "text-amber-600" : "text-green-600")}>
                {isAtRisk ? `–${fmtMins(shortfall)}` : `+${fmtMins(allocatedMins - recommendedMins)}`}
              </span>
            </div>
            <button
              onClick={() => onNavigate('Weekly Plan')}
              className="mt-2 text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
            >
              See full weekly plan <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom stats — 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Emails safely deferred */}
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0">
            <Mail size={20} className="text-teal-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">7</p>
            <p className="text-sm font-semibold text-foreground">Emails safely deferred</p>
            <p className="text-xs text-muted-foreground">Scheduled for next week or later.</p>
          </div>
        </div>

        {/* 2. Tasks scheduled */}
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <ClipboardList size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">2</p>
            <p className="text-sm font-semibold text-foreground">Tasks scheduled</p>
            <p className="text-xs text-muted-foreground">Reports / letters / admin tasks.</p>
          </div>
        </div>

        {/* 3. Unsafe deferrals */}
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <ShieldCheck size={20} className="text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold">0</p>
            <p className="text-sm font-semibold text-foreground">Unsafe deferrals</p>
            <p className="text-xs text-muted-foreground">You're safe if you follow the plan.</p>
            <button className="mt-1 text-xs text-primary font-semibold flex items-center gap-1 hover:underline">
              See what's deferred <ChevronRight size={11} />
            </button>
          </div>
        </div>

        {/* 4. Missed deadlines */}
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Flag size={20} className="text-slate-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">0</p>
            <p className="text-sm font-semibold text-foreground">Missed deadlines</p>
            <p className="text-xs text-muted-foreground">You're on top of everything.</p>
          </div>
        </div>
      </div>

      {/* Availability adjustment panel */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-slate-50/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
              <Settings2 size={17} className="text-slate-600" />
            </div>
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                Adjust this week's availability
                {savedFlash && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full animate-in fade-in">
                    <Check size={10} /> Saved
                  </span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plans change. Tweak your hours or days here without re-running the weekly brief.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenWeeklySetup}
            className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
          >
            <RotateCcw size={11} /> Re-run weekly brief
          </button>
        </div>

        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Hours stepper */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2">
              Total admin hours
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDraftHours(h => Math.max(0.5, +(h - 0.5).toFixed(1)))}
                className="w-9 h-9 rounded-lg border border-border bg-white hover:bg-accent flex items-center justify-center transition-colors"
                data-testid="button-hours-decrease"
              >
                <Minus size={14} />
              </button>
              <div className="flex-1 h-9 rounded-lg bg-slate-50 border border-border flex items-center justify-center">
                <span className="text-xl font-bold text-foreground">{draftHours}</span>
                <span className="text-xs text-muted-foreground ml-1.5">h / week</span>
              </div>
              <button
                onClick={() => setDraftHours(h => Math.min(40, +(h + 0.5).toFixed(1)))}
                className="w-9 h-9 rounded-lg border border-border bg-white hover:bg-accent flex items-center justify-center transition-colors"
                data-testid="button-hours-increase"
              >
                <Plus size={14} />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {draftDays.length > 0
                ? <>~{Math.round((draftHours * 60) / draftDays.length)} min per admin day</>
                : 'Pick at least one day to spread these hours across.'}
            </p>
          </div>

          {/* Day toggles */}
          <div className="lg:col-span-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2">
              Admin days
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DAYS.map(d => {
                const active = draftDays.includes(d);
                return (
                  <button
                    key={d}
                    onClick={() => toggleDraftDay(d)}
                    className={cn(
                      "px-3.5 py-2 rounded-lg border text-sm font-bold transition-colors",
                      active
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-slate-600 border-border hover:border-primary/40"
                    )}
                    data-testid={`day-toggle-${d.toLowerCase()}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {draftDays.length === 0
                ? 'No days selected — your week is unscheduled.'
                : <>Admin will sit across <strong className="text-foreground">{draftDays.join(', ')}</strong>.</>}
            </p>
          </div>
        </div>

        {dirty && (
          <div className="px-6 py-3 border-t border-border bg-amber-50/50 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
              <AlertTriangle size={12} />
              Unsaved changes — your dashboard won't update until you save.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={resetDraft}
                disabled={!weekSetup}
                className="text-xs text-muted-foreground font-semibold px-3 py-1.5 rounded-lg hover:bg-white transition-colors disabled:opacity-40"
              >
                Discard
              </button>
              <button
                onClick={saveAvailability}
                className="bg-primary text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
                data-testid="button-save-availability"
              >
                Save changes
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Email Draft Slide-over */}
      {openItem && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setOpenItem(null)} />
          <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Draft Reply</p>
                <h3 className="text-base font-bold">{openItem.title}</h3>
              </div>
              <button onClick={() => setOpenItem(null)} className="p-2 rounded-full hover:bg-slate-100 text-muted-foreground transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sourceEmail && (
                <div className="mx-6 mt-5 p-4 bg-slate-50 border border-border rounded-xl">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Original email</p>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-bold text-foreground">{sourceEmail.from}</p>
                    {sourceEmail.isProfessional && (
                      <span className="text-[9px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                        <Users size={8} /> Professional
                      </span>
                    )}
                    {sourceEmail.isMeeting && (
                      <span className="text-[9px] font-bold text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                        <CalendarClock size={8} /> Meeting
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{sourceEmail.date} · {sourceEmail.subject}</p>
                  <p className="text-sm text-foreground leading-relaxed">{sourceEmail.body}</p>
                </div>
              )}
              <div className="mx-6 mt-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">AI Draft Response</p>
                  <p className="text-[10px] font-medium text-muted-foreground">Editable — tweak before sending</p>
                </div>
                <textarea
                  value={currentDraftBody}
                  onChange={(e) => setEditedDrafts(prev => ({ ...prev, [openItem.id]: e.target.value }))}
                  rows={Math.max(8, currentDraftBody.split('\n').length + 1)}
                  className="w-full p-4 bg-white border border-border rounded-xl text-sm text-foreground leading-relaxed font-sans resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  data-testid="textarea-draft-reply"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3">
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent transition-colors"
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleSend}
                className="flex-1 flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                <Send size={14} />
                Mark as sent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
