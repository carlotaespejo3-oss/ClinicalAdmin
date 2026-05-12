import { useState } from 'react';
import { Mail, Search, Sparkles, AlertCircle, Send, CheckCircle2, Loader2, RefreshCcw, Clock, ListChecks, Link2 } from 'lucide-react';
import { emails, manualTasks, CAT } from '@/lib/data';
import { cn, initials, avatarColor, catBadge, riskDot } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAiComplete } from '@workspace/api-client-react';
import { detectRecipientType, getSignatureForRecipient } from '@/lib/signatures';

const KIND_LABEL: Record<string, string> = {
  clinical: 'Clinical question',
  triage: 'Triage / quick decision',
  script: 'Script request',
  complex: 'Complex — creates a task',
  admin: 'Admin',
  meeting: 'Meeting / event',
  professional: 'Professional',
  none: 'No action',
};

const KIND_COLOUR: Record<string, string> = {
  clinical: 'bg-red-50 text-red-700 border-red-200',
  triage: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  script: 'bg-blue-50 text-blue-700 border-blue-200',
  complex: 'bg-purple-50 text-purple-700 border-purple-200',
  admin: 'bg-slate-50 text-slate-600 border-slate-200',
  meeting: 'bg-amber-50 text-amber-700 border-amber-200',
  professional: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  none: 'bg-slate-50 text-slate-500 border-slate-200',
};

interface InboxTabProps {
  initialSelectedId?: number | null;
}

