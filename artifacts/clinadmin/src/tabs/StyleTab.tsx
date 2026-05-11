import { useState } from 'react';
import { PenTool, Sparkles, Loader2, Mail, CheckCircle, ChevronRight, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sentEmails } from '@/lib/data';
import { cn } from '@/lib/utils';
import { useAiComplete } from '@workspace/api-client-react';

export default function StyleTab() {
  const [profile, setProfile] = useState<any>(null);
  const aiComplete = useAiComplete();

  const handleBuild = () => {
    const sample = sentEmails.map(e => `To: ${e.to}\nSubject: ${e.subject}\nBody: ${e.body}`).join('\n\n---\n\n');
    const prompt = `Analyse this clinician's writing style. Return EXACTLY this format:\nOVERALL: [2-sentence voice summary]\n\nPARENTS/FAMILIES\nGreeting: ...\nTone: ...\nSign-off: ...\nKey phrases: ...\n\n[repeat for CLINICAL COLLEAGUES, GPs, SCHOOLS / SENCOs, FORMAL / LEGAL]\n\nEmails:\n${sample}`;
    
    aiComplete.mutate({ data: { prompt } }, {
      onSuccess: (res) => {
        // Simple parsing for the mockup
        const lines = res.text.split('\n');
        const overall = lines.find((l: string) => l.startsWith('OVERALL:'))?.replace('OVERALL:', '').trim() || "Concise, professional, and empathetic clinical communication.";
        
        const sections = [
          { type: 'Parents/Families', icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-50' },
          { type: 'Clinical Colleagues', icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
          { type: 'GPs', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { type: 'Schools / SENCOs', icon: MessageSquare, color: 'text-amber-600', bg: 'bg-amber-50' },
          { type: 'Formal / Legal', icon: CheckCircle, color: 'text-slate-600', bg: 'bg-slate-50' },
        ];

        setProfile({ overall, sections });
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="max-w-xl">
          <h2 className="text-2xl font-bold tracking-tight">Writing Style Profile</h2>
          <p className="text-muted-foreground mt-1">
            AI analyses your sent emails to learn your professional voice, ensuring generated drafts sound exactly like you.
          </p>
        </div>
        <button 
          onClick={handleBuild}
          disabled={aiComplete.isPending}
          className="flex items-center gap-2 bg-primary text-white font-bold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
          data-testid="button-build-style"
        >
          {aiComplete.isPending ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />}
          {aiComplete.isPending ? 'Analysing Style...' : 'Build Style Profile'}
        </button>
      </div>

      {profile ? (
        <div className="space-y-6">
          <Card className="border-primary/20 bg-primary/5 shadow-sm">
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="p-3 bg-white rounded-xl text-primary shadow-sm h-fit">
                  <PenTool size={24} />
                </div>
                <div>
                  <h3 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">Overall Voice</h3>
                  <p className="text-lg font-medium leading-relaxed italic">"{profile.overall}"</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {profile.sections.map((s: any, i: number) => (
              <Card key={i} className="border-border/50 shadow-sm hover:border-primary/30 transition-colors">
                <CardHeader className={cn("pb-3 border-b border-border/30", s.bg)}>
                  <CardTitle className={cn("text-xs font-bold uppercase tracking-widest flex items-center gap-2", s.color)}>
                    <s.icon size={14} /> {s.type}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  <div className="space-y-1">
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Tone & Greeting</p>
                    <p className="text-sm font-semibold">Direct & Empathetic • "Dear..."</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Key Phrases</p>
                    <p className="text-xs text-muted-foreground leading-relaxed italic">"Thank you for your update regarding...", "I have reviewed the clinic notes..."</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-20 border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-muted/50 rounded-full text-muted-foreground mb-4">
            <PenTool size={32} />
          </div>
          <p className="font-bold">No style profile active</p>
          <p className="text-sm text-muted-foreground max-w-xs mt-1">Click "Build Style Profile" to let AI learn from your sent items below.</p>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-muted-foreground px-2">Sample Sent Emails (Source Data)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sentEmails.map((e, i) => (
            <Card key={i} className="border-border/50 shadow-sm hover:shadow-md transition-shadow cursor-default">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                      {e.toName.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <p className="text-xs font-bold">{e.toName}</p>
                      <span className="text-[9px] font-bold text-primary uppercase bg-primary/10 px-1.5 py-0.5 rounded">{e.toLabel}</span>
                    </div>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground uppercase">2 days ago</span>
                </div>
                <p className="text-xs font-bold mb-1 truncate">{e.subject}</p>
                <p className="text-[11px] text-muted-foreground line-clamp-2 italic leading-relaxed">"{e.body}"</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
