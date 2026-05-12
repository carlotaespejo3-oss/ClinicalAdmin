import { useState, useEffect } from 'react';
import { PenTool, Sparkles, Loader2, Users, Heart, Stethoscope, UserCheck, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sentEmails } from '@/lib/data';
import { cn } from '@/lib/utils';
import { useAiComplete } from '@workspace/api-client-react';
import type { RecipientType } from '@/lib/signatures';
import {
  parseStyleProfile,
  saveStyleProfile,
  loadStyleProfile,
  DEFAULT_TONE_PROFILES,
  type StyleProfile,
  type StyleProfileSection,
} from '@/lib/styleProfile';

const SECTION_META: Array<{ type: RecipientType; icon: typeof Users; color: string; bg: string }> = [
  { type: 'Admin Team', icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { type: 'Families', icon: Heart, color: 'text-blue-600', bg: 'bg-blue-50' },
  { type: 'Other Professionals', icon: Stethoscope, color: 'text-violet-600', bg: 'bg-violet-50' },
  { type: 'Recurrent Families / Patients', icon: UserCheck, color: 'text-amber-600', bg: 'bg-amber-50' },
];

const FIELD_LABELS: Array<{ key: keyof StyleProfileSection; label: string; multiline?: boolean }> = [
  { key: 'tone', label: 'Tone', multiline: true },
  { key: 'greeting', label: 'Greeting' },
  { key: 'signOff', label: 'Sign-off' },
  { key: 'keyPhrases', label: 'Key phrases', multiline: true },
];

export default function StyleTab() {
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const aiComplete = useAiComplete();

  useEffect(() => {
    setProfile(loadStyleProfile());
  }, []);

  const handleBuild = () => {
    const sample = sentEmails.map(e => `To: ${e.to}\nSubject: ${e.subject}\nBody: ${e.body}`).join('\n\n---\n\n');
    const prompt = `Analyse this clinician's writing style. Return EXACTLY this format:\nOVERALL: [2-sentence voice summary]\n\nADMIN TEAM\nGreeting: ...\nTone: ...\nSign-off: ...\nKey phrases: ...\n\n[repeat for FAMILIES, OTHER PROFESSIONALS, RECURRENT FAMILIES / PATIENTS]\n\nEmails:\n${sample}`;

    aiComplete.mutate({ data: { prompt } }, {
      onSuccess: (res) => {
        const parsed = parseStyleProfile(res.text);
        if (!parsed.overall) {
          parsed.overall = 'Concise, professional, and empathetic clinical communication.';
        }
        saveStyleProfile(parsed);
        setProfile(parsed);
      }
    });
  };

  const updateSection = (type: RecipientType, field: keyof StyleProfileSection, value: string) => {
    setProfile(prev => {
      const base = prev ?? { overall: '', sections: {}, builtAt: 0 };
      const current = base.sections[type] ?? { ...DEFAULT_TONE_PROFILES[type] };
      const next: StyleProfile = {
        ...base,
        sections: { ...base.sections, [type]: { ...current, [field]: value } },
      };
      saveStyleProfile(next);
      return next;
    });
  };

  const updateOverall = (value: string) => {
    setProfile(prev => {
      const base = prev ?? { overall: '', sections: {}, builtAt: 0 };
      const next: StyleProfile = { ...base, overall: value };
      saveStyleProfile(next);
      return next;
    });
  };

  const resetSection = (type: RecipientType) => {
    setProfile(prev => {
      const base = prev ?? { overall: '', sections: {}, builtAt: 0 };
      const next: StyleProfile = {
        ...base,
        sections: { ...base.sections, [type]: { ...DEFAULT_TONE_PROFILES[type] } },
      };
      saveStyleProfile(next);
      return next;
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="max-w-xl">
          <h2 className="text-2xl font-bold tracking-tight">Writing Style Profile</h2>
          <p className="text-muted-foreground mt-1">
            Each recipient group has a built-in tone you can edit inline. Or let the AI analyse your sent emails to refine it.
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

      {profile && (
        <div className="space-y-6">
          <Card className="border-primary/20 bg-primary/5 shadow-sm">
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="p-3 bg-white rounded-xl text-primary shadow-sm h-fit">
                  <PenTool size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">Overall Voice</h3>
                  <textarea
                    value={profile.overall}
                    onChange={e => updateOverall(e.target.value)}
                    rows={2}
                    className="w-full text-lg font-medium leading-relaxed italic bg-transparent border border-transparent hover:border-primary/30 focus:border-primary/50 focus:bg-white rounded-lg px-2 py-1 -mx-2 -my-1 resize-none focus:outline-none transition-colors"
                    data-testid="input-overall-voice"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SECTION_META.map((s) => {
              const section = profile.sections[s.type] ?? { ...DEFAULT_TONE_PROFILES[s.type] };
              return (
                <Card
                  key={s.type}
                  className="border-border/50 shadow-sm hover:border-primary/30 transition-colors"
                  data-testid={`style-section-${s.type}`}
                >
                  <CardHeader className={cn('pb-3 border-b border-border/30 flex flex-row items-center justify-between gap-2', s.bg)}>
                    <CardTitle className={cn('text-xs font-bold uppercase tracking-widest flex items-center gap-2', s.color)}>
                      <s.icon size={14} /> {s.type}
                    </CardTitle>
                    <button
                      type="button"
                      onClick={() => resetSection(s.type)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-white/60"
                      data-testid={`reset-${s.type}`}
                      title="Restore the built-in default values"
                    >
                      <RotateCcw size={11} /> Reset to default
                    </button>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3">
                    {FIELD_LABELS.map(f => (
                      <div key={f.key} className="space-y-1">
                        <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
                          {f.label}
                        </label>
                        {f.multiline ? (
                          <textarea
                            value={section[f.key]}
                            onChange={e => updateSection(s.type, f.key, e.target.value)}
                            rows={2}
                            className="w-full text-sm bg-transparent border border-transparent hover:border-border focus:border-primary/50 focus:bg-white rounded-md px-2 py-1.5 resize-y focus:outline-none transition-colors leading-relaxed"
                            data-testid={`input-${s.type}-${f.key}`}
                          />
                        ) : (
                          <input
                            type="text"
                            value={section[f.key]}
                            onChange={e => updateSection(s.type, f.key, e.target.value)}
                            className="w-full text-sm font-semibold bg-transparent border border-transparent hover:border-border focus:border-primary/50 focus:bg-white rounded-md px-2 py-1.5 focus:outline-none transition-colors"
                            data-testid={`input-${s.type}-${f.key}`}
                          />
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
