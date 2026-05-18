import { Loader2, Inbox } from 'lucide-react';
import { useOutlookFolderMessages } from '@/lib/outlookFoldersStore';
import { MoveToFolderButton } from './MoveToFolderMenu';
import { ScrollArea } from '@/components/ui/scroll-area';

// Read-only message list for Outlook-side folders (Sent, Drafts, and
// any user-made Outlook folders). Three-bucket rule: everything on
// screen comes live from the email-fetch adapter. Nothing is
// persisted by ClinAdmin — the contents of Sent / Drafts live in
// Outlook and Outlook only.

interface Props {
  folderId: string;
  folderName: string;
}

export function OutlookFolderView({ folderId, folderName }: Props) {
  const { messages, loading } = useOutlookFolderMessages(folderId);

  return (
    <div
      className="flex-1 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm"
      data-testid={`outlook-folder-view-${folderId}`}
    >
      <div className="p-4 border-b border-border bg-muted/20">
        <h3 className="text-sm font-bold">{folderName}</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Read live from Outlook — ClinAdmin never stores the content of
          these messages.
        </p>
      </div>
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
            <Inbox size={20} className="text-muted-foreground/60" />
            Nothing here.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {messages.map((m) => (
              <div
                key={m.id}
                className="px-4 py-3 hover:bg-muted/30"
                data-testid={`outlook-message-row-${m.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{m.from}</p>
                    <p className="text-xs font-semibold truncate">{m.subject}</p>
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
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
