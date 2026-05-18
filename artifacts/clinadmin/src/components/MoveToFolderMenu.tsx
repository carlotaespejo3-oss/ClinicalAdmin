import { useMemo, useState } from 'react';
import {
  FolderInput,
  Folder,
  Send as SendIcon,
  FileEdit,
  Inbox as InboxIcon,
  FolderMinus,
  Search,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCustomFolders } from '@/lib/customFoldersStore';
import { useOutlookFolders } from '@/lib/outlookFoldersStore';
import {
  assignEmail,
  unassignEmail,
  folderOf,
  useEmailFolderAssignments,
} from '@/lib/emailFolderAssignmentsStore';
import { moveOutlookMessage } from '@/lib/outlookFoldersStore';

// "Move to folder" picker shared between the email row overflow and
// the email detail header. Outlook system + user folders go through
// the Graph move adapter; ClinAdmin custom folders are a DB
// assignment with no Graph side-effect.
//
// "Remove from folder" appears only when the email is currently
// assigned to a custom folder — it un-files the email back into the
// triaged Inbox without touching Outlook at all.

interface Props {
  outlookEmailId: number | string;
  onClose: () => void;
  onMoved?: (label: string) => void;
  className?: string;
}

export function MoveToFolderMenu({ outlookEmailId, onClose, onMoved, className }: Props) {
  const customFolders = useCustomFolders();
  const { folders } = useOutlookFolders();
  // Subscribed only so the menu re-renders if the current assignment
  // changes while it's open — the value itself is read via folderOf.
  useEmailFolderAssignments();
  const currentCustomFolderId = folderOf(outlookEmailId);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);

  const outlookSystem = useMemo(
    () =>
      folders.filter(
        (f) => f.kind === 'system' && f.systemKind !== 'inbox' && matches(f.name),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folders, q],
  );
  const outlookUser = useMemo(
    () => folders.filter((f) => f.kind === 'user' && matches(f.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folders, q],
  );
  const filteredCustom = useMemo(
    () => customFolders.filter((f) => matches(f.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customFolders, q],
  );

  const handleOutlookMove = (folderId: string, label: string) => {
    // Outlook-side move clears any ClinAdmin custom assignment for
    // this email — the email has now left our pane entirely.
    unassignEmail(outlookEmailId);
    void moveOutlookMessage(outlookEmailId, folderId);
    onMoved?.(`Moved to ${label}`);
    onClose();
  };
  const handleCustomMove = (folderId: string, label: string) => {
    assignEmail(outlookEmailId, folderId);
    onMoved?.(`Filed in ${label}`);
    onClose();
  };
  const handleRemove = () => {
    unassignEmail(outlookEmailId);
    onMoved?.('Returned to Inbox');
    onClose();
  };

  const noResults =
    q && outlookSystem.length === 0 && outlookUser.length === 0 && filteredCustom.length === 0;

  return (
    <div
      className={cn(
        'bg-popover border border-border rounded-md shadow-lg py-1 text-xs min-w-[220px] max-h-[360px] overflow-hidden flex flex-col',
        className,
      )}
      data-testid="move-to-folder-menu"
    >
      <div className="px-2 py-1.5 border-b border-border">
        <div className="relative">
          <Search
            size={11}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a folder…"
            className="w-full bg-background border border-border rounded pl-6 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            data-testid="input-move-folder-search"
          />
        </div>
      </div>
      <div className="overflow-y-auto flex-1">
        {currentCustomFolderId && (
          <>
            <button
              onClick={handleRemove}
              className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-amber-700 font-semibold"
              data-testid="move-target-remove"
            >
              <FolderMinus size={12} /> Remove from folder
            </button>
            <div className="border-t border-border my-1" />
          </>
        )}
        {outlookSystem.length > 0 && (
          <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Outlook
          </div>
        )}
        {outlookSystem.map((f) => (
          <button
            key={f.id}
            onClick={() => handleOutlookMove(f.id, f.name)}
            className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2"
            data-testid={`move-target-${f.id}`}
          >
            {f.systemKind === 'sent' ? (
              <SendIcon size={12} />
            ) : f.systemKind === 'drafts' ? (
              <FileEdit size={12} />
            ) : (
              <InboxIcon size={12} />
            )}
            {f.name}
          </button>
        ))}
        {outlookUser.length > 0 && (
          <>
            {outlookSystem.length > 0 && <div className="border-t border-border my-1" />}
            {outlookUser.map((f) => (
              <button
                key={f.id}
                onClick={() => handleOutlookMove(f.id, f.name)}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2"
                data-testid={`move-target-${f.id}`}
              >
                <Folder size={12} /> {f.name}
              </button>
            ))}
          </>
        )}
        {(outlookSystem.length > 0 || outlookUser.length > 0) && (
          <div className="border-t border-border my-1" />
        )}
        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          My folders
        </div>
        {filteredCustom.length === 0 && !q && (
          <p className="px-3 py-1.5 text-[11px] text-muted-foreground italic">
            Create one from the folder list on the left.
          </p>
        )}
        {filteredCustom.map((f) => (
          <button
            key={f.id}
            onClick={() => handleCustomMove(f.id, f.name)}
            className={cn(
              'w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2',
              currentCustomFolderId === f.id && 'text-primary font-semibold',
            )}
            data-testid={`move-target-${f.id}`}
          >
            <Folder size={12} /> {f.name}
            {currentCustomFolderId === f.id && (
              <Check size={11} className="ml-auto text-primary" />
            )}
          </button>
        ))}
        {noResults && (
          <p className="px-3 py-3 text-[11px] text-muted-foreground italic text-center">
            No folders match "{query}".
          </p>
        )}
      </div>
    </div>
  );
}

// Convenience: trigger button + popover the row / detail header can
// drop in without owning open-state. Shows a brief inline
// confirmation toast under the button after a successful move.
export function MoveToFolderButton({
  outlookEmailId,
  variant = 'icon',
}: {
  outlookEmailId: number | string;
  variant?: 'icon' | 'text';
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const showConfirmation = (msg: string) => {
    setConfirmation(msg);
    window.setTimeout(() => setConfirmation(null), 1800);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          'flex items-center gap-1.5 text-xs font-bold rounded-lg border border-border transition-colors',
          variant === 'icon'
            ? 'p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted'
            : 'px-3 py-1.5 bg-slate-50 text-slate-700 hover:bg-slate-100',
        )}
        title="Move to folder"
        data-testid={`button-move-${outlookEmailId}`}
        aria-label="Move to folder"
      >
        <FolderInput size={variant === 'icon' ? 14 : 12} />
        {variant === 'text' && 'Move to folder'}
      </button>
      {confirmation && !open && (
        <div
          className="absolute right-0 top-full mt-1 z-30 bg-foreground text-background text-[10px] font-semibold rounded px-2 py-1 whitespace-nowrap shadow"
          data-testid={`move-confirmation-${outlookEmailId}`}
        >
          {confirmation}
        </div>
      )}
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="absolute right-0 top-full mt-1 z-20"
            onClick={(e) => e.stopPropagation()}
          >
            <MoveToFolderMenu
              outlookEmailId={outlookEmailId}
              onMoved={showConfirmation}
              onClose={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}
