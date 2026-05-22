// inboxPreFilter.test.ts
//
// Tests for the rule-based inbox pre-filter (start-mode catch-up scan).
// Uses node:test with the same Vitest-shaped expect shim as availability.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPreFilter,
  estimatePriorityScore,
  coerceFolderKind,
  type OutlookMessageMeta,
} from './inboxPreFilter';

// ---- Vitest-shaped shim -------------------------------------------------------

const describe = (_name: string, fn: () => void): void => fn();
const it = test;

interface Matchers {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeTruthy: () => void;
  toBeFalsy: () => void;
  toBeGreaterThanOrEqual: (n: number) => void;
  toBeLessThanOrEqual: (n: number) => void;
}

function expect(actual: unknown): Matchers {
  return {
    toBe: (expected) => assert.equal(actual, expected),
    toEqual: (expected) => assert.deepEqual(actual, expected),
    toBeTruthy: () => assert.ok(actual, `expected truthy, got ${String(actual)}`),
    toBeFalsy: () => assert.ok(!actual, `expected falsy, got ${String(actual)}`),
    toBeGreaterThanOrEqual: (n) =>
      assert.ok(
        typeof actual === 'number' && actual >= n,
        `expected ${String(actual)} >= ${n}`,
      ),
    toBeLessThanOrEqual: (n) =>
      assert.ok(
        typeof actual === 'number' && actual <= n,
        `expected ${String(actual)} <= ${n}`,
      ),
  };
}

// ---- Fixtures ----------------------------------------------------------------

const TODAY = new Date('2026-05-22T12:00:00Z');

/** Baseline passing message — all noise flags off, inbox folder, no noise
 *  headers. Individual tests override specific properties. */
function msg(overrides: Partial<OutlookMessageMeta> = {}): OutlookMessageMeta {
  return {
    id: 'AAMk1',
    subject: 'Re: Assessment appointment',
    receivedAt: '2026-05-01T10:00:00Z',
    conversationId: 'conv1',
    parentFolderKind: 'inbox',
    senderAddress: 'gp@surgery.nhs.uk',
    senderName: 'Dr Smith',
    isRead: false,
    isDraft: false,
    isMeetingRequest: false,
    eventDate: null,
    threadHasClinicianReply: false,
    listId: null,
    precedence: null,
    hasMailingListHeaders: false,
    autoSubmitted: null,
    hasAutoReplyHeaders: false,
    ...overrides,
  };
}

// ============================================================================
// Passing cases
// ============================================================================

