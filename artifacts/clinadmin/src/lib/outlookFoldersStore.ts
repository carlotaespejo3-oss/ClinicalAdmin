import { useEffect, useState } from 'react';
import {
  listOutlookFolders,
  listOutlookFolderMessages,
  listCustomFolderMessages,
  moveEmailBetweenOutlookFolders,
  type OutlookFolderRecord,
  type OutlookMessageRecord,
} from '@workspace/api-client-react';

// Live read of the Outlook folder tree and folder contents through
// the email-fetch adapter (Microsoft Graph in production, server-
// side seed today). Nothing returned here is persisted — that is the
// whole point of the three-bucket rule.
//
// `version` is a module-level counter that bumps on every move so
// any folder list / message list currently on screen re-fetches
// fresh data. This is the "optimistic followed by reconciliation"
// approach — the move POST goes out, then we re-pull authoritative
// state from the adapter rather than mutating local copies in two
// places.

export type OutlookFolder = OutlookFolderRecord;
export type OutlookMessage = OutlookMessageRecord;

const versionListeners = new Set<() => void>();
let globalVersion = 0;

function bumpVersion(): void {
  globalVersion += 1;
  versionListeners.forEach((l) => l());
}

function useGlobalVersion(): number {
  const [v, setV] = useState(globalVersion);
  useEffect(() => {
    const l = () => setV(globalVersion);
    versionListeners.add(l);
    return () => {
      versionListeners.delete(l);
    };
  }, []);
  return v;
}

export function useOutlookFolders(): { folders: OutlookFolder[]; loading: boolean; reload: () => void } {
  const [folders, setFolders] = useState<OutlookFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [localVersion, setLocalVersion] = useState(0);
  const version = useGlobalVersion();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listOutlookFolders()
      .then((rows) => {
        if (cancelled) return;
        // Guard against unexpected non-array responses (e.g. API error objects,
        // null, or undefined) so that callers can always safely call .filter().
        setFolders(Array.isArray(rows) ? rows : []);
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[outlookFoldersStore] list failed', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [localVersion, version]);

  return { folders, loading, reload: () => setLocalVersion((v) => v + 1) };
}

export function useOutlookFolderMessages(
  folderId: string | null,
): { messages: OutlookMessage[]; loading: boolean } {
  const [messages, setMessages] = useState<OutlookMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const version = useGlobalVersion();

  useEffect(() => {
    if (!folderId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listOutlookFolderMessages(encodeURIComponent(folderId))
      .then((rows) => {
        if (cancelled) return;
        setMessages(Array.isArray(rows) ? rows : []);
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[outlookFoldersStore] messages failed', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId, version]);

  return { messages, loading };
}

// Same shape as Outlook messages — server resolves assignments back
// to live message rows via the adapter.
export function useCustomFolderMessages(
  folderId: string | null,
): { messages: OutlookMessage[]; loading: boolean } {
  const [messages, setMessages] = useState<OutlookMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const version = useGlobalVersion();

  useEffect(() => {
    if (!folderId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listCustomFolderMessages(encodeURIComponent(folderId))
      .then((rows) => {
        if (cancelled) return;
        setMessages(Array.isArray(rows) ? rows : []);
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[outlookFoldersStore] custom folder messages failed', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId, version]);

  return { messages, loading };
}

export async function moveOutlookMessage(
  outlookEmailId: number | string,
  toFolderId: string,
): Promise<void> {
  try {
    await moveEmailBetweenOutlookFolders({
      outlookEmailId: String(outlookEmailId),
      toFolderId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[outlookFoldersStore] move failed', err);
  } finally {
    // Reconcile: pull fresh folder counts + folder contents.
    bumpVersion();
  }
}

// Custom-folder assignment changes (add / remove) also affect the
// custom-folder message list shown to the right of the folder
// column — expose a bump so the assignments store can trigger a
// refresh after its own optimistic write.
export function bumpFolderViews(): void {
  bumpVersion();
}
