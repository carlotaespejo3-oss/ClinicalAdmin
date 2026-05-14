import { useSyncExternalStore } from 'react';

// Local audit trail of every reply the clinician HANDS OFF to their
// mail client via the mailto: link. We can't see what the mail client
// actually does after that — the user could cancel in Outlook, the
// URL could exceed the client's length limit, etc — so this is a
// "handoff log", not a true sent log. The UI surfaces it that way.
//
// Privacy: this store lives in browser localStorage, which is readable
// by any script on the origin. For a clinical app the draft bodies
// almost certainly contain patient PII, so we deliberately persist
// only a short SNIPPET for audit purposes, not the full body.
//
// Deliberately separate from `archivedStore` because (a) handing off
// a reply does not auto-archive — the clinician may still want to
// send follow-ups — and (b) one email can have multiple handoff
// entries (single + admin, retried draft, etc).

export type DraftVariant = 'single' | 'family' | 'admin' | 'chat' | 'unknown';

const SNIPPET_MAX = 120;

export interface SentLogEntry {
  id: string;             // generated, unique per handoff
  emailId: number;        // original email being replied to
  to: string;             // recipient address (best-effort extracted from From)
  toLabel: string;        // human-readable sender label as shown in the inbox
  subject: string;        // final subject line we put in the mailto link
  bodySnippet: string;    // first ~120 chars of the draft, for audit only
  bodyChars: number;      // full draft length, so we can show "of N chars"
  variant: DraftVariant;  // which draft slot this came from
  sentAt: number;         // epoch ms when we opened the mailto handoff
}

const KEY = 'clinadmin-sent-log-v1';
const listeners = new Set<() => void>();
let cache: SentLogEntry[] | null = null;

function load(): SentLogEntry[] {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    cache = raw ? (JSON.parse(raw) as SentLogEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist() {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

function emit() {
  cache = cache ? [...cache] : [];
  persist();
  listeners.forEach((l) => l());
}

export interface RecordSentInput {
  emailId: number;
  to: string;
  toLabel: string;
  subject: string;
  body: string;            // full draft — we snip and discard the rest
  variant: DraftVariant;
}

export function recordSent(input: RecordSentInput): SentLogEntry {
  const snippet =
    input.body.length > SNIPPET_MAX
      ? `${input.body.slice(0, SNIPPET_MAX).trimEnd()}…`
      : input.body;
  const full: SentLogEntry = {
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    emailId: input.emailId,
    to: input.to,
    toLabel: input.toLabel,
    subject: input.subject,
    bodySnippet: snippet,
    bodyChars: input.body.length,
    variant: input.variant,
    sentAt: Date.now(),
  };
  const next = [...load(), full];
  cache = next;
  emit();
  return full;
}

export function clearSentLog() {
  cache = [];
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();
const getServerSnapshot = () => load();

export function useSentLog(): SentLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Convenience selector: most recent sent entry per emailId, or null.
export function lastSentByEmailId(log: SentLogEntry[]): Map<number, SentLogEntry> {
  const map = new Map<number, SentLogEntry>();
  for (const e of log) {
    const cur = map.get(e.emailId);
    if (!cur || cur.sentAt < e.sentAt) map.set(e.emailId, e);
  }
  return map;
}
