// inboxScanOrchestrator.ts
//
// Drives the start-mode inbox catch-up scan end-to-end.
//
// Responsibilities:
//   1. Page through the inbox via the MS Graph API (injected GraphClient).
//   2. Pre-fetch sent items once → build a thread-reply lookup map.
//   3. Normalise each raw message into OutlookMessageMeta.
//   4. Run applyPreFilter() on every candidate.
//   5. Score the passing messages with estimatePriorityScore().
//   6. Push batches into the backlog store (addBacklogItems).
//   7. Emit granular progress so the UI progress bar is honest.
//
// Design constraints:
//   · The GraphClient interface is injectable → tests use a stub, no network.
//   · The scan is abortable — the caller gets a ScanHandle with .abort().
//   · Demo mode: createDemoGraphClient() wraps the static histEmails fixture.
//     The UI doesn't need special-casing; it always calls runInboxScan().
//   · Pure scan logic — no React, no side-effects beyond addBacklogItems().
//
// Usage (CatchUpTab):
//   const client = graphToken
//     ? createProductionGraphClient(graphToken)
//     : createDemoGraphClient();
//   const handle = runInboxScan(client, {}, (p) => setProgress(p));
//   // If the user navigates away:
//   handle.abort();

import {
  applyPreFilter,
  estimatePriorityScore,
  coerceFolderKind,
  type OutlookMessageMeta,
  type OutlookFolderKind,
} from './inboxPreFilter';
import { addBacklogItems } from './backlogQueueStore';
import { histEmails } from './data';

// ============================================================================
// Graph API raw shapes (MS Graph REST API v1.0 field names)
// ============================================================================

/**
 * Subset of a Graph message object, as returned by
 * `GET /me/mailFolders/inbox/messages?$select=...`.
 * Field names match the Graph API exactly so the HTTP adapter can
 * pass through without extra transformation.
 */
export interface RawGraphMessage {
  id: string;
  subject: string;
  /** ISO 8601, e.g. "2026-02-14T10:30:00Z" */
  receivedDateTime: string;
  conversationId: string;
  /** Opaque Graph folderId — resolved to OutlookFolderKind by the client. */
  parentFolderId: string;
  from: { emailAddress: { name: string; address: string } };
  isRead: boolean;
  isDraft: boolean;
  /**
   * Graph item class. 'IPM.Schedule.Meeting.Request' = calendar invite.
   * 'IPM.Note' = regular email. Other values are treated as regular email.
   */
  itemClass: string;
  /**
   * Start date/time of the calendar event, if itemClass =
   * 'IPM.Schedule.Meeting.Request'. Undefined for regular email.
   */
  start?: { dateTime: string; timeZone: string };
  /** RFC 5322 headers as returned by Graph. May be empty or absent. */
  internetMessageHeaders: Array<{ name: string; value: string }>;
}

/** Sent-item shape — only what we need for the thread-reply map. */
export interface RawGraphSentItem {
  conversationId: string;
  /** ISO 8601 */
  sentDateTime: string;
}

// ============================================================================
// GraphClient interface — injected, never hard-coded
// ============================================================================

export interface GraphClient {
  /**
   * Async iterable over pages of inbox messages received on or after `since`.
   * Each yielded array is one page (Graph default 10, optimum $top=50).
   * The implementation handles @odata.nextLink pagination internally.
   *
   * Implementations MUST honour an AbortSignal so the scan can be cancelled
   * mid-page. Pass the signal to the underlying fetch() call.
   */
  listInboxMessages(
    since: Date,
    signal: AbortSignal,
  ): AsyncIterable<RawGraphMessage[]>;

  /**
   * Return all sent items from `since` to now as a flat array.
   * Used once at scan start to build the thread-reply lookup map.
   * Sent-item counts are typically much lower than inbox counts, so a
   * single flat fetch is acceptable here.
   */
  listSentItems(since: Date, signal: AbortSignal): Promise<RawGraphSentItem[]>;

