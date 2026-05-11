import { Sun, CheckCircle2, TrendingUp, Inbox, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { homePlan, weekData } from '@/lib/data';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export default function HomeTab() {
  const [plan, setPlan] = useState(homePlan);

  const toggleTask = (id: number) => {
    setPlan(plan.map(item => item.id === id ? { ...item, done: !item.done } : item));
  };

  const completedCount = plan.filter(t => t.done).length;
  const progress = (completedCount / plan.length) * 100;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-amber-50 rounded-full text-amber-500">
          <Sun size={32} />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Good morning, Dr. Patterson</h2>
          <p className="text-muted-foreground">Tuesday, 14th May — You have 9 new items in your clinical inbox.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Status Banner */}
        <div className="lg:col-span-12">
          <div className="bg-[#E6F1FB] border border-[#94C4F0] rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-amber-500 rounded-full animate-pulse"></div>
              <p className="font-semibold text-[#185FA5]">Clinically at risk: 2 high-priority items pending review.</p>
            </div>
            <p className="text-sm text-[#185FA5] font-medium italic">
              AI Recommendation: "Prioritise Mia Chen safeguarding review before your 10am clinic."
            </p>
          </div>
        </div>

        {/* Today's Plan */}
        <div className="lg:col-span-7">
          <Card className="h-full border-border/50 shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-primary" />
                  Today's Admin Plan
                </CardTitle>
                <span className="text-xs font-bold px-2 py-1 bg-primary/10 text-primary rounded-full">
                  {completedCount}/{plan.length} DONE
                </span>
              </div>
              <Progress value={progress} className="h-1.5 mt-2" />
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {plan.map((item) => (
                  <li 
                    key={item.id} 
                    className={cn(
                      "p-4 flex items-start gap-4 transition-colors cursor-pointer hover:bg-muted/20",
                      item.done && "bg-muted/10 opacity-60"
                    )}
                    onClick={() => toggleTask(item.id)}
                    data-testid={`task-item-${item.id}`}
                  >
                    <div className={cn(
                      "mt-1 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                      item.done ? "bg-primary border-primary" : "border-muted-foreground/30"
                    )}>
                      {item.done && <CheckCircle2 size={14} className="text-white" />}
                    </div>
                    <div className="flex-1">
                      <p className={cn("text-sm font-semibold", item.done && "line-through")}>{item.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.why}</p>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">{item.time}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* This Week Workload */}
        <div className="lg:col-span-5">
          <Card className="h-full border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp size={18} className="text-primary" />
                Week Load (Planned vs Rec)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              {weekData.map((day) => (
                <div key={day.day} className="space-y-2">
                  <div className="flex justify-between text-xs font-bold">
                    <span>{day.day === 'Tue' ? 'TODAY' : day.day.toUpperCase()}</span>
                    <span>{day.planned}m / {day.recommended}m</span>
                  </div>
                  <div className="relative h-8 w-full bg-muted rounded-md overflow-hidden flex">
                    <div 
                      className="h-full bg-primary/80 flex items-center justify-center text-[10px] text-white font-bold"
                      style={{ width: `${(day.planned / 150) * 100}%` }}
                    >
                      {day.planned}m
                    </div>
                    {day.addExtra && (
                      <div 
                        className="h-full bg-amber-400/60 flex items-center justify-center text-[10px] text-amber-900 font-bold border-l border-amber-500/30"
                        style={{ width: `${(day.addExtra / 150) * 100}%` }}
                      >
                        +{day.addExtra}m rec.
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t border-border flex items-start gap-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Clock size={16} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-bold text-foreground">Insight:</span> Your Wednesday admin block is currently underscheduled by 60 minutes based on backlog volume.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Stats Bottom */}
        <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-border/50 shadow-sm hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                <Inbox size={24} />
              </div>
              <div>
                <p className="text-2xl font-bold">9</p>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Inbox Items</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 shadow-sm hover:border-destructive/50 transition-colors cursor-pointer">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-red-50 text-red-600 rounded-xl">
                <AlertTriangle size={24} />
              </div>
              <div>
                <p className="text-2xl font-bold">2</p>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">High Risk</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 shadow-sm hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-green-50 text-green-600 rounded-xl">
                <Clock size={24} />
              </div>
              <div>
                <p className="text-2xl font-bold">1h 20m</p>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Estimated Clearance</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
