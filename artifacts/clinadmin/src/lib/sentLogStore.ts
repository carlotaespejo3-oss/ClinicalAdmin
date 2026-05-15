import { useSyncExternalStore } from 'react';
import {
  listSentLog,
  recordSentLog as apiRecordSentLog,
} from '@workspace/api-client-react';

// Local audit trail of every reply the clinician HANDS OFF to their
// mail client via the mailto: link. We can't see what the mail client
// actually does after that — the user could cancel in Outlook, the
// URL could exceed the client's length limit, etc — so this is a
// "handoff log", not a true sent log. The UI surfaces it that way.
//
// PERSISTENCE: was localStorage, now Postgres via /api/sent-log. Same
// hydrate-once + fire-and-forget model as deferralStore — see that
// file for the full rationale on cache semantics, error policy, and
// the numeric-vs-string ID coercion at the API boundary.
//
// Storage rule (three-bucket): outgoing email content lives in Outlook
// Sent Items, never here. Persisted fields are organisational
// metadata only — id, source email reference, draft variant,
// timestamp. We do NOT store subject, body, or even a body snippet:
// any of those would be email content. The UI tooltip used to show
// "to <recipient>"; that's been dropped — the recipient is visible
// in the email row itself, and persisting it would just be another
// piece of envelope content that lives upstream in Outlook.

export type DraftVariant = 'single' | 'family' | 'admin' | 'chat' | 'unknown';

export interface SentLogEntry {
  id: string;             // generated, unique per handoff
  emailId: number;        // original email being replied to
  variant: DraftVariant;  // which draft slot this came from
  sentAt: number;         // epoch ms when we opened the mailto handoff
}

const listeners = new Set<() => void>();
let cache: SentLogEntry[] = [];
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  cache = [...cache];
  listeners.forEach((l) => l());
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listSentLog();
    // Merge: keep any local entries (added before hydration finished)
    // and append server entries not already present, deduped by id.
    const existing = new Set(cache.map((e) => e.id));
    for (const r of rows) {
      if (existing.has(r.id)) continue;
      const emailId = Number(r.outlookEmailId);
      if (!Number.isFinite(emailId)) continue;
      cache.push({
        id: r.id,
        emailId,
        variant: r.variant,
        sentAt: new Date(r.sentAt).getTime(),
      });
    }
    cache.sort((a, b) => a.sentAt - b.sentAt);
    hydrationDone = true;
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sentLogStore] failed to hydrate from server', err);
    hydrationDone = true;
  }
}

export interface RecordSentInput {
  emailId: number;
  variant: DraftVariant;
}

export function recordSent(input: RecordSentInput): SentLogEntry {
  const entry: SentLogEntry = {
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    emailId: input.emailId,
    variant: input.variant,
    sentAt: Date.now(),
  };
  cache = [...cache, entry];
  emit();
  // Fire-and-forget POST. Server is idempotent on `id`.
  apiRecordSentLog({
    id: entry.id,
    outlookEmailId: String(entry.emailId),
    variant: entry.variant,
    sentAt: new Date(entry.sentAt).toISOString(),
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[sentLogStore] failed to persist handoff', err);
  });
  return entry;
}

// Test-only / dev-only: wipe local cache. Does NOT touch the server.
export function clearSentLog() {
  cache = [];
  hydrationStarted = false;
  hydrationDone = false;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) {
    void hydrate();
  }
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;
const getServerSnapshot = () => cache;

export function useSentLog(): SentLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function isHydrated(): boolean {
  return hydrationDone;
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
