import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// jsdom-style localStorage shim so the store can run under node:test
// without a DOM. The store guards `typeof window !== 'undefined'`, so
// we plant a minimal window with a Map-backed localStorage.
const ls = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null),
    setItem: (k: string, v: string) => {
      ls.set(k, v);
    },
    removeItem: (k: string) => {
      ls.delete(k);
    },
  },
};

const {
  isoMondayOf,
  recordDeferralsForWeek,
  deferralCountMap,
  clearDeferralsForEmail,
  clearAllDeferrals,
} = await import('./deferralStore.ts');

describe('isoMondayOf', () => {
  it('returns the same Monday for any day of that week', () => {
    // 11 May 2026 is Monday.
    const mon = isoMondayOf(new Date(2026, 4, 11));
    const wed = isoMondayOf(new Date(2026, 4, 13));
    const sun = isoMondayOf(new Date(2026, 4, 17));
    assert.equal(mon, '2026-05-11');
    assert.equal(wed, '2026-05-11');
    assert.equal(sun, '2026-05-11');
  });

  it('treats Sunday as the END of the prior week', () => {
    // 10 May 2026 is Sunday → Monday of that week is 4 May 2026.
    assert.equal(isoMondayOf(new Date(2026, 4, 10)), '2026-05-04');
  });
});

describe('recordDeferralsForWeek', () => {
  beforeEach(() => {
    clearAllDeferrals();
  });

  it('is idempotent for the same (id, week) pair', () => {
    recordDeferralsForWeek([1, 2], '2026-05-04');
    recordDeferralsForWeek([1, 2], '2026-05-04');
    recordDeferralsForWeek([1], '2026-05-04');
    // All recorded under one week → count == 1 for each.
    const counts = deferralCountMap(loadHistory(), '2026-12-31');
    assert.equal(counts.get(1), 1);
    assert.equal(counts.get(2), 1);
  });

  it('increments across distinct weeks', () => {
    recordDeferralsForWeek([7], '2026-04-27');
    recordDeferralsForWeek([7], '2026-05-04');
    recordDeferralsForWeek([7], '2026-05-11');
    const counts = deferralCountMap(loadHistory(), '2026-12-31');
    assert.equal(counts.get(7), 3);
  });
});

describe('deferralCountMap', () => {
  beforeEach(() => {
    clearAllDeferrals();
  });

  it('EXCLUDES the current week — fixes the transient-deferral false positive', () => {
    // Item recorded ONLY this week (e.g. it briefly appeared in
    // deferredItems before the user added capacity). The planner
    // must not see it as "deferred from a previous planning window".
    recordDeferralsForWeek([42], '2026-05-11');
    const counts = deferralCountMap(loadHistory(), '2026-05-11');
    assert.equal(counts.has(42), false);
  });

  it('includes weeks STRICTLY before the current week', () => {
    recordDeferralsForWeek([5], '2026-04-27'); // prior
    recordDeferralsForWeek([5], '2026-05-04'); // prior
    recordDeferralsForWeek([5], '2026-05-11'); // current
    const counts = deferralCountMap(loadHistory(), '2026-05-11');
    assert.equal(counts.get(5), 2);
  });

  it('omits items with no prior weeks', () => {
    recordDeferralsForWeek([9], '2026-05-11');
    const counts = deferralCountMap(loadHistory(), '2026-05-11');
    assert.equal(counts.size, 0);
  });
});

describe('clearDeferralsForEmail', () => {
  beforeEach(() => {
    clearAllDeferrals();
  });

  it('removes all history for one email and leaves others alone', () => {
    recordDeferralsForWeek([1, 2], '2026-04-27');
    recordDeferralsForWeek([1, 2], '2026-05-04');
    clearDeferralsForEmail(1);
    const counts = deferralCountMap(loadHistory(), '2026-12-31');
    assert.equal(counts.has(1), false);
    assert.equal(counts.get(2), 2);
  });
});

// Helper: re-read the live store map. Mirrors what useDeferralHistory
// would surface in React.
function loadHistory() {
  // The store doesn't export its load() helper directly, but
  // recordDeferralsForWeek populates the underlying Map in-place.
  // We access it via deferralCountMap(...) using a sentinel future
  // week so all entries pass the "< current" filter — but that
  // returns counts, not the raw Map. For test purposes we just
  // re-import a fresh view via the public surface: rebuild a
  // Map<id, {weeksDeferred}> by introspecting JSON in localStorage.
  const raw = (globalThis as unknown as { window: { localStorage: { getItem: (k: string) => string | null } } })
    .window.localStorage.getItem('clinadmin-deferral-history-v1');
  const arr = raw ? (JSON.parse(raw) as Array<{ emailId: number; weeksDeferred: string[] }>) : [];
  return new Map(arr.map((r) => [r.emailId, r]));
}
