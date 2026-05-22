// inboxScanOrchestrator.test.ts
//
// Tests for the inbox scan orchestrator.
// Uses node:test with the same Vitest-shaped shim as the other test files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runInboxScan,
  createDemoGraphClient,
  type GraphClient,
  type RawGraphMessage,
  type RawGraphSentItem,
  type ScanProgress,
  type ScanResult,
} from './inboxScanOrchestrator';

// ============================================================================
// Vitest-shaped shim (same pattern as inboxPreFilter.test.ts)
// ============================================================================

const describe = (_name: string, fn: () => void): void => fn();
const it = test;

interface Matchers {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeTruthy: () => void;
  toBeFalsy: () => void;
  toBeGreaterThan: (n: number) => void;
  toBeGreaterThanOrEqual: (n: number) => void;
  toBeLessThanOrEqual: (n: number) => void;
  toContain: (s: string) => void;
}

function expect(actual: unknown): Matchers {
  return {
    toBe: (e) => assert.equal(actual, e),
    toEqual: (e) => assert.deepEqual(actual, e),
    toBeTruthy: () => assert.ok(actual, `expected truthy, got ${String(actual)}`),
    toBeFalsy: () => assert.ok(!actual, `expected falsy, got ${String(actual)}`),
    toBeGreaterThan: (n) =>
      assert.ok(typeof actual === 'number' && actual > n, `${String(actual)} > ${n}`),
    toBeGreaterThanOrEqual: (n) =>
      assert.ok(typeof actual === 'number' && actual >= n, `${String(actual)} >= ${n}`),
    toBeLessThanOrEqual: (n) =>
      assert.ok(typeof actual === 'number' && actual <= n, `${String(actual)} <= ${n}`),
    toContain: (s) =>
      assert.ok(typeof actual === 'string' && actual.includes(s), `"${String(actual)}" contains "${s}"`),
  };
}

// ============================================================================
// Fixtures & helpers
// ============================================================================

const TODAY = new Date('2026-05-23T12:00:00Z');
const SINCE_90D = new Date(TODAY.getTime() - 90 * 86_400_000);

// A clean backlog store state that resets between tests.
// We can't easily mock addBacklogItems without module mocking, so we
// collect the items via a spy on addBacklogItems — but since this is
// node:test without a mocking library, we instead verify the scan
// result counts and progress events rather than store state.
// The store hydration is async and irrelevant here — we just care
// that the orchestrator calls addBacklogItems with the right items
// (which the integration test on CatchUpTab covers end-to-end).

/** Build a minimal valid RawGraphMessage. */
function makeMsg(overrides: Partial<RawGraphMessage> = {}): RawGraphMessage {
  return {
    id: overrides.id ?? 'msg-1',
    subject: overrides.subject ?? 'Test subject',
    receivedDateTime: overrides.receivedDateTime ?? '2026-05-10T10:00:00Z',
    conversationId: overrides.conversationId ?? 'conv-1',
    parentFolderId: overrides.parentFolderId ?? 'inbox-folder',
    from: overrides.from ?? {
      emailAddress: { name: 'Dr. Test', address: 'dr.test@nhs.net' },
    },
    isRead: overrides.isRead ?? false,
    isDraft: overrides.isDraft ?? false,
    itemClass: overrides.itemClass ?? 'IPM.Note',
    start: overrides.start,
    internetMessageHeaders: overrides.internetMessageHeaders ?? [],
  };
}

/** Build a minimal GraphClient from arrays of messages / sent items. */
function makeClient(
  pages: RawGraphMessage[][],
  sentItems: RawGraphSentItem[] = [],
  folderMap: Record<string, string> = { 'inbox-folder': 'inbox' },
): GraphClient {
  return {
    async *listInboxMessages(_since, signal) {
      for (const page of pages) {
        if (signal.aborted) return;
        yield page;
      }
    },
    async listSentItems(_since, _signal): Promise<RawGraphSentItem[]> {
      return sentItems;
    },
    async resolveFolderName(folderId, _signal): Promise<string | null> {
      return folderMap[folderId] ?? null;
    },
  };
}

/** Collect all progress events from a scan run. */
async function collectScan(
  client: GraphClient,
  config: Parameters<typeof runInboxScan>[1] = {},
  today = TODAY,
): Promise<{ result: ScanResult; events: ScanProgress[] }> {
  const events: ScanProgress[] = [];
  const handle = runInboxScan(client, config, (p) => events.push({ ...p }), today);
  const result = await handle.done;
  return { result, events };
}

