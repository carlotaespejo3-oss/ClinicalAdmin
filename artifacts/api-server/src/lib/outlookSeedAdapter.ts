// Server-side stand-in for the Microsoft Graph email-fetch adapter.
//
// Three-bucket rule: everything this module returns is "lives in
// Outlook" data. Production will swap this for a Graph client; the
// shape stays the same. NOTHING returned here is persisted by the
// API server.
//
// In-memory only — restart wipes any moves applied via `move()`. That
// is intentional for the seed-backed phase; in production the move
// hits Graph and Outlook is the source of truth.

export type OutlookFolderKind = "system" | "user";
export type OutlookSystemFolder = "inbox" | "sent" | "drafts" | "other";

export interface OutlookFolder {
  id: string;
  name: string;
  kind: OutlookFolderKind;
  systemKind: OutlookSystemFolder | null;
}

export interface OutlookMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  folderId: string;
}

// Folders the clinician sees in Outlook itself. Order matters: system
// folders first (pinned in the UI), then user-made folders.
const FOLDERS: OutlookFolder[] = [
  { id: "inbox", name: "Inbox", kind: "system", systemKind: "inbox" },
  { id: "sent", name: "Sent Items", kind: "system", systemKind: "sent" },
  { id: "drafts", name: "Drafts", kind: "system", systemKind: "drafts" },
  { id: "of_referrals", name: "Referrals", kind: "user", systemKind: null },
  { id: "of_mdt", name: "MDT", kind: "user", systemKind: null },
];

// Seed Outlook messages. The Inbox ids overlap with the client-side
// inbox seed so move-out from Inbox feels live. Sent / Drafts have a
// small handful so the panes aren't empty when the clinician opens
// them for the first time.
const SEED_MESSAGES: OutlookMessage[] = [
  // Inbox — a small sample of what the client seed shows, so when
  // the user moves one into a user folder it disappears from this
  // server-side list too. (The client inbox view still uses its own
  // seed; this server list backs the Outlook-folder view only.)
  {
    id: "1",
    from: "Sasha Chenoweth (parent)",
    subject: "Mia hasn't eaten/self-harm ideation",
    snippet: "I'm very worried about Mia, she hasn't eaten properly for 2 days…",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    folderId: "inbox",
  },
  {
    id: "2",
    from: "Dr. Martinez (GP)",
    subject: "James Okafor urgent clinical",
    snippet: "Urgent clinical update regarding James Okafor following his recent…",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    folderId: "inbox",
  },
  {
    id: "5",
    from: "Patricia Okafor (parent)",
    subject: "Ritalin 54mg early script",
    snippet: "James is running low on his Ritalin 54mg and we are going away…",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    folderId: "inbox",
  },
  // Sent Items — derived from previous mailto handoffs; in production
  // these come from Graph's Sent Items folder.
  {
    id: "sent_1",
    from: "Me",
    subject: "Re: Priya Sharma formulation meeting Thu 2pm",
    snippet: "Happy to attend — please send the dial-in details.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    folderId: "sent",
  },
  {
    id: "sent_2",
    from: "Me",
    subject: "Re: CHYMS Annual Conference — registration",
    snippet: "Confirming I'll attend and have registered.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    folderId: "sent",
  },
  // Drafts — work-in-progress letters held in Outlook.
  {
    id: "drafts_1",
    from: "Me",
    subject: "EHCP letter — Jamie B (draft)",
    snippet: "Dear Mrs Davies, I'm writing in support of Jamie's application…",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    folderId: "drafts",
  },
  // Outlook user folders — clinician's own filing in Outlook itself.
  {
    id: "of_ref_1",
    from: "Dr. H. Patel (paediatrician)",
    subject: "Referral — Sophie L (anxiety, school refusal)",
    snippet: "Forwarding referral for Sophie L, 14, presenting with anxiety…",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    folderId: "of_referrals",
  },
  {
    id: "of_mdt_1",
    from: "MDT Coordinator",
    subject: "Weekly MDT minutes — 12 May",
    snippet: "Minutes attached. Action items highlighted in section 3.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString(),
    folderId: "of_mdt",
  },
];

const messages: Map<string, OutlookMessage> = new Map(
  SEED_MESSAGES.map((m) => [m.id, { ...m }]),
);

export function listFolders(): Array<
  OutlookFolder & { total: number; unread: number }
> {
  return FOLDERS.map((f) => {
    const items = [...messages.values()].filter((m) => m.folderId === f.id);
    return { ...f, total: items.length, unread: 0 };
  });
}

export function listMessages(folderId: string): OutlookMessage[] {
  return [...messages.values()]
    .filter((m) => m.folderId === folderId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function moveMessage(
  outlookEmailId: string,
  toFolderId: string,
): boolean {
  const existing = messages.get(outlookEmailId);
  const folderExists = FOLDERS.some((f) => f.id === toFolderId);
  if (!folderExists) return false;
  if (existing) {
    messages.set(outlookEmailId, { ...existing, folderId: toFolderId });
    return true;
  }
  // Move targets an inbox message the server-side seed doesn't know
  // about (the client has a richer inbox). Synthesise a placeholder
  // row so subsequent reads of the destination folder reflect the
  // move. Graph will not need this — production moves happen Outlook-
  // side and the next list call returns the real row.
  messages.set(outlookEmailId, {
    id: outlookEmailId,
    from: "(moved from Inbox)",
    subject: `Email #${outlookEmailId}`,
    snippet: "(Subject and sender come from Outlook in production.)",
    receivedAt: new Date().toISOString(),
    folderId: toFolderId,
  });
  return true;
}

export function folderExists(folderId: string): boolean {
  return FOLDERS.some((f) => f.id === folderId);
}

// Lookup by message id. Returns null when the adapter doesn't know
// about the id — that's expected for client-only seed inbox IDs
// during the seed-backed phase; the client falls back to its own
// inbox seed in that case.
export function getMessage(outlookEmailId: string): OutlookMessage | null {
  return messages.get(outlookEmailId) ?? null;
}