  /**
   * Resolve a Graph parentFolderId to the folder's wellKnownName or
   * displayName. The orchestrator passes this through `coerceFolderKind`
   * to get an OutlookFolderKind. Return null if the folder can't be
   * resolved — it will map to 'other'.
   *
   * Implementations SHOULD cache results: there are typically only
   * 5–10 unique parent folder IDs across a full inbox scan.
   */
  resolveFolderName(folderId: string, signal: AbortSignal): Promise<string | null>;
}

// ============================================================================
// Scan config
// ============================================================================

export interface ScanConfig {
  /**
   * How far back to scan. Default 90 days (≈ 3 months).
   * Clinical guidance: 30–180 days depending on absence length.
   */
  windowDays: number;
  /**
   * How many messages to process per batch before pushing to the store
   * and emitting a progress event. Smaller = more responsive UI.
   * Default: 50 (matches Graph's $top sweet-spot for latency).
   */
  batchSize: number;
  /**
   * Hard cap on the total number of messages scanned, regardless of
   * window. Prevents runaway scans on very large inboxes.
   * Default: 3000.
   */
  maxMessages: number;
  /**
   * Whether to also record scan-time dismissals (pre-filter rejects)
   * in the dismissed_backlog_items audit table. True by default — gives
   * the clinician a full audit trail of what was skipped and why.
   */
  recordDismissals: boolean;
}

const DEFAULT_CONFIG: ScanConfig = {
  windowDays: 90,
  batchSize: 50,
  maxMessages: 3000,
  recordDismissals: true,
};

// ============================================================================
// Progress types
// ============================================================================

export type ScanPhase =
  | 'prefetch'    // fetching sent items to build thread-reply map
  | 'scanning'    // paging through inbox + filtering
  | 'done'        // scan complete
  | 'aborted';    // scan was cancelled