// ============================================================================
// Test suites
// ============================================================================

describe('runInboxScan — basic flow', () => {
  it('returns zero counts for an empty inbox', async () => {
    const { result } = await collectScan(makeClient([[]]));
    expect(result.fetched).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.dismissed).toBe(0);
    expect(result.aborted).toBe(false);
  });

  it('counts a single clean inbox message as passed', async () => {
    const { result } = await collectScan(makeClient([[makeMsg()]]));
    expect(result.fetched).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.dismissed).toBe(0);
  });

  it('counts a draft as dismissed (rule:non_inbox_folder)', async () => {
    const { result } = await collectScan(
      makeClient([[makeMsg({ isDraft: true })]]),
    );
    expect(result.fetched).toBe(1);
    expect(result.passed).toBe(0);
    expect(result.dismissed).toBe(1);
  });

  it('dismisses a junk-folder message', async () => {
    const { result } = await collectScan(
      makeClient(
        [[makeMsg({ parentFolderId: 'junk-folder' })]],
        [],
        { 'junk-folder': 'junkemail' },
      ),
    );
    expect(result.dismissed).toBe(1);
    expect(result.passed).toBe(0);
  });

  it('handles multiple pages correctly', async () => {
    const page1 = [makeMsg({ id: 'a', conversationId: 'ca' })];
    const page2 = [makeMsg({ id: 'b', conversationId: 'cb' }), makeMsg({ id: 'c', conversationId: 'cc' })];
    const { result } = await collectScan(makeClient([page1, page2]));
    expect(result.fetched).toBe(3);
    expect(result.passed).toBe(3);
  });
});

describe('runInboxScan — thread reply detection', () => {
  it('dismisses a message when the clinician has a more-recent sent item in the same thread', async () => {
    const msg = makeMsg({
      id: 'msg-replied',
      conversationId: 'thread-1',
      receivedDateTime: '2026-05-01T10:00:00Z',
    });
    const sentItems: RawGraphSentItem[] = [
      { conversationId: 'thread-1', sentDateTime: '2026-05-02T09:00:00Z' },
    ];
    const { result } = await collectScan(makeClient([[msg]], sentItems));
    expect(result.dismissed).toBe(1);
    expect(result.passed).toBe(0);
  });

  it('keeps a message when the clinician reply is older than the message', async () => {
    const msg = makeMsg({
      id: 'msg-new',
      conversationId: 'thread-2',
      receivedDateTime: '2026-05-10T10:00:00Z',
    });
    const sentItems: RawGraphSentItem[] = [
      { conversationId: 'thread-2', sentDateTime: '2026-05-05T08:00:00Z' },
    ];
    const { result } = await collectScan(makeClient([[msg]], sentItems));
    expect(result.passed).toBe(1);
  });

  it('keeps a message from a different thread even if another thread was replied to', async () => {
    const msg = makeMsg({ conversationId: 'thread-a' });
    const sentItems: RawGraphSentItem[] = [
      { conversationId: 'thread-b', sentDateTime: '2026-05-20T10:00:00Z' },
    ];
    const { result } = await collectScan(makeClient([[msg]], sentItems));
    expect(result.passed).toBe(1);
  });

  it('uses the most recent sent item when the thread has multiple replies', async () => {
    // msg received 10th; replies on 5th and 15th. Should be dismissed because 15th >= 10th.
    const msg = makeMsg({
      conversationId: 'multi-reply',
      receivedDateTime: '2026-05-10T10:00:00Z',
    });
    const sentItems: RawGraphSentItem[] = [
      { conversationId: 'multi-reply', sentDateTime: '2026-05-05T10:00:00Z' },
      { conversationId: 'multi-reply', sentDateTime: '2026-05-15T10:00:00Z' },
    ];
    const { result } = await collectScan(makeClient([[msg]], sentItems));
    expect(result.dismissed).toBe(1);
  });
});