describe('applyPreFilter — legitimate emails that should pass', () => {
  it('passes a normal inbox email with no noise signals', () => {
    const result = applyPreFilter(msg(), TODAY);
    expect(result.pass).toBe(true);
  });

  it('passes an unread inbox email from a patient', () => {
    const result = applyPreFilter(
      msg({ isRead: false, senderAddress: 'parent@example.com' }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });

  it('passes a future calendar invite', () => {
    const result = applyPreFilter(
      msg({ isMeetingRequest: true, eventDate: '2026-06-15' }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });

  it('passes a calendar invite with no eventDate (treat as open)', () => {
    const result = applyPreFilter(
      msg({ isMeetingRequest: true, eventDate: null }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });

  it('passes an email in a custom ("other") folder — may be a clinical subfolder', () => {
    const result = applyPreFilter(
      msg({ parentFolderKind: 'other' }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });

  it('passes when Precedence header is "normal" (not bulk/list)', () => {
    const result = applyPreFilter(msg({ precedence: 'normal' }), TODAY);
    expect(result.pass).toBe(true);
  });

  it('passes when Auto-Submitted is explicitly "no"', () => {
    const result = applyPreFilter(msg({ autoSubmitted: 'no' }), TODAY);
    expect(result.pass).toBe(true);
  });
});

// ============================================================================
// Rule 1 — thread already replied
// ============================================================================

describe('applyPreFilter — rule:thread_replied', () => {
  it('rejects when clinician has replied in thread', () => {
    const result = applyPreFilter(
      msg({ threadHasClinicianReply: true }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:thread_replied');
  });

  it('passes when no clinician reply in thread', () => {
    const result = applyPreFilter(
      msg({ threadHasClinicianReply: false }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });
});

// ============================================================================
// Rule 2 — calendar invite with past event date
// ============================================================================

describe('applyPreFilter — rule:calendar_expired', () => {
  it('rejects a meeting invite for a past date', () => {
    const result = applyPreFilter(
      msg({ isMeetingRequest: true, eventDate: '2026-01-15' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:calendar_expired');
  });

  it('passes a meeting invite for today (same day is not expired)', () => {
    const todayIso = TODAY.toISOString().slice(0, 10);
    const result = applyPreFilter(
      msg({ isMeetingRequest: true, eventDate: todayIso }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });

  it('does not apply the calendar rule to a non-meeting email', () => {
    const result = applyPreFilter(
      msg({ isMeetingRequest: false, eventDate: '2026-01-01' }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });
});

// ============================================================================
// Rule 3 — bulk mail
// ============================================================================

describe('applyPreFilter — rule:bulk_mail', () => {
  it('rejects when List-ID header is set', () => {
    const result = applyPreFilter(
      msg({ listId: '<updates.rcpsych.ac.uk>' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:bulk_mail');
  });

  it('rejects when Precedence: bulk', () => {
    const result = applyPreFilter(msg({ precedence: 'bulk' }), TODAY);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:bulk_mail');
  });

  it('rejects when Precedence: list', () => {
    const result = applyPreFilter(msg({ precedence: 'list' }), TODAY);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:bulk_mail');
  });

  it('rejects when mailing-list tool headers present', () => {
    const result = applyPreFilter(
      msg({ hasMailingListHeaders: true }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:bulk_mail');
  });

  it('is case-insensitive for Precedence values', () => {
    const result = applyPreFilter(msg({ precedence: 'BULK' }), TODAY);
    expect(result.pass).toBe(false);
  });
});

// ============================================================================
// Rule 4 — auto-reply
// ============================================================================

describe('applyPreFilter — rule:auto_reply', () => {
  it('rejects when Auto-Submitted is auto-replied', () => {
    const result = applyPreFilter(
      msg({ autoSubmitted: 'auto-replied' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:auto_reply');
  });

  it('rejects when Auto-Submitted is auto-generated', () => {
    const result = applyPreFilter(
      msg({ autoSubmitted: 'auto-generated' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:auto_reply');
  });

  it('rejects when X-Autoreply headers are set', () => {
    const result = applyPreFilter(
      msg({ hasAutoReplyHeaders: true }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:auto_reply');
  });

  it('rejects "Out of office" subject prefix', () => {
    const result = applyPreFilter(
      msg({ subject: 'Out of office: back on Monday' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:auto_reply');
  });

  it('rejects "Automatic reply" subject prefix', () => {
    const result = applyPreFilter(
      msg({ subject: 'Automatic Reply: re your referral' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:auto_reply');
  });

  it('rejects "AutoReply" subject prefix', () => {
    const result = applyPreFilter(
      msg({ subject: 'AutoReply: thank you for your email' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:auto_reply');
  });

  it('does NOT reject a subject that contains "out of office" mid-sentence', () => {
    // Prefix match only — "FWD: out of office memo" should pass.
    const result = applyPreFilter(
      msg({ subject: 'FWD: out of office memo for team' }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });
});

// ============================================================================
// Rule 5 — system-generated
// ============================================================================

describe('applyPreFilter — rule:system_generated', () => {
  it('rejects MAILER-DAEMON sender', () => {
    const result = applyPreFilter(
      msg({ senderAddress: 'MAILER-DAEMON@nhs.net' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:system_generated');
  });

  it('rejects postmaster sender', () => {
    const result = applyPreFilter(
      msg({ senderAddress: 'postmaster@trust.nhs.uk' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:system_generated');
  });

  it('rejects noreply@ sender', () => {
    const result = applyPreFilter(
      msg({ senderAddress: 'noreply@systmone.co.uk' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:system_generated');
  });

  it('rejects no-reply@ sender', () => {
    const result = applyPreFilter(
      msg({ senderAddress: 'no-reply@nhs.net' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:system_generated');
  });

  it('rejects "Undeliverable" subject', () => {
    const result = applyPreFilter(
      msg({ subject: 'Undeliverable: referral letter for patient' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:system_generated');
  });

  it('rejects "Delivery Status Notification" subject', () => {
    const result = applyPreFilter(
      msg({ subject: 'Delivery Status Notification (Failure)' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:system_generated');
  });

  it('rejects "Read receipt" subject', () => {
    const result = applyPreFilter(
      msg({ subject: 'Read receipt: discharge summary' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:system_generated');
  });

  it('does not reject a sender with "noreply" mid-address', () => {
    // noreply@ must match at the START of the local part.
    const result = applyPreFilter(
      msg({ senderAddress: 'clinical.noreply.system@trust.nhs.uk' }),
      TODAY,
    );
    expect(result.pass).toBe(true);
  });
});

// ============================================================================
// Rule 6 — non-inbox folder
// ============================================================================

describe('applyPreFilter — rule:non_inbox_folder', () => {
  it('rejects emails in Sent', () => {
    const result = applyPreFilter(msg({ parentFolderKind: 'sent' }), TODAY);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:non_inbox_folder');
  });

  it('rejects emails in Deleted', () => {
    const result = applyPreFilter(msg({ parentFolderKind: 'deleted' }), TODAY);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:non_inbox_folder');
  });

  it('rejects emails in Junk', () => {
    const result = applyPreFilter(msg({ parentFolderKind: 'junk' }), TODAY);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:non_inbox_folder');
  });

  it('rejects emails in Archive', () => {
    const result = applyPreFilter(msg({ parentFolderKind: 'archive' }), TODAY);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:non_inbox_folder');
  });

  it('rejects drafts via folder kind', () => {
    const result = applyPreFilter(msg({ parentFolderKind: 'drafts' }), TODAY);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:non_inbox_folder');
  });

  it('rejects drafts via isDraft flag even if folder kind appears as inbox', () => {
    const result = applyPreFilter(
      msg({ isDraft: true, parentFolderKind: 'inbox' }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:non_inbox_folder');
  });
});

// ============================================================================
// Rule priority ordering
// ============================================================================

describe('applyPreFilter — rule priority', () => {
  it('non_inbox_folder fires before thread_replied when both apply', () => {
    const result = applyPreFilter(
      msg({ parentFolderKind: 'sent', threadHasClinicianReply: true }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:non_inbox_folder');
  });

  it('bulk_mail fires before calendar_expired when both apply', () => {
    const result = applyPreFilter(
      msg({
        listId: '<news.nhs.uk>',
        isMeetingRequest: true,
        eventDate: '2026-01-01',
      }),
      TODAY,
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.rule).toBe('rule:bulk_mail');
  });
});

// ============================================================================
// estimatePriorityScore
// ============================================================================

describe('estimatePriorityScore', () => {
  it('recent unread email with other-party reply scores at or near 100', () => {
    const score = estimatePriorityScore(
      msg({ isRead: false, receivedAt: '2026-05-20T10:00:00Z' }),
      TODAY,
      /* threadHasOtherReply */ true,
    );
    expect(score).toBeGreaterThanOrEqual(90);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('very old read email with no pending reply scores 0', () => {
    const score = estimatePriorityScore(
      msg({ isRead: true, receivedAt: '2026-02-01T10:00:00Z' }), // ~110 days old
      TODAY,
      false,
    );
    assert.equal(score, 0);
  });

  it('unread adds 20 points over read', () => {
    const base = estimatePriorityScore(
      msg({ isRead: true, receivedAt: '2026-05-20T10:00:00Z' }),
      TODAY, false,
    );
    const unread = estimatePriorityScore(
      msg({ isRead: false, receivedAt: '2026-05-20T10:00:00Z' }),
      TODAY, false,
    );
    assert.equal(unread - base, 20);
  });

  it('score is capped at 100', () => {
    const score = estimatePriorityScore(
      msg({ isRead: false, receivedAt: '2026-05-22T10:00:00Z' }),
      TODAY,
      true,
    );
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// coerceFolderKind
// ============================================================================

describe('coerceFolderKind', () => {
  const cases: [string, string][] = [
    ['inbox', 'inbox'],
    ['Inbox', 'inbox'],
    ['sentitems', 'sent'],
    ['Sent Items', 'sent'],
    ['deleteditems', 'deleted'],
    ['Deleted Items', 'deleted'],
    ['junkemail', 'junk'],
    ['Junk Email', 'junk'],
    ['spam', 'junk'],
    ['archive', 'archive'],
    ['Archived Items', 'archive'],
    ['drafts', 'drafts'],
    ['My Custom Folder', 'other'],
    ['Referrals', 'other'],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      assert.equal(coerceFolderKind(input), expected);
    });
  }
});
