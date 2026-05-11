import { useState } from 'react';
import { AlertTriangle, ChevronRight, CheckCircle2, CalendarDays, Mail, ClipboardList, ShieldCheck, X, Send, Copy, Check } from 'lucide-react';
import { homePlan, weekData, emails } from '@/lib/data';
import { HomePlanItem } from '@/lib/types';
import { cn } from '@/lib/utils';

function fmtMins(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

const totalPlanned = weekData.reduce((a, d) => a + d.planned, 0);
const totalRecommended = weekData.reduce((a, d) => a + d.recommended, 0);
const diff = totalRecommended - totalPlanned;

export default function HomeTab() {
  const [plan, setPlan] = useState(homePlan);
  const [openItem, setOpenItem] = useState<HomePlanItem | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<number[]>([]);

  const toggleTask = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlan(plan.map(item => item.id === id ? { ...item, done: !item.done } : item));
  };

  const openEmail = (item: HomePlanItem) => {
    if (item.emailId) setOpenItem(item);
  };

  const handleCopy = () => {
    if (openItem?.draftReply) {
      navigator.clipboard.writeText(openItem.draftReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSend = () => {
    if (openItem) {
      setSent(prev => [...prev, openItem.id]);
      setPlan(plan.map(item => item.id === openItem.id ? { ...item, done: true } : item));
      setOpenItem(null);
    }
  };

  const sourceEmail = openItem?.emailId ? emails.find(e => e.id === openItem.emailId) : null;

  return (
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* Risk Banner */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Left — status */}
          <div className="p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={24} className="text-amber-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground font-medium">You are currently:</p>
              <p className="text-xl font-bold text-amber-600">At risk</p>
              <p className="text-sm text-foreground mt-1">You have 4h admin booked this week.</p>
              <p className="text-sm font-semibold text-amber-600">Current workload requires 5h 10min.</p>
              <p className="text-sm text-muted-foreground mt-1">Add 1h this week to avoid 2 emails breaching the 14-day rule.</p>
            </div>
          </div>

          {/* Right — AI recommendation */}
          <div className="p-6 bg-slate-50/60 border-l border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">AI recommendation</p>
            <p className="text-lg font-bold text-foreground leading-tight mb-1">Add 1 extra hour this week</p>
            <div className="flex items-center gap-2 mb-4">
              <p className="text-sm text-muted-foreground">Best option: Add 1h Wednesday afternoon.</p>
              <span className="text-amber-500 text-lg">↓</span>
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
            <button className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline">
              See why this is recommended
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Middle grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Today's Plan — 3/5 */}
        <div className="lg:col-span-3 bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center">
                  <CheckCircle2 size={18} className="text-green-600" />
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
            {plan.map((item, idx) => (
              <li
                key={item.id}
                onClick={() => openEmail(item)}
                className={cn(
                  "flex items-start gap-4 px-6 py-4 transition-colors",
                  item.emailId && !item.done && "cursor-pointer hover:bg-slate-50",
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
                    <span className="font-medium text-muted-foreground/70">Why:</span> {item.why}
                  </p>
                  {item.emailId && !item.done && (
                    <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-semibold text-primary bg-primary/8 px-2 py-0.5 rounded-full border border-primary/20">
                      <Mail size={9} /> Draft ready — click to review
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{item.time}</span>
                  <button
                    onClick={(e) => toggleTask(item.id, e)}
                    className={cn(
                      "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0",
                      item.done ? "bg-green-500 border-green-500" : "border-slate-300 hover:border-primary"
                    )}
                  >
                    {item.done && <Check size={11} className="text-white" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="px-6 py-4 border-t border-border bg-green-50/60 flex items-center gap-3">
            <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
            <p className="text-sm font-medium text-green-700">Finish this list and you're safe for today. 🎉</p>
          </div>
        </div>

        {/* This Week — 2/5 */}
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

          <div className="px-6 py-5 space-y-5">
            {weekData.map((day) => {
              const maxBar = 180;
              const plannedPct = Math.min((day.planned / maxBar) * 100, 100);
              const extraPct = day.addExtra ? Math.min((day.addExtra / maxBar) * 100, 30) : 0;
              return (
                <div key={day.day}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-bold text-foreground">{day.day}</span>
                    <span className="text-xs text-muted-foreground">{fmtMins(day.planned)} planned</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${plannedPct}%` }}
                      />
                      {day.addExtra && (
                        <div
                          className="h-full bg-primary/20 border-l-2 border-dashed border-primary/40"
                          style={{ width: `${extraPct}%` }}
                        />
                      )}
                    </div>
                    {day.addExtra && (
                      <span className="text-[10px] font-bold text-amber-600 whitespace-nowrap">
                        +{fmtMins(day.addExtra)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-6 py-4 border-t border-border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total planned</span>
              <span className="font-semibold">{fmtMins(totalPlanned)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Recommended</span>
              <span className="font-semibold text-amber-600">{fmtMins(totalRecommended)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Difference</span>
              <span className="font-semibold text-amber-600">+{fmtMins(diff)}</span>
            </div>
            <button className="mt-2 text-xs text-primary font-semibold flex items-center gap-1 hover:underline">
              See full weekly plan <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Mail size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">7</p>
            <p className="text-sm font-semibold text-foreground">Emails safely deferred</p>
            <p className="text-xs text-muted-foreground">Scheduled for next week or later.</p>
          </div>
        </div>
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
            <ClipboardList size={20} className="text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">2</p>
            <p className="text-sm font-semibold text-foreground">Tasks scheduled</p>
            <p className="text-xs text-muted-foreground">Reports / letters / admin tasks.</p>
          </div>
        </div>
        <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={20} className="text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">0</p>
              <p className="text-sm font-semibold text-foreground">Unsafe deferrals</p>
              <p className="text-xs text-muted-foreground">You're safe if you follow the plan.</p>
            </div>
          </div>
          <button className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline whitespace-nowrap">
            See what's deferred <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Email Draft Slide-over */}
      {openItem && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpenItem(null)}
          />
          <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Draft Reply</p>
                <h3 className="text-base font-bold">{openItem.title}</h3>
              </div>
              <button
                onClick={() => setOpenItem(null)}
                className="p-2 rounded-full hover:bg-slate-100 text-muted-foreground transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Original email */}
              {sourceEmail && (
                <div className="mx-6 mt-5 p-4 bg-slate-50 border border-border rounded-xl">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Original email</p>
                  <p className="text-xs font-bold text-foreground">{sourceEmail.from}</p>
                  <p className="text-xs text-muted-foreground mb-2">{sourceEmail.date} · {sourceEmail.subject}</p>
                  <p className="text-sm text-foreground leading-relaxed">{sourceEmail.body}</p>
                </div>
              )}

              {/* Draft */}
              <div className="mx-6 mt-4 mb-6">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">AI Draft Response</p>
                <div className="p-4 bg-primary/4 border border-primary/20 rounded-xl">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-primary/15">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground font-medium w-6">To:</span>
                        <span className="font-semibold text-foreground">{openItem.draftTo}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground font-medium w-6">Re:</span>
                        <span className="text-foreground">{openItem.draftSubject}</span>
                      </div>
                    </div>
                  </div>
                  <pre className="text-sm text-foreground leading-relaxed whitespace-pre-wrap font-sans">
                    {openItem.draftReply}
                  </pre>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 border-t border-border flex items-center gap-3">
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
              >
                {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy text'}
              </button>
              <button
                onClick={handleSend}
                className="flex-1 flex items-center justify-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                <Send size={15} />
                Send & mark done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
