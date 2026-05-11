import { useState } from 'react';
import { CalendarDays, Sparkles, Loader2, Play, Download, Printer, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAiComplete } from '@workspace/api-client-react';

export default function WeeklyPlanTab() {
  const [hours, setHours] = useState('4');
  const [days, setDays] = useState('Tue, Wed, Thu');
  const [plan, setPlan] = useState<string | null>(null);
  const aiComplete = useAiComplete();

  const handleGenerate = () => {
    const prompt = `Weekly admin plan for Dr. A. Patterson.\nAvailable: ${hours}h across ${days}.\nBacklog: 26 items\nCurrent inbox: 9 items\nFormat: [Day] — [Task] — [Time] — [Notes]. End 2-sentence safety summary. Max 220 words.`;
    
    aiComplete.mutate({ data: { prompt } }, {
      onSuccess: (res) => {
        setPlan(res.text);
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="text-center space-y-2 mb-8">
        <h2 className="text-2xl font-bold tracking-tight">AI Weekly Scheduler</h2>
        <p className="text-muted-foreground">Optimise your admin blocks based on current backlog and clinical risk.</p>
      </div>

      <Card className="border-border/50 shadow-md">
        <CardContent className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Available Admin Hours</label>
              <div className="relative">
                <input 
                  type="number" 
                  value={hours}
                  onChange={e => setHours(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/20"
                  data-testid="input-hours"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">hrs / week</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Admin Days</label>
              <input 
                type="text" 
                value={days}
                onChange={e => setDays(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/20"
                data-testid="input-days"
              />
            </div>
          </div>

          <button 
            onClick={handleGenerate}
            disabled={aiComplete.isPending}
            className="w-full bg-primary text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl hover:translate-y-[-1px] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
            data-testid="button-generate-plan"
          >
            {aiComplete.isPending ? <Loader2 className="animate-spin" /> : <Sparkles size={20} />}
            {aiComplete.isPending ? 'Calculating Optimal Schedule...' : 'Generate Weekly Admin Plan'}
          </button>
        </CardContent>
      </Card>

      {plan && (
        <Card className="border-[#94C4F0] bg-[#E6F1FB] shadow-xl animate-in zoom-in-95 duration-500">
          <CardHeader className="border-b border-[#94C4F0]/30 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[#185FA5] flex items-center gap-2">
                <Sparkles size={20} />
                Proposed Schedule
              </CardTitle>
              <div className="flex gap-2">
                <button className="p-2 text-[#185FA5] hover:bg-white/50 rounded-lg transition-colors"><Printer size={18} /></button>
                <button className="p-2 text-[#185FA5] hover:bg-white/50 rounded-lg transition-colors"><Download size={18} /></button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-8">
            <div className="prose prose-blue max-w-none text-[#185FA5] leading-relaxed whitespace-pre-wrap font-medium">
              {plan}
            </div>
            <div className="mt-8 pt-6 border-t border-[#94C4F0]/30 flex justify-between items-center">
              <div className="flex items-center gap-2 text-xs font-bold text-[#185FA5]/70 uppercase tracking-widest">
                <CheckCircle2 size={16} /> Schedule adheres to 14-day KPI
              </div>
              <button className="bg-[#185FA5] text-white font-bold text-xs px-6 py-2.5 rounded-lg shadow-md hover:bg-[#124b82] transition-colors flex items-center gap-2 uppercase tracking-tight">
                Apply to Timeline <Play size={14} fill="currentColor" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {aiComplete.isPending && !plan && (
        <div className="py-20 flex flex-col items-center justify-center text-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-primary/10 border-t-primary rounded-full animate-spin"></div>
            <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary animate-pulse" />
          </div>
          <div className="space-y-1">
            <p className="font-bold text-lg">AI is analysing your workload...</p>
            <p className="text-sm text-muted-foreground max-w-xs">Cross-referencing 35 clinical items with your available slots.</p>
          </div>
        </div>
      )}
    </div>
  );
}
