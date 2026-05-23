import { useMemo, useState } from 'react';
import {
  Inbox as InboxIcon,
  Send as SendIcon,
  FileEdit,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  X,
  ShieldOff,
} from 'lucide-react';
import { useSpamState } from '@/lib/spamStore';
import { emails } from '@/lib/data';
import { isSpam } from '@/lib/spamStore';
import { cn } from '@/lib/utils';
import {
  useCustomFolders,
  addCustomFolder,
  renameCustomFolder,
  deleteCustomFolder,
} from '@/lib/customFoldersStore';
import {
  useEmailFolderAssignments,
  countByFolder,
  clearFolder,
} from '@/lib/emailFolderAssignmentsStore';
import { useOutlookFolders, type OutlookFolder } from '@/lib/outlookFoldersStore';

// Outlook-style left rail of folders for the Inbox tab.
//
// Storage rule: folder definitions and per-email assignments only.
// Sent / Drafts / Outlook user folders are read live through the
// email-fetch adapter. ClinAdmin custom folders live in our DB and
// are the only ones the clinician can rename or delete.

export type SelectedFolder =
  | { kind: 'system-inbox' }
  | { kind: 'system-spam' }
  | { kind: 'outlook'; folderId: string; folderName: string; systemKind: OutlookFolder['systemKind'] }
  | { kind: 'custom'; folderId: string; folderName: string };

interface Props {
  selected: SelectedFolder;
  onSelect: (next: SelectedFolder) => void;
  inboxCount: number;
}

