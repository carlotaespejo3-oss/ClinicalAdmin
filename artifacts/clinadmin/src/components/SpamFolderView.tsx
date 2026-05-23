// SpamFolderView.tsx
//
// Shows emails the clinician has marked as spam (manually or via sender
// pattern). From here they can restore individual emails back to the
// inbox, or manage the sender blocklist.

import { useState } from 'react';
import { ShieldOff, RotateCcw, Trash2, X } from 'lucide-react';
import { cn, initials, avatarColor } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { emails } from '@/lib/data';
import {
  useSpamState,
  unmarkSpam,
  unblockSender,
  isSpam,
} from '@/lib/spamStore';

export default function SpamFolderView() {
  const spam = useSpamState();
  const [tab, setTab] = useState<'emails' | 'senders'>('emails');

  // All emails that are currently in spam (manually marked OR sender-matched)
  const spamEmails = emails.filter((e) => isSpam(e.id, e.from));

  return (
    <div className="flex-1 min-w-0 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm">

      {/* Header */}
      <div className="p-4 border-b border-border bg-muted/20 flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded bg-red-100 text-red-600 flex-shrink-0">
            <ShieldOff size={14} />
          </div>
          <div>
            <h2 className="text-sm font-bold">Spam</h2>
            <p className="text-[11px] text-muted-foreground">
              {spamEmails.length === 0
                ? 'No emails marked as spam'
                : `${spamEmails.length} email${spamEmails.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          {(['emails', 'senders'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 text-xs py-1 rounded-md font-medium transition-colors',
                tab === t
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'emails' ? `Emails (${spamEmails.length})` : `Blocked senders (${spam.senderPatterns.length})`}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {tab === 'emails' ? (
          <div className="divide-y divide-border">
            {spamEmails.length === 0 ? (
              <div className="p-8 text-center">
                <ShieldOff size={28} className="mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">No spam here</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Emails you mark as spam will appear here.
                </p>
              </div>
            ) : (
              spamEmails.map((email) => {
                const isManual = spam.emailIds.has(email.id);
                const isSenderBlocked = !isManual && spam.senderPatterns.some(
                  (p) => email.from.toLowerCase().includes(p),
                );
                return (
                  <div
                    key={email.id}
                    className="px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors group"
                  >
                    {/* Avatar */}
                    <div
                      className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 opacity-50',
                        avatarColor(email.from),
                      )}
                    >
                      {initials(email.from)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <p className="text-xs font-semibold truncate flex-1 text-muted-foreground line-through">
                          {email.from}
                        </p>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {email.date}
                        </span>
                      </div>
                      <p className="text-xs truncate text-muted-foreground">{email.subject}</p>
                      {isSenderBlocked && (
                        <span className="inline-block mt-1 text-[10px] bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5 font-medium">
                          Blocked sender
                        </span>
                      )}
                    </div>

                    {/* Restore button */}
                    <button
                      type="button"
                      onClick={() => unmarkSpam(email.id)}
                      title="Restore to inbox"
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary border border-border hover:border-primary/40 rounded-md px-2 py-1 transition-all flex-shrink-0"
                    >
                      <RotateCcw size={11} />
                      Not spam
                    </button>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* Blocked senders tab */
          <div className="p-4 space-y-2">
            {spam.senderPatterns.length === 0 ? (
              <div className="py-8 text-center">
                <Trash2 size={28} className="mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">No blocked senders</p>
                <p className="text-xs text-muted-foreground mt-1">
                  When you mark an email as spam and check "Block sender",<br />
                  they appear here and future emails from them are auto-filtered.
                </p>
              </div>
            ) : (
              spam.senderPatterns.map((pattern) => (
                <div
                  key={pattern}
                  className="flex items-center justify-between gap-3 bg-muted/40 rounded-lg px-3 py-2.5 border border-border/50"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-foreground truncate">{pattern}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Emails containing this will be auto-marked as spam
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => unblockSender(pattern)}
                    title="Remove block"
                    className="text-muted-foreground hover:text-red-600 flex-shrink-0 p-1 rounded hover:bg-red-50 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </ScrollArea>

      {/* Footer note */}
      {spamEmails.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex-shrink-0">
          <p className="text-[11px] text-muted-foreground">
            Spam emails are hidden from your inbox. Restore them at any time.
          </p>
        </div>
      )}
    </div>
  );
}
