import { useState } from 'react';
import { FileText, Mail, Send, Copy, Check, X, Users, CalendarClock, Sparkles } from 'lucide-react';
import { homePlan, emails } from '@/lib/data';
import { HomePlanItem } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function DraftsTab() {
  const [drafts, setDrafts] = useState<HomePlanItem[]>(homePlan.filter(p => p.draftReply));
  const [openItem, setOpenItem] = useState<HomePlanItem | null>(null);
  const [copied, setCopied] = useState(false);

  const sourceEmail = openItem?.emailId ? emails.find(e => e.id === openItem.emailId) : null;

  const handleCopy = () => {
    if (openItem?.draftReply) {
      navigator.clipboard.writeText(openItem.draftReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSend = () => {
    if (openItem) {
      setDrafts(prev => prev.filter(d => d.id !== openItem.id));
      setOpenItem(null);
    }
  };

  const handleDiscard = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDrafts(prev => prev.filter(d => d.id !== id));
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center gap-4 pb-1">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <FileText size={24} className="text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Drafts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-generated reply drafts ready for your review.
          </p>
        </div>
      </div>

      {/* Summary card */}
      <div className="bg-white border border-border rounded-2xl shadow-sm p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Sparkles size={20} className="text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">
            {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'} waiting for review
          </p>
          <p className="text-xs text-muted-foreground">
            Click any draft to review the reply and send.
          </p>
        </div>
      </div>

      {/* Drafts list */}
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        {drafts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <Check size={20} className="text-green-600" />
            </div>
            <p className="text-sm font-semibold text-foreground">All drafts cleared</p>
            <p className="text-xs text-muted-foreground mt-1">No replies waiting for review.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {drafts.map((d) => {
              const email = d.emailId ? emails.find(e => e.id === d.emailId) : null;
              return (
                <li
                  key={d.id}
                  onClick={() => setOpenItem(d)}
                  className="flex items-start gap-4 px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  data-testid={`draft-row-${d.id}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Mail size={16} className="text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-bold text-foreground truncate">{d.draftTo}</p>
                      {d.badge === 'professional' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                          <Users size={9} /> Professional
                        </span>
                      )}
                      {d.badge === 'meeting' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                          <CalendarClock size={9} /> Deadline
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground truncate">{d.draftSubject}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{d.draftReply?.split('\n')[0]}</p>
                    {email && (
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        <span className="font-semibold">In reply to:</span> {email.from} — {email.date}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{d.time}</span>
                    <button
                      onClick={(e) => handleDiscard(d.id, e)}
                      className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                      title="Discard draft"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Draft slide-over */}
      {openItem && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setOpenItem(null)} />
          <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Draft Reply</p>
                <p className="text-sm font-bold">{openItem.draftSubject}</p>
              </div>
              <button onClick={() => setOpenItem(null)} className="p-1.5 hover:bg-accent rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">To:</span> {openItem.draftTo}
              </div>
              {sourceEmail && (
                <div className="bg-slate-50 border border-border rounded-xl p-3 text-xs space-y-1">
                  <p className="font-semibold text-foreground">Original message</p>
                  <p className="text-muted-foreground">From: {sourceEmail.from}</p>
                  <p className="text-foreground mt-2 whitespace-pre-wrap">{sourceEmail.body}</p>
                </div>
              )}
              <div className="bg-white border border-border rounded-xl p-4">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Reply</p>
                <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">{openItem.draftReply}</pre>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold border border-border rounded-lg hover:bg-accent transition-colors"
              >
                {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={handleSend}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-colors",
                  "bg-primary text-white hover:bg-primary/90"
                )}
              >
                <Send size={13} /> Send reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
