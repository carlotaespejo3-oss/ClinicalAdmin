import { useState, useEffect } from 'react';
import { RefreshCcw, Loader2, Play, ChevronRight, Inbox, AlertTriangle, Clock, Sparkles, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { histEmails, scanSteps } from '@/lib/data';
import { cn } from '@/lib/utils';
import { useAiComplete } from '@workspace/api-client-react';

export default function CatchUpTab() {
  const [step, setStep] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [activeStepText, setActiveStepText] = useState(scanSteps[0]);
  const [formData, setFormData] = useState({ name: 'Dr. Patterson', period: '90', hours: '2', days: 'Tue/Wed' });
  const [plan, setPlan] = useState<string | null>(null);
  const aiComplete = useAiComplete();

  useEffect(() => {
    if (step !== 1) return;
    const interval = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => setStep(2), 500);
          return 100;
        }
        const next = prev + 1;
        const stepIdx = Math.floor((next / 100) * scanSteps.length);
        if (scanSteps[stepIdx]) setActiveStepText(scanSteps[stepIdx]);
        return next;
      });
    }, 30);
    return () => clearInterval(interval);
  }, [step]);

  const handleStartScan = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(1);
  };

  const handleGeneratePlan = () => {
    const backlogDesc = histEmails.map(e => `- ${e.from}: ${e.subject} (${e.date})`).join('\n');
    const prompt = `Staged catch-up plan for Dr. A. Patterson.\nAvailable: ${formData.hours}h/week across ${formData.days}.\nBacklog:\n${backlogDesc}\nCurrent inbox: 9 items\n3-week plan for clearance:`;
    
    aiComplete.mutate({ data: { prompt } }, {
      onSuccess: (res) => {
        setPlan(res.text);
      }
    });
  };

  if (step === 0) {
    return (
      <div className="max-w-xl mx-auto py-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-blue-50 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <RefreshCcw size={32} />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Onboarding: Clinical Catch-up</h2>
          <p className="text-muted-foreground leading-relaxed">
            Welcome back, Dr. Patterson. Let's scan your clinical folders to build a prioritised plan for your return.
          </p>
        </div>

        <Card className="border-border/50 shadow-xl overflow-hidden">
          <CardContent className="p-8">
            <form onSubmit={handleStartScan} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Clinician Name</label>
                  <input 
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    type="text" 
                    className="w-full bg-background border border-border rounded-lg px-4 py-2.5 font-bold focus:outline-none focus:ring-2 focus:ring-primary/20"
                    data-testid="input-clinician-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Scan Period</label>
                    <select 
                      value={formData.period}
                      onChange={e => setFormData({...formData, period: e.target.value})}
                      className="w-full bg-background border border-border rounded-lg px-4 py-2.5 font-bold focus:outline-none"
                    >
                      <option value="30">Last 30 days</option>
                      <option value="60">Last 60 days</option>
                      <option value="90">Last 90 days</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Catch-up Capacity</label>
                    <div className="relative">
                      <input 
                        value={formData.hours}
                        onChange={e => setFormData({...formData, hours: e.target.value})}
                        type="number" 
                        className="w-full bg-background border border-border rounded-lg px-4 py-2.5 font-bold focus:outline-none"
                        data-testid="input-catchup-hours"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">HRS/WK</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Designated Admin Days</label>
                  <input 
                    value={formData.days}
                    onChange={e => setFormData({...formData, days: e.target.value})}
                    type="text" 
                    placeholder="e.g. Tue morning, Thu all day" 
                    className="w-full bg-background border border-border rounded-lg px-4 py-2.5 font-bold focus:outline-none"
                  />
                </div>
              </div>

              <button 
                type="submit"
                className="w-full bg-primary text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl hover:translate-y-[-1px] transition-all flex items-center justify-center gap-3 uppercase tracking-wider"
                data-testid="button-start-scan"
              >
                Start Clinical Scan <ChevronRight size={18} />
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="max-w-xl mx-auto py-24 space-y-12 flex flex-col items-center justify-center">
        <div className="relative">
          <div className="w-24 h-24 border-8 border-primary/10 border-t-primary rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="text-primary animate-pulse" size={32} />
          </div>
        </div>
        
        <div className="text-center space-y-6 w-full">
          <div className="space-y-2">
            <h3 className="text-xl font-bold tracking-tight">Analysing Clinical Backlog</h3>
            <p className="text-sm text-muted-foreground font-medium uppercase tracking-widest">{activeStepText}</p>
          </div>
          
          <div className="space-y-2">
            <Progress value={scanProgress} className="h-2 w-full max-w-md mx-auto" />
            <p className="text-xs font-bold text-primary">{scanProgress}% COMPLETE</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Unresolved Items', val: '26', icon: Inbox, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'High Priority Flags', val: '4', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Estimated Clearance', val: '6.5h', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map((s, i) => (
          <Card key={i} className="border-border/50 shadow-sm">
            <CardContent className="p-6 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl", s.bg, s.color)}>
                <s.icon size={24} />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.val}</p>
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-destructive uppercase tracking-[0.2em] px-2">High Risk Backlog</h4>
            <div className="space-y-2">
              {histEmails.filter(e => e.risk === 'medium').slice(0, 3).map((e) => (
                <div key={e.id} className="bg-card border-l-4 border-l-red-500 border border-border/50 rounded-xl p-4 flex justify-between items-center shadow-sm">
                  <div>
                    <p className="text-sm font-bold">{e.from}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[250px]">{e.subject}</p>
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase bg-muted px-2 py-1 rounded">{e.date}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2">Older Pending Items (Approaching 90d)</h4>
            <div className="space-y-2">
              {histEmails.filter(e => e.risk === 'none').slice(0, 4).map((e) => (
                <div key={e.id} className="bg-card border border-border/50 rounded-xl p-4 flex justify-between items-center shadow-sm opacity-80">
                  <div>
                    <p className="text-sm font-semibold">{e.from}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[250px]">{e.subject}</p>
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">{e.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card className="border-primary/20 shadow-lg bg-white overflow-hidden">
            <div className="bg-primary p-6 text-white">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold flex items-center gap-2">
                  <span className="flex items-center gap-2"><Sparkles size={18} /> AI Clearance Strategy</span>
                </h3>
                <span className="text-[10px] font-bold bg-white/20 px-2 py-1 rounded uppercase">3-Week Plan</span>
              </div>
              <p className="text-xs text-white/80 leading-relaxed">
                Based on your {formData.hours}h/week capacity, we've structured a staged recovery plan to clear your backlog without impacting current clinic time.
              </p>
            </div>
            <CardContent className="p-6">
              {!plan ? (
                <button 
                  onClick={handleGeneratePlan}
                  disabled={aiComplete.isPending}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-700 font-bold py-4 rounded-xl hover:bg-slate-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                  data-testid="button-generate-catchup"
                >
                  {aiComplete.isPending ? <Loader2 className="animate-spin" /> : <Play size={18} fill="currentColor" />}
                  {aiComplete.isPending ? 'Building Recovery Plan...' : 'Generate Catch-up Plan'}
                </button>
              ) : (
                <div className="space-y-6 animate-in zoom-in-95 duration-500">
                  <div className="prose prose-sm prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap font-medium border-l-4 border-primary/20 pl-4">
                    {plan}
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 bg-primary text-white font-bold text-xs py-3 rounded-lg shadow-md hover:bg-primary/90 transition-colors uppercase tracking-tight flex items-center justify-center gap-2">
                      <CheckCircle2 size={14} /> Commit to Timeline
                    </button>
                    <button 
                      onClick={() => setPlan(null)}
                      className="p-3 text-muted-foreground hover:bg-muted rounded-lg border border-border transition-colors"
                    >
                      <RefreshCcw size={16} />
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