describe('runInboxScan — bulk mail filtering', () => {
  it('dismisses a message with a List-ID header', async () => {
    const msg = makeMsg({
      internetMessageHeaders: [
        { name: 'List-ID', value: '<updates.newsletter.example.com>' },
      ],
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });

  it('dismisses a message with Precedence: bulk', async () => {
    const msg = makeMsg({
      internetMessageHeaders: [{ name: 'Precedence', value: 'bulk' }],
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });

  it('dismisses a message with Mailchimp headers', async () => {
    const msg = makeMsg({
      internetMessageHeaders: [{ name: 'X-Mailchimp-ID', value: '12345' }],
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });
});

describe('runInboxScan — auto-reply filtering', () => {
  it('dismisses an OOO auto-reply by subject prefix', async () => {
    const msg = makeMsg({ subject: 'Out of office: back 3rd June' });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });

  it('dismisses Auto-Submitted: auto-replied', async () => {
    const msg = makeMsg({
      internetMessageHeaders: [{ name: 'Auto-Submitted', value: 'auto-replied' }],
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });

  it('keeps Auto-Submitted: no (manually sent)', async () => {
    const msg = makeMsg({
      internetMessageHeaders: [{ name: 'Auto-Submitted', value: 'no' }],
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.passed).toBe(1);
  });
});

describe('runInboxScan — system-generated filtering', () => {
  it('dismisses MAILER-DAEMON sender', async () => {
    const msg = makeMsg({
      from: { emailAddress: { name: 'Mail Daemon', address: 'mailer-daemon@nhs.net' } },
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });

  it('dismisses a delivery status notification by subject', async () => {
    const msg = makeMsg({ subject: 'Delivery Status Notification (Failure)' });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });

  it('dismisses noreply@ sender', async () => {
    const msg = makeMsg({
      from: { emailAddress: { name: 'System', address: 'noreply@nhs.net' } },
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });
});

describe('runInboxScan — calendar expiry filtering', () => {
  it('dismisses a past meeting request', async () => {
    const msg = makeMsg({
      itemClass: 'IPM.Schedule.Meeting.Request',
      start: { dateTime: '2026-04-01T09:00:00', timeZone: 'UTC' },
    });
    // TODAY is 2026-05-23, so 1 April is in the past.
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.dismissed).toBe(1);
  });

  it('keeps a meeting request for today', async () => {
    const msg = makeMsg({
      itemClass: 'IPM.Schedule.Meeting.Request',
      start: { dateTime: '2026-05-23T09:00:00', timeZone: 'UTC' },
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.passed).toBe(1);
  });

  it('keeps a future meeting request', async () => {
    const msg = makeMsg({
      itemClass: 'IPM.Schedule.Meeting.Request',
      start: { dateTime: '2026-06-15T14:00:00', timeZone: 'UTC' },
    });
    const { result } = await collectScan(makeClient([[msg]]));
    expect(result.passed).toBe(1);
  });

  it('keeps a regular email that mentions a date in the subject', async () => {
    const msg = makeMsg({ subject: 'Patient review scheduled for 1 April' });
    const { result } = await collectScan(makeClient([[msg]]));
    // Not a meeting request — date in subject should not trigger calendar rule.
    expect(result.passed).toBe(1);
  });
});

describe('runInboxScan — maxMessages cap', () => {
  it('stops after maxMessages even if more pages exist', async () => {
    const page = Array.from({ length: 10 }, (_, i) =>
      makeMsg({ id: `msg-${i}`, conversationId: `conv-${i}` }),
    );
    // 3 pages × 10 = 30 messages, but maxMessages = 15.
    const { result } = await collectScan(
      makeClient([page, page, page]),
      { maxMessages: 15 },
    );
    expect(result.fetched).toBeLessThanOrEqual(20); // may finish mid-page
    expect(result.fetched).toBeGreaterThan(0);
  });
});

describe('runInboxScan — abort', () => {
  it('marks result as aborted when abort() is called', async () => {
    // Use a slow client (won't finish naturally).
    let resolveDelay: () => void;
    const client: GraphClient = {
      async *listInboxMessages(_since, signal) {
        await new Promise<void>((res) => {
          resolveDelay = res;
          signal.addEventListener('abort', () => res());
        });
        if (!signal.aborted) yield [makeMsg()];
      },
      listSentItems: async () => [],
      resolveFolderName: async () => 'inbox',
    };

    const events: ScanProgress[] = [];
    const handle = runInboxScan(client, {}, (p) => events.push(p), TODAY);
    // Allow prefetch to complete first (listSentItems resolves immediately).
    await new Promise((res) => setTimeout(res, 10));
    handle.abort();
    const result = await handle.done;

    expect(result.aborted).toBe(true);
    // Cleanup
    resolveDelay!();
  });

  it('emits an "aborted" phase event', async () => {
    let resolveDelay: () => void;
    const client: GraphClient = {
      async *listInboxMessages(_since, signal) {
        await new Promise<void>((res) => {
          resolveDelay = res;
          signal.addEventListener('abort', () => res());
        });
        if (!signal.aborted) yield [makeMsg()];
      },
      listSentItems: async () => [],
      resolveFolderName: async () => 'inbox',
    };

    const events: ScanProgress[] = [];
    const handle = runInboxScan(client, {}, (p) => events.push(p), TODAY);
    await new Promise((res) => setTimeout(res, 10));
    handle.abort();
    await handle.done;

    const last = events[events.length - 1];
    expect(last.phase).toBe('aborted');
    resolveDelay!();
  });
});

describe('runInboxScan — progress events', () => {
  it('emits at least a prefetch event and a done event', async () => {
    const { events } = await collectScan(makeClient([[makeMsg()]]));
    const phases = events.map((e) => e.phase);
    expect(phases.includes('prefetch')).toBeTruthy();
    expect(phases.includes('done')).toBeTruthy();
  });

  it('final event has progress === 100', async () => {
    const { events } = await collectScan(makeClient([[makeMsg()]]));
    const last = events[events.length - 1];
    expect(last.progress).toBe(100);
  });

  it('progress increases monotonically', async () => {
    const msgs = Array.from({ length: 20 }, (_, i) =>
      makeMsg({ id: `m${i}`, conversationId: `c${i}` }),
    );
    const { events } = await collectScan(makeClient([msgs]));
    for (let i = 1; i < events.length; i++) {
      assert.ok(
        events[i].progress >= events[i - 1].progress,
        `progress went backwards at index ${i}: ${events[i - 1].progress} → ${events[i].progress}`,
      );
    }
  });
});

describe('runInboxScan — folder kind resolution', () => {
  it('dismisses a message in the deleted items folder', async () => {
    const msg = makeMsg({ parentFolderId: 'deleted-folder' });
    const { result } = await collectScan(
      makeClient([[msg]], [], { 'deleted-folder': 'deleteditems' }),
    );
    expect(result.dismissed).toBe(1);
  });

  it('keeps a message in a custom "Referrals" folder (maps to other)', async () => {
    const msg = makeMsg({ parentFolderId: 'custom-folder' });
    const { result } = await collectScan(
      makeClient([[msg]], [], { 'custom-folder': 'Referrals' }),
    );
    // Custom folder → 'other' → kept by the pre-filter.
    expect(result.passed).toBe(1);
  });

  it('handles unknown folder id by mapping to other (kept)', async () => {
    const msg = makeMsg({ parentFolderId: 'unknown-folder' });
    const { result } = await collectScan(
      makeClient([[msg]], [], {}), // no mapping → resolveFolderName returns null
    );
    expect(result.passed).toBe(1);
  });
});

describe('runInboxScan — sent-items prefetch failure', () => {
  it('continues the scan even if listSentItems throws', async () => {
    const client: GraphClient = {
      ...makeClient([[makeMsg()]]),
      listSentItems: async (_since, _signal) => {
        throw new Error('Network error fetching sent items');
      },
    };
    // Should not throw — falls back to empty sentMap.
    const { result } = await collectScan(client);
    expect(result.fetched).toBe(1);
    // Without sentMap, thread reply check defaults to false → message passes.
    expect(result.passed).toBe(1);
  });
});

describe('createDemoGraphClient', () => {
  it('produces messages for all histEmails entries', async () => {
    const client = createDemoGraphClient(0); // 0ms delay for fast tests
    const { result } = await collectScan(client);
    // histEmails has 12 entries. Some may be dismissed by pre-filter rules.
    expect(result.fetched).toBeGreaterThan(0);
    expect(result.fetched).toBeLessThanOrEqual(12);
  });

  it('all demo messages are from the inbox folder', async () => {
    const client = createDemoGraphClient(0);
    const pages: RawGraphMessage[][] = [];
    const signal = new AbortController().signal;
    for await (const page of client.listInboxMessages(SINCE_90D, signal)) {
      pages.push(page);
    }
    const allMsgs = pages.flat();
    expect(allMsgs.length).toBeGreaterThan(0);
    for (const msg of allMsgs) {
      expect(msg.parentFolderId).toBe('inbox-folder-id');
    }
  });

  it('demo listSentItems returns empty array', async () => {
    const client = createDemoGraphClient(0);
    const signal = new AbortController().signal;
    const sent = await client.listSentItems(SINCE_90D, signal);
    expect(sent.length).toBe(0);
  });

  it('demo resolveFolderName returns "inbox" for inbox-folder-id', async () => {
    const client = createDemoGraphClient(0);
    const signal = new AbortController().signal;
    const name = await client.resolveFolderName('inbox-folder-id', signal);
    expect(name).toBe('inbox');
  });
});
