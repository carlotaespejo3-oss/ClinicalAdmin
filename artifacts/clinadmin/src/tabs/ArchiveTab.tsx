import { useMemo } from 'react';
import { Archive, CheckCircle2, Undo2, Mail } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { emails } from '@/lib/data';
import { cn, initials, avatarColor } from '@/lib/utils';
import { useArchivedEmails, unarchiveEmail } from '@/lib/archivedStore';
import { unacknowledgeEmail } from '@/lib/acknowledgedStore';
import { useAiClassifications } from '@/lib/aiClassifyStore';
import { useSentLog, lastSentByEmailId } from '@/lib/sentLogStore';
import { Send } from 'lucide-react';
import { CATEGORY_LABEL, CATEGORY_BADGE } from '@/lib/aiCategory';
import OnLeaveTabBanner from '@/components/OnLeaveTabBanner';
import type { WeekSetup } from '@/pages/ClinAdmin';

interface Props {
  weekSetup?: WeekSetup | null;
}

function fmtAgo(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ArchiveTab({ weekSetup = null }: Props = {}) {
  const archived = useArchivedEmails();
  const classifications = useAiClassifications();
  const sentLog = useSentLog();
  const lastSentMap = useMemo(() => lastSentByEmailId(sentLog), [sentLog]);

  const items = useMemo(() => {
    const entries = Array.from(archived.values()).sort((a, b) => b.at - a.at);
    return entries
      .map((entry) => {
        const email = emails.find((e) => e.id === entry.id);
        return email ? { entry, email } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [archived]);

  const handleRestore = (id: number) => {
    unarchiveEmail(id);
    // Keep acknowledgedStore in sync so Forecast / Today counts pick the email back up.
    unacknowledgeEmail(id);
  };

  const ackCount = items.filter((i) => i.entry.kind === 'acknowledged').length;
  const doneCount = items.filter((i) => i.entry.kind === 'done').length;

  return (
    <div className="h-[calc(100vh-12rem)] flex flex-col gap-4 animate-in fade-in duration-500">
      <OnLeaveTabBanner weekSetup={weekSetup} surface="archive" />
      <div className="flex items-center justify-between border border-border/50 rounded-xl bg-card shadow-sm px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <Archive size={18} className="text-slate-700" />
          </div>
          <div>
            <h2 className="text-lg font-bold leading-tight">Archive</h2>
            <p className="text-xs text-muted-foreground">
              Emails you've acknowledged or marked as done. Restore any item to send it back to your inbox.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Acknowledged</span>
            <span className="text-xl font-bold tabular-nums">{ackCount}</span>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Done</span>
            <span className="text-xl font-bold tabular-nums">{doneCount}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 border border-border/50 rounded-xl bg-card shadow-sm overflow-hidden">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
            <Mail size={48} className="mb-4 opacity-20" />
            <p className="font-semibold">Archive is empty</p>
            <p className="text-xs mt-1">
              When you acknowledge an email or mark one as done, it'll move here.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <ul className="divide-y divide-border" data-testid="archive-list">
              {items.map(({ entry, email }) => {
                const cls = classifications.get(email.id);
                const isDone = entry.kind === 'done';
                return (
                  <li
                    key={email.id}
                    className="p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors"
                    data-testid={`archive-row-${email.id}`}
                  >
                    <div
                      className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0',
                        avatarColor(email.from),
                      )}
                    >
                      {initials(email.from)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1 gap-3">
                        <p className="text-sm font-bold truncate">{email.from}</p>
                        <span className="text-[10px] text-muted-foreground font-medium uppercase whitespace-nowrap">
                          archived {fmtAgo(entry.at)}
                        </span>
                      </div>
                      <p className="text-xs font-semibold mb-1 truncate text-foreground/80">{email.subject}</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mb-2">{email.preview}</p>
                      <div className="flex items-center flex-wrap gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 text-[10px] font-bold border px-2 py-0.5 rounded-full',
                            isDone
                              ? 'border-blue-200 bg-blue-50 text-blue-700'
                              : 'border-green-200 bg-green-50 text-green-700',
                          )}
                        >
                          <CheckCircle2 size={10} />
                          {isDone ? 'Marked as done' : 'Acknowledged — no action'}
                        </span>
                        {cls && (
                          <span
                            className={cn(
                              'inline-flex items-center text-[10px] font-bold border px-2 py-0.5 rounded-full',
                              CATEGORY_BADGE[cls.category],
                            )}
                          >
                            {CATEGORY_LABEL[cls.category]}
                          </span>
                        )}
                        {(() => {
                          const sent = lastSentMap.get(email.id);
                          if (!sent) return null;
                          return (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold border border-primary/30 bg-primary/5 text-primary px-2 py-0.5 rounded-full"
                              title={`Reply opened in your mail app ${fmtAgo(sent.sentAt)} via ${sent.variant} draft`}
                              data-testid={`archive-sent-${email.id}`}
                            >
                              <Send size={10} /> Reply drafted {fmtAgo(sent.sentAt)}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestore(email.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold bg-slate-50 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                      data-testid={`button-restore-${email.id}`}
                      title="Send back to inbox"
                    >
                      <Undo2 size={12} />
                      Restore
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