export function FolderColumn({ selected, onSelect, inboxCount }: Props) {
  const customFolders = useCustomFolders();
  const assignments = useEmailFolderAssignments();
  const { folders: outlookFolders } = useOutlookFolders();
  const spam = useSpamState();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const customCounts = useMemo(() => countByFolder(assignments), [assignments]);

  // Count spam emails (manually marked + sender-pattern matches)
  const spamCount = useMemo(
    () => emails.filter((e) => isSpam(e.id, e.from)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spam],
  );

  // Split Outlook folders into system (Inbox/Sent/Drafts) and user.
  // Inbox is replaced by our own ClinAdmin Inbox row (which uses the
  // client seed list and shows the triaged inbox count). The Outlook
  // adapter's "inbox" folder is hidden — the count there isn't a real
  // unread tally.
  const safeOutlookFolders = Array.isArray(outlookFolders) ? outlookFolders : [];
  const systemFolders = safeOutlookFolders.filter(
    (f) => f.kind === 'system' && f.systemKind !== 'inbox',
  );
  const userOutlookFolders = safeOutlookFolders.filter((f) => f.kind === 'user');

  const isSelected = (kind: SelectedFolder['kind'], id?: string) => {
    if (selected.kind !== kind) return false;
    if (kind === 'system-inbox') return true;
    if (kind === 'system-spam') return true;
    if (kind === 'outlook' && selected.kind === 'outlook')
      return selected.folderId === id;
    if (kind === 'custom' && selected.kind === 'custom')
      return selected.folderId === id;
    return false;
  };

  const startCreate = () => {
    setCreating(true);
    setNewName('');
  };
  const commitCreate = () => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    const created = addCustomFolder(name);
    setCreating(false);
    setNewName('');
    onSelect({ kind: 'custom', folderId: created.id, folderName: created.name });
  };
  const cancelCreate = () => {
    setCreating(false);
    setNewName('');
  };

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameDraft(name);
    setMenuOpenId(null);
  };
  const commitRename = () => {
    if (!renamingId) return;
    const name = renameDraft.trim();
    if (name) {
      renameCustomFolder(renamingId, name);
      if (selected.kind === 'custom' && selected.folderId === renamingId) {
        onSelect({ kind: 'custom', folderId: renamingId, folderName: name });
      }
    }
    setRenamingId(null);
    setRenameDraft('');
  };
  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleDelete = (id: string, name: string) => {
    setMenuOpenId(null);
    const ok = window.confirm(
      `Delete the folder "${name}"? Emails inside it will return to the Inbox.`,
    );
    if (!ok) return;
    deleteCustomFolder(id);
    clearFolder(id);
    if (selected.kind === 'custom' && selected.folderId === id) {
      onSelect({ kind: 'system-inbox' });
    }
  };

  return (
    <div
      className="w-36 flex-shrink-0 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm"
      data-testid="folder-column"
    >
      <div className="p-3 border-b border-border bg-muted/20">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Folders
        </p>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {/* ClinAdmin Inbox (system, pinned) */}
        <FolderRow
          icon={<InboxIcon size={14} />}
          label="Inbox"
          count={inboxCount}
          selected={isSelected('system-inbox')}
          onClick={() => onSelect({ kind: 'system-inbox' })}
          testId="folder-inbox"
        />
        {/* Spam folder (system, pinned) */}
        <FolderRow
          icon={<ShieldOff size={14} className="text-red-500" />}
          label="Spam"
          count={spamCount}
          selected={isSelected('system-spam')}
          onClick={() => onSelect({ kind: 'system-spam' })}
          testId="folder-spam"
          countColour="bg-red-100 text-red-700"
        />
        {/* Other Outlook system folders (Sent, Drafts) */}
        {systemFolders.map((f) => (
          <FolderRow
            key={f.id}
            icon={
              f.systemKind === 'sent' ? (
                <SendIcon size={14} />
              ) : f.systemKind === 'drafts' ? (
                <FileEdit size={14} />
              ) : (
                <Folder size={14} />
              )
            }
            label={f.name}
            count={f.total}
            selected={isSelected('outlook', f.id)}
            onClick={() =>
              onSelect({
                kind: 'outlook',
                folderId: f.id,
                folderName: f.name,
                systemKind: f.systemKind,
              })
            }
            testId={`folder-outlook-${f.id}`}
          />
        ))}

        {/* Outlook user folders (read-only — managed in Outlook itself) */}
        {userOutlookFolders.length > 0 && (
          <div className="mt-3">
            <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Outlook folders
            </p>
            {userOutlookFolders.map((f) => (
              <FolderRow
                key={f.id}
                icon={<Folder size={14} />}
                label={f.name}
                count={f.total}
                selected={isSelected('outlook', f.id)}
                onClick={() =>
                  onSelect({
                    kind: 'outlook',
                    folderId: f.id,
                    folderName: f.name,
                    systemKind: f.systemKind,
                  })
                }
                testId={`folder-outlook-${f.id}`}
              />
            ))}
          </div>
        )}

        {/* ClinAdmin custom folders */}
        <div className="mt-3 pb-2">
          <div className="flex items-center justify-between px-3 py-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              My folders
            </p>
            <button
              onClick={startCreate}
              className="text-muted-foreground hover:text-foreground p-1 rounded"
              title="New folder"
              data-testid="button-new-folder"
            >
              <FolderPlus size={13} />
            </button>
          </div>
          {customFolders.length === 0 && !creating && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground italic">
              No custom folders yet.
            </p>
          )}
          {customFolders.map((f) =>
            renamingId === f.id ? (
              <div
                key={f.id}
                className="flex items-center gap-1 px-3 py-1.5"
                data-testid={`folder-rename-${f.id}`}
              >
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-xs"
                />
                <button
                  onClick={commitRename}
                  className="text-emerald-600 p-1 hover:bg-emerald-50 rounded"
                  data-testid={`button-rename-save-${f.id}`}
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={cancelRename}
                  className="text-muted-foreground p-1 hover:bg-muted rounded"
                  data-testid={`button-rename-cancel-${f.id}`}
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div key={f.id} className="relative group">
                <FolderRow
                  icon={<Folder size={14} />}
                  label={f.name}
                  count={customCounts.get(f.id) ?? 0}
                  selected={isSelected('custom', f.id)}
                  onClick={() =>
                    onSelect({
                      kind: 'custom',
                      folderId: f.id,
                      folderName: f.name,
                    })
                  }
                  testId={`folder-custom-${f.id}`}
                  trailing={
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === f.id ? null : f.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5 rounded"
                      data-testid={`button-folder-menu-${f.id}`}
                      aria-label="Folder actions"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  }
                />
                {menuOpenId === f.id && (
                  <div
                    className="absolute right-2 top-7 z-20 bg-popover border border-border rounded-md shadow-md py-1 text-xs min-w-[120px]"
                    data-testid={`folder-menu-${f.id}`}
                  >
                    <button
                      onClick={() => startRename(f.id, f.name)}
                      className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2"
                    >
                      <Pencil size={11} /> Rename
                    </button>
                    <button
                      onClick={() => handleDelete(f.id, f.name)}
                      className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
          {creating && (
            <div
              className="flex items-center gap-1 px-3 py-1.5"
              data-testid="folder-create-input"
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCreate();
                  if (e.key === 'Escape') cancelCreate();
                }}
                placeholder="Folder name"
                className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-xs"
              />
              <button
                onClick={commitCreate}
                className="text-emerald-600 p-1 hover:bg-emerald-50 rounded"
                data-testid="button-new-folder-save"
              >
                <Check size={12} />
              </button>
              <button
                onClick={cancelCreate}
                className="text-muted-foreground p-1 hover:bg-muted rounded"
                data-testid="button-new-folder-cancel"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FolderRow({
  icon,
  label,
  count,
  selected,
  onClick,
  testId,
  trailing,
  countColour,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  testId: string;
  trailing?: React.ReactNode;
  countColour?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        selected
          ? 'bg-blue-50 text-primary font-bold border-l-2 border-primary'
          : 'hover:bg-muted/40 border-l-2 border-transparent',
      )}
      data-testid={testId}
    >
      <span className="text-muted-foreground flex-shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && (
        <span className={cn(
          'text-[10px] tabular-nums font-medium',
          countColour ? `${countColour} rounded-full px-1.5 py-0.5` : 'text-muted-foreground',
        )}>
          {count}
        </span>
      )}
      {trailing}
    </button>
  );
}