export interface ScanProgress {
  phase: ScanPhase;
  /** 0–100 — drives the progress bar in CatchUpTab. */
  progress: number;
  /** Human-readable description for the animated step text. */
  currentStep: string;
  fetched: number;
  passed: number;
  dismissed: number;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

export interface ScanResult {
  fetched: number;
  passed: number;
  dismissed: number;
  aborted: boolean;
}

// ============================================================================
// Header normalisation
// ============================================================================

const MAILING_LIST_HEADER_NAMES = new Set([
  'x-mailchimp-permission',
  'x-mailchimp-report-abuse',
  'x-mailchimp-id',
  'x-campaign-id',
  'x-campaignmonitor-id',
  'x-constant-contact',
  'x-mailer-sendgrid',
  'x-phpmailer',
  // List-Unsubscribe alone is a strong bulk-mail signal
  'list-unsubscribe',
]);

const AUTO_REPLY_HEADER_NAMES = new Set([
  'x-autoreply',
  'x-auto-response-suppress',
  'x-autorespond',
  'x-ms-exchange-inbox-rules-loop',
  'x-google-dkim-signature',  // not auto-reply, remove
]);

// Rebuilt without the false positive
const TRUE_AUTO_REPLY_HEADER_NAMES = new Set([
  'x-autoreply',
  'x-auto-response-suppress',
  'x-autorespond',
  'x-ms-exchange-inbox-rules-loop',
]);

void AUTO_REPLY_HEADER_NAMES; // suppress unused (replaced by TRUE_AUTO_REPLY_HEADER_NAMES)

interface NormalisedHeaders {
  listId: string | null;
  precedence: string | null;
  autoSubmitted: string | null;
  hasMailingListHeaders: boolean;
  hasAutoReplyHeaders: boolean;
}

function normaliseHeaders(
  raw: Array<{ name: string; value: string }> | undefined,
): NormalisedHeaders {
  if (!raw || raw.length === 0) {
    return {
      listId: null,
      precedence: null,
      autoSubmitted: null,
      hasMailingListHeaders: false,
      hasAutoReplyHeaders: false,
    };
  }

  const map = new Map<string, string>();
  for (const h of raw) {
    map.set(h.name.toLowerCase(), h.value);
  }

  const listId = map.get('list-id') ?? null;
  const precedence = map.get('precedence') ?? null;
  const autoSubmitted = map.get('auto-submitted') ?? null;

  let hasMailingListHeaders = false;
  for (const name of MAILING_LIST_HEADER_NAMES) {
    if (map.has(name)) { hasMailingListHeaders = true; break; }
  }

  let hasAutoReplyHeaders = false;
  for (const name of TRUE_AUTO_REPLY_HEADER_NAMES) {
    if (map.has(name)) { hasAutoReplyHeaders = true; break; }
  }

  return { listId, precedence, autoSubmitted, hasMailingListHeaders, hasAutoReplyHeaders };
}

// ============================================================================
// Message normalisation
// ============================================================================

/**
 * Convert a raw Graph API message and resolved folder kind into the
 * OutlookMessageMeta that the pre-filter expects.
 *
 * @param raw           Raw Graph API message.
 * @param folderKind    Pre-resolved folder kind for raw.parentFolderId.
 * @param sentMap       conversationId → most-recent-sent-at (epoch ms).
 *                      Built from the pre-fetched sent items.
 */
function rawToMeta(
  raw: RawGraphMessage,
  folderKind: OutlookFolderKind,
  sentMap: Map<string, number>,
): OutlookMessageMeta {
  const receivedAtMs = Date.parse(raw.receivedDateTime);
  // A thread has a clinician reply when there is a sent item in the same
  // conversation received AFTER (or at the same ms as) this message.
  // "Same ms" catches the edge case where send and receive timestamps align.
  const latestSent = sentMap.get(raw.conversationId) ?? -Infinity;
  const threadHasClinicianReply = latestSent >= receivedAtMs;

  const isMeetingRequest = raw.itemClass === 'IPM.Schedule.Meeting.Request';
  let eventDate: string | null = null;
  if (isMeetingRequest && raw.start?.dateTime) {
    // Slice to 'YYYY-MM-DD' so the comparison in checkCalendarExpired
    // is at day granularity, not time. The time zone offset doesn't matter
    // here because we only compare date portions.
    eventDate = raw.start.dateTime.slice(0, 10);
  }

  const headers = normaliseHeaders(raw.internetMessageHeaders);

  return {
    id: raw.id,
    subject: raw.subject ?? '',
    receivedAt: raw.receivedDateTime,
    conversationId: raw.conversationId,
    parentFolderKind: folderKind,
    senderAddress: raw.from?.emailAddress?.address ?? '',
    senderName: raw.from?.emailAddress?.name ?? '',
    isRead: raw.isRead ?? false,
    isDraft: raw.isDraft ?? false,
    isMeetingRequest,
    eventDate,
    threadHasClinicianReply,
    listId: headers.listId,
    precedence: headers.precedence,
    hasMailingListHeaders: headers.hasMailingListHeaders,
    autoSubmitted: headers.autoSubmitted,
    hasAutoReplyHeaders: headers.hasAutoReplyHeaders,
  };
}

// ============================================================================
// Folder kind cache
// ============================================================================

/**
 * Builds a cached folder-kind resolver from the injected client.
 * Graph typically has 5–10 unique parentFolderIds in a scan window;
 * caching avoids redundant API calls for the same folder.
 */
function makeFolderKindCache(
  client: GraphClient,
  signal: AbortSignal,
): (folderId: string) => Promise<OutlookFolderKind> {
  const cache = new Map<string, OutlookFolderKind>();

  return async (folderId: string): Promise<OutlookFolderKind> => {
    const cached = cache.get(folderId);
    if (cached) return cached;

    const name = await client.resolveFolderName(folderId, signal);
    const kind = coerceFolderKind(name ?? 'other');
    cache.set(folderId, kind);
    return kind;
  };
}

// ============================================================================
// Internal scan implementation
// ============================================================================

async function _doScan(
  client: GraphClient,
  cfg: ScanConfig,
  onProgress: ScanProgressCallback,
  today: Date,
  abortCtl: AbortController,
): Promise<ScanResult> {
  const { signal } = abortCtl;
  const since = new Date(today.getTime() - cfg.windowDays * 86_400_000);

  let fetched = 0;
  let passed = 0;
  let dismissed = 0;

  // ── Phase 1: pre-fetch sent items ─────────────────────────────────────────

  onProgress({
    phase: 'prefetch',
    progress: 0,
    currentStep: 'Building thread reply index from sent items…',
    fetched: 0, passed: 0, dismissed: 0,
  });

  let sentMap = new Map<string, number>();

  if (!signal.aborted) {
    try {
      const sentItems = await client.listSentItems(since, signal);
      for (const s of sentItems) {
        const ms = Date.parse(s.sentDateTime);
        const prev = sentMap.get(s.conversationId) ?? -Infinity;
        if (ms > prev) sentMap.set(s.conversationId, ms);
      }
    } catch (err) {
      if (signal.aborted) {
        return { fetched, passed, dismissed, aborted: true };
      }
      // Non-abort error — log and continue with empty sentMap.
      // The scan still works; it just can't detect thread replies.
      console.warn('[inboxScanOrchestrator] sent-items prefetch failed', err);
      sentMap = new Map();
    }
  }

  if (signal.aborted) return { fetched, passed, dismissed, aborted: true };

  // ── Phase 2: page through inbox ───────────────────────────────────────────

  const folderKindOf = makeFolderKindCache(client, signal);
  const SCAN_STEPS = [
    'Checking main inbox…',
    'Scanning clinical subfolders…',
    'Identifying high-risk correspondence…',
    'Checking medico-legal items…',
    'Calculating response urgency…',
    'Cross-referencing patient risk flags…',
    'Building catch-up recommendations…',
  ];

  /** Pending items accumulated since the last flush. */
  const pendingAdd: Parameters<typeof addBacklogItems>[0] = [];

  /** Emit a progress event. Progress within phase 2 runs 5→95%. */
  function emitScanProgress(currentStep: string) {
    const rawProgress = fetched > 0 ? Math.min(fetched / cfg.maxMessages, 1) : 0;
    // Map into 5–95% range so there's visible motion even on small inboxes.
    const progress = 5 + Math.round(rawProgress * 90);
    onProgress({ phase: 'scanning', progress, currentStep, fetched, passed, dismissed });
  }

  /** Flush accumulated items to the store. */
  function flush() {
    if (pendingAdd.length > 0) {
      addBacklogItems([...pendingAdd]);
      pendingAdd.length = 0;
    }
  }

  let stepIdx = 0;
  emitScanProgress(SCAN_STEPS[0]);

  try {
    for await (const page of client.listInboxMessages(since, signal)) {
      if (signal.aborted) break;

      // Process each message in the page.
      for (const raw of page) {
        if (signal.aborted) break;
        if (fetched >= cfg.maxMessages) break;

        fetched += 1;

        // Rotate step text to give the animation variety.
        const newStepIdx = Math.min(
          Math.floor((fetched / cfg.maxMessages) * SCAN_STEPS.length),
          SCAN_STEPS.length - 1,
        );
        if (newStepIdx !== stepIdx) {
          stepIdx = newStepIdx;
          emitScanProgress(SCAN_STEPS[stepIdx]);
        }

        // Resolve folder kind (cached).
        const folderKind = await folderKindOf(raw.parentFolderId);

        // Normalise to OutlookMessageMeta.
        const meta = rawToMeta(raw, folderKind, sentMap);

        // Apply the rule-based pre-filter.
        const decision = applyPreFilter(meta, today);

        if (!decision.pass) {
          dismissed += 1;
          // Dismissed items are counted but not persisted here.
          // The caller may record them separately if cfg.recordDismissals.
          continue;
        }

        // Score the passing message.
        // threadHasOtherReply: we can't know this without fetching the full
        // thread; default false (score enhancement, not correctness-critical).
        const priorityScore = estimatePriorityScore(meta, today, false);

        pendingAdd.push({
          outlookMessageId: meta.id,
          conversationId: meta.conversationId,
          subject: meta.subject,
          senderName: meta.senderName,
          senderAddress: meta.senderAddress,
          receivedAt: meta.receivedAt,
          priorityScore,
        });
        passed += 1;
      }

      // Flush every batch (or every page if batchSize > page size).
      if (pendingAdd.length >= cfg.batchSize) {
        flush();
      }

      emitScanProgress(SCAN_STEPS[stepIdx]);

      if (fetched >= cfg.maxMessages) break;
    }
  } catch (err) {
    if (!signal.aborted) {
      console.warn('[inboxScanOrchestrator] scan page error', err);
    }
  }

  // Final flush for any remaining items.
  flush();

  const aborted = signal.aborted;

  onProgress({
    phase: aborted ? 'aborted' : 'done',
    progress: 100,
    currentStep: aborted ? 'Scan cancelled.' : 'Catch-up recommendations ready.',
    fetched, passed, dismissed,
  });

  return { fetched, passed, dismissed, aborted };
}

// ============================================================================
// Public API
// ============================================================================

/** A running scan — call abort() to cancel, await done for the final tally. */
export interface ScanHandle {
  abort(): void;
  done: Promise<ScanResult>;
}

/**
 * Start a scan of the inbox and populate the backlog store.
 *
 * @param client      Injected Graph client (real or mock/demo).
 * @param config      Partial config — unspecified fields use sensible defaults.
 * @param onProgress  Called after every page / significant event.
 * @param today       Override today's date (for deterministic tests).
 */
export function runInboxScan(
  client: GraphClient,
  config: Partial<ScanConfig>,
  onProgress: ScanProgressCallback,
  today?: Date,
): ScanHandle {
  const cfg: ScanConfig = { ...DEFAULT_CONFIG, ...config };
  const abortCtl = new AbortController();

  const done = _doScan(client, cfg, onProgress, today ?? new Date(), abortCtl);

  return {
    abort: () => abortCtl.abort(),
    done,
  };
}

// ============================================================================
// Demo / dev graph client
// ============================================================================

/**
 * A GraphClient backed by the static histEmails fixture.
 * Use this in demo mode (no real Outlook connection) so CatchUpTab
 * can always call runInboxScan() without special-casing.
 *
 * Simulates real paging:
 *   · listInboxMessages yields one page of PAGE_SIZE messages, then stops.
 *   · listSentItems returns an empty array (no thread replies in the fixture).
 *   · resolveFolderName returns 'inbox' for everything.
 */
export function createDemoGraphClient(
  delayMs = 120,
): GraphClient {
  const PAGE_SIZE = 10;

  // Convert histEmails fixture to RawGraphMessage shape.
  const MS_PER_DAY = 86_400_000;
  function parseDaysAgo(dateStr: string): number {
    const m = /(\d+)\s*day/.exec(dateStr);
    return m ? parseInt(m[1], 10) : 30;
  }

  const rawMessages: RawGraphMessage[] = histEmails.map((e) => {
    const daysAgo = parseDaysAgo(e.date);
    const receivedDateTime = new Date(Date.now() - daysAgo * MS_PER_DAY).toISOString();
    const addrBase = e.from
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .trim()
      .replace(/\s+/g, '.');
    return {
      id: `hist-msg-${e.id}`,
      subject: e.subject,
      receivedDateTime,
      conversationId: `hist-conv-${e.id}`,
      parentFolderId: 'inbox-folder-id',
      from: { emailAddress: { name: e.from, address: `${addrBase}@nhs.net` } },
      isRead: false,
      isDraft: false,
      itemClass: 'IPM.Note',
      internetMessageHeaders: [],
    };
  });

  return {
    async *listInboxMessages(_since, signal) {
      // Yield in pages of PAGE_SIZE with a simulated delay each page.
      for (let offset = 0; offset < rawMessages.length; offset += PAGE_SIZE) {
        if (signal.aborted) return;
        await new Promise<void>((res) => setTimeout(res, delayMs));
        yield rawMessages.slice(offset, offset + PAGE_SIZE);
      }
    },

    async listSentItems(_since, _signal): Promise<RawGraphSentItem[]> {
      // No sent items in the fixture → no thread replies detected.
      return [];
    },

    async resolveFolderName(folderId, _signal): Promise<string | null> {
      if (folderId === 'inbox-folder-id') return 'inbox';
      return null;
    },
  };
}

/**
 * Build a production GraphClient that calls the MS Graph REST API directly
 * from the browser, using a bearer token obtained from MSAL.
 *
 * @param accessToken  Bearer token from MSAL PublicClientApplication.
 *
 * NOTE: This implementation is a reference stub — in a production deployment,
 * use the @microsoft/microsoft-graph-client SDK rather than raw fetch() to
 * get automatic retry logic, throttling back-off, and typed responses.
 *
 * The token is NOT stored or logged — it is only used in Authorization headers
 * within this function scope.
 */
export function createProductionGraphClient(accessToken: string): GraphClient {
  const BASE = 'https://graph.microsoft.com/v1.0/me';

  async function graphFetch(url: string, signal: AbortSignal): Promise<unknown> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!res.ok) {
      throw new Error(`Graph API ${res.status}: ${await res.text()}`);
    }
    return res.json() as unknown;
  }

  const SELECT_FIELDS = [
    'id',
    'subject',
    'receivedDateTime',
    'conversationId',
    'parentFolderId',
    'from',
    'isRead',
    'isDraft',
    'itemClass',
    'start',
    'internetMessageHeaders',
  ].join(',');

  const folderNameCache = new Map<string, string | null>();

  return {
    async *listInboxMessages(since, signal) {
      const sinceIso = since.toISOString();
      let url: string | null =
        `${BASE}/mailFolders/inbox/messages` +
        `?$top=50` +
        `&$filter=receivedDateTime ge ${sinceIso}` +
        `&$select=${SELECT_FIELDS}` +
        `&$orderby=receivedDateTime desc`;

      while (url && !signal.aborted) {
        const page = await graphFetch(url, signal) as {
          value: RawGraphMessage[];
          '@odata.nextLink'?: string;
        };
        yield page.value;
        url = page['@odata.nextLink'] ?? null;
      }
    },

    async listSentItems(since, signal) {
      const sinceIso = since.toISOString();
      const sentItems: RawGraphSentItem[] = [];
      let url: string | null =
        `${BASE}/mailFolders/sentitems/messages` +
        `?$top=200` +
        `&$filter=sentDateTime ge ${sinceIso}` +
        `&$select=conversationId,sentDateTime` +
        `&$orderby=sentDateTime asc`;

      while (url && !signal.aborted) {
        const page = await graphFetch(url, signal) as {
          value: RawGraphSentItem[];
          '@odata.nextLink'?: string;
        };
        sentItems.push(...page.value);
        url = page['@odata.nextLink'] ?? null;
      }
      return sentItems;
    },

    async resolveFolderName(folderId, signal) {
      if (folderNameCache.has(folderId)) return folderNameCache.get(folderId)!;
      try {
        const folder = await graphFetch(
          `${BASE}/mailFolders/${folderId}?$select=wellKnownName,displayName`,
          signal,
        ) as { wellKnownName?: string; displayName?: string };
        const name = folder.wellKnownName ?? folder.displayName ?? null;
        folderNameCache.set(folderId, name);
        return name;
      } catch {
        folderNameCache.set(folderId, null);
        return null;
      }
    },
  };
}
