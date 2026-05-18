import { useMemo } from 'react';
import { Loader2, Folder } from 'lucide-react';
import { useCustomFolderMessages } from '@/lib/outlookFoldersStore';
import { MoveToFolderButton } from './MoveToFolderMenu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { emails as seedEmails } from '@/lib/data';

// Message list for a ClinAdmin custom folder. The server resolves
// each assignment back to its live message via the email-fetch
// adapter; assignments whose source the adapter can't resolve come
// back as stub rows that we then merge with the client-side inbox
// seed (numeric IDs) so legacy seed inbox messages still render
// with subject + sender intact.
//
// Storage rule: subject / sender / snippet are always live — never
// persisted by ClinAdmin. The only things saved server-side are the
// folder definition and the (clinician, outlookEmailId, folderId)
// assignment.

interface Props {
  folderId: string;
  folderName: string;
  onSelectSeedEmail?: (id: number) => void;
}

export function CustomFolderView({ folderId, folderName, onSelectSeedEmail }: Props) {
  const { messages, loading } = useCustomFolderMessages(folderId);

  // Merge stub rows (subject==='') with the local inbox seed so
  // legacy numeric IDs from the client seed still render with real
  // sender / subject / preview text.
  const rows = useMemo(() => {
    return messages.map((m) => {
      if (m.subject) return m;
      const idNum = Number(m.id);
      if (!Number.isFinite(idNum)) return m;
      const seed = seedEmails.find((e) => e.id === idNum);
      if (!seed) return m;
      return {
        ...m,
        from: seed.from,
        subject: seed.subject,
        snippet: seed.preview ?? '',
      };
    });
  }, [messages]);

  return (
    <div
      className="flex-1 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm"
      data-testid={`custom-folder-view-${folderId}`}
    >
      <div className="p-4 border-b border-border bg-muted/20 flex items-center gap-2">
        <Folder size={14} className="text-muted-foreground" />
        <div>
          <h3 className="text-sm font-bold">{folderName}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Your filing — emails you've moved here for later. The
            messages themselves stay in Outlook.
          </p>
        </div>
      </div>
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
            <Folder size={20} className="text-muted-foreground/60" />
            Nothing filed here yet. Use "Move to folder" on any email
            to drop it in.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((m) => {
              const idNum = Number(m.id);
              const isSeedInbox = Number.isFinite(idNum);
              return (
                <div
                  key={m.id}
                  onClick={() => {
                    if (isSeedInbox && onSelectSeedEmail) onSelectSeedEmail(idNum);
                  }}
                  className={
                    'px-4 py-3 hover:bg-muted/30 ' +
                    (isSeedInbox && onSelectSeedEmail ? 'cursor-pointer' : '')
                  }
                  data-testid={`custom-message-row-${m.id}`}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">
                        {m.from || '(sender unavailable)'}
                      </p>
                      <p className="text-xs font-semibold truncate">
                        {m.subject || '(subject unavailable)'}
                      </p>
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                        {m.snippet}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {new Date(m.receivedAt).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <MoveToFolderButton outlookEmailId={m.id} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