export default function InboxTab({ initialSelectedId }: InboxTabProps = {}) {
  const [selectedId, setSelectedId] = useState<number | null>(
    initialSelectedId ?? emails[0]?.id ?? null
  );
  const [aiAnalysis, setAiAnalysis] = useState<Record<number, string>>({});
  const [aiDrafts, setAiDrafts] = useState<Record<number, string>>({});

  const selectedEmail = emails.find(e => e.id === selectedId);
  const aiComplete = useAiComplete();

  const handleClassify = () => {
    if (!selectedEmail) return;
    const prompt = `Analyse:\nCLASSIFICATION: [category]\nRISK FLAGS: [or "None"]\nRECOMMENDED ACTION: [what and when]\nSAFE TO DRAFT BY EMAIL: [Yes/No + reason]\nMax 110 words.\n\nFrom: ${selectedEmail.from}\nSubject: ${selectedEmail.subject}\n---\n${selectedEmail.body}`;
    
    aiComplete.mutate({ data: { prompt } }, {
      onSuccess: (res) => {
        setAiAnalysis(prev => ({ ...prev, [selectedEmail.id]: res.text }));
      }
    });
  };

  const handleDraft = () => {
    if (!selectedEmail) return;
    const recipientType = detectRecipientType(selectedEmail);
    const signature = getSignatureForRecipient(recipientType);
    const signOffLine = signature
      ? `- British English. Recipient type: ${recipientType}. End the reply with EXACTLY this signature (do not modify):\n${signature}`
      : `- British English. Recipient type: ${recipientType}. Sign off: Dr. A. Patterson | Consultant Child Psychiatrist | CAMHS Outpatient`;
    const prompt = `Draft reply for Dr. A. Patterson, NHS CAMHS consultant.\n\nRULES:\n- Risk to life/safeguarding/unsafe: do NOT draft. Explain required action instead.\n- Controlled drugs: acknowledge only.\n- Professional colleagues: collegial, direct.\n- Meeting/events: brief, decisive.\n${signOffLine}\n\nFrom: ${selectedEmail.from}\nSubject: ${selectedEmail.subject}\n---\n${selectedEmail.body}`;

    aiComplete.mutate({ data: { prompt } }, {
      onSuccess: (res) => {
        setAiDrafts(prev => ({ ...prev, [selectedEmail.id]: res.text }));
      }
    });
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex gap-6 animate-in fade-in duration-500">
      {/* List Pane */}
      <div className="w-1/3 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm">
        <div className="p-4 border-b border-border bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input 
              type="text" 
              placeholder="Search clinical inbox..." 
              className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="input-search-inbox"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border">
            {emails.map((e) => (
              <div 
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className={cn(
                  "p-4 cursor-pointer transition-colors relative hover:bg-muted/30",
                  selectedId === e.id ? "bg-blue-50/50 border-l-4 border-primary" : "border-l-4 border-transparent"
                )}
                data-testid={`email-row-${e.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0", avatarColor(e.from))}>
                    {initials(e.from)}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex justify-between items-start mb-1">
                      <p className="text-sm font-bold truncate">{e.from}</p>
                      <span className="text-[10px] text-muted-foreground font-medium uppercase">{e.date}</span>
                    </div>
                    <p className="text-xs font-semibold mb-1 truncate">{e.subject}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{e.preview}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider", catBadge(e.cat))}>
                        {e.cat}
                      </span>
                      {e.risk !== 'none' && (
                        <div className="flex items-center gap-1">
                          <div className={cn("w-1.5 h-1.5 rounded-full", riskDot(e.risk))}></div>
                          <span className="text-[9px] font-bold text-muted-foreground uppercase">{e.risk} risk</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Detail Pane */}
      <div className="flex-1 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm">
        {selectedEmail ? (
          <ScrollArea className="flex-1">
            <div className="p-8">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-xl font-bold mb-2">{selectedEmail.subject}</h3>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs", avatarColor(selectedEmail.from))}>
                      {initials(selectedEmail.from)}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{selectedEmail.from}</p>
                      <p className="text-xs text-muted-foreground">To: Dr. A. Patterson (NHS CAMHS Consultant)</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <span className="text-xs font-bold text-muted-foreground uppercase">{selectedEmail.date}</span>
                  <div className="flex gap-2">
                    <span className={cn("text-[10px] font-bold px-2 py-1 rounded-sm uppercase tracking-widest", catBadge(selectedEmail.cat))}>
                      {selectedEmail.cat}
                    </span>
                  </div>
                </div>
              </div>

              {/* Meta strip: kind, time, deadline */}
              <div className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-border">
                {selectedEmail.kind && (
                  <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border", KIND_COLOUR[selectedEmail.kind])}>
                    {KIND_LABEL[selectedEmail.kind]}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
                  <Clock size={11} /> {selectedEmail.estMin} min to action
                </span>
                {selectedEmail.deadline !== null && (
                  <span className={cn(
                    "inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border",
                    selectedEmail.deadline <= 1
                      ? "bg-red-50 text-red-700 border-red-200"
                      : selectedEmail.deadline <= 3
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  )}>
                    Reply within {selectedEmail.deadline}d
                  </span>
                )}
              </div>

              {/* Linked-task panel for complex emails */}
              {selectedEmail.linkedTaskId && (() => {
                const task = manualTasks.find(t => t.id === selectedEmail.linkedTaskId);
                if (!task) return null;
                return (
                  <div className="mb-6 bg-purple-50/50 border border-purple-200 rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <ListChecks size={15} className="text-purple-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-purple-700 uppercase tracking-widest">Linked task</span>
                          <Link2 size={10} className="text-purple-400" />
                        </div>
                        <p className="text-sm font-bold text-foreground mb-1">{task.title}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="font-semibold">{task.type}</span>
                          <span>·</span>
                          <span><Clock size={9} className="inline" /> {task.estMin} min</span>
                          <span>·</span>
                          <span>Due in {task.deadline}d</span>
                        </div>
                        {task.autoCompleteOnReply && (
                          <p className="text-[11px] text-purple-700 mt-2 font-medium">
                            <span className="inline-block w-1.5 h-1.5 bg-purple-500 rounded-full mr-1.5 align-middle" />
                            Will auto-complete when this email chain closes
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="prose prose-sm max-w-none mb-10 text-foreground leading-relaxed">
                {selectedEmail.body.split('\n').map((line, i) => <p key={i}>{line}</p>)}
              </div>

              <div className="flex gap-4 mb-8">
                <button 
                  onClick={handleClassify}
                  disabled={aiComplete.isPending}
                  className="flex items-center gap-2 bg-blue-50 text-blue-700 font-bold text-xs px-4 py-2.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors disabled:opacity-50"
                  data-testid="button-classify-ai"
                >
                  {aiComplete.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Classify with AI
                </button>
                <button 
                  onClick={handleDraft}
                  disabled={aiComplete.isPending}
                  className="flex items-center gap-2 bg-slate-100 text-slate-700 font-bold text-xs px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-200 transition-colors disabled:opacity-50"
                  data-testid="button-draft-ai"
                >
                  {aiComplete.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Draft reply
                </button>
                <button className="flex items-center gap-2 text-muted-foreground font-bold text-xs px-4 py-2.5 rounded-lg border border-border hover:bg-muted transition-colors">
                  <CheckCircle2 size={14} />
                  Mark as done
                </button>
              </div>

              {/* AI Panels */}
              <div className="space-y-4">
                {aiComplete.isPending && (
                  <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-6 flex flex-col items-center justify-center gap-3 animate-pulse">
                    <Loader2 size={24} className="animate-spin text-primary" />
                    <p className="text-xs font-bold text-primary uppercase tracking-widest">AI analysis in progress...</p>
                  </div>
                )}

                {aiAnalysis[selectedEmail.id] && (
                  <div className="bg-[#E6F1FB] border border-[#94C4F0] rounded-xl p-6 shadow-sm animate-in zoom-in-95 duration-300">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles size={16} className="text-[#185FA5]" />
                      <h4 className="text-xs font-bold text-[#185FA5] uppercase tracking-widest">AI Classification</h4>
                    </div>
                    <div className="text-sm text-[#185FA5] whitespace-pre-wrap leading-relaxed font-medium">
                      {aiAnalysis[selectedEmail.id]}
                    </div>
                  </div>
                )}

                {aiDrafts[selectedEmail.id] && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 shadow-sm animate-in zoom-in-95 duration-300">
                    <div className="flex items-center gap-2 mb-3">
                      <Send size={16} className="text-slate-600" />
                      <h4 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Suggested Draft</h4>
                    </div>
                    {selectedEmail.cat === CAT.UNSAFE && (
                      <div className="bg-red-50 border border-red-100 text-red-700 text-[11px] p-3 rounded-lg mb-4 flex items-center gap-2 font-bold uppercase tracking-tight">
                        <AlertCircle size={14} />
                        Warning: This email may require immediate clinical action instead of a reply.
                      </div>
                    )}
                    <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-l-4 border-slate-300 pl-4 bg-white p-4 rounded shadow-inner">
                      {aiDrafts[selectedEmail.id]}
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <button className="text-[10px] font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1">
                        <RefreshCcw size={10} /> Regenerate
                      </button>
                      <button className="text-[10px] font-bold bg-primary text-white px-4 py-2 rounded shadow hover:bg-primary/90 transition-colors uppercase tracking-tight">
                        Copy to Clipboard
                      </button>
                    </div>
                  </div>
                )}

                {aiComplete.isError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                    <p className="text-sm font-bold text-red-600 mb-2">AI Completion failed to load.</p>
                    <button 
                      onClick={() => handleClassify()}
                      className="text-xs font-bold bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors uppercase"
                    >
                      Retry Connection
                    </button>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
            <Mail size={48} className="mb-4 opacity-20" />
            <p className="font-semibold">Select an email to view</p>
            <p className="text-xs mt-1">Select any item from the left pane to view clinical details and AI tools.</p>
          </div>
        )}
      </div>
    </div>
  );
}
