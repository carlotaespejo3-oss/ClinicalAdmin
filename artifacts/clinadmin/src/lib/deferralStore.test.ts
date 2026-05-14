import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// These tests cover the pure helpers (isoMondayOf, deferralCountMap)
// which carry the bulk of the store's non-trivial logic — date math
// and the "exclude current week" rule that prevents the
// transient-deferral false positive.
//
// The mutating helpers (recordDeferralsForWeek / clearDeferralsForEmail)
// are now thin shims over generated React Query fetchers; their
// behaviour is exercised end-to-end by the server route + planner
// integration tests rather than mocked here, which would just be
// asserting that fetch was called.
import { isoMondayOf, deferralCountMap } from './deferralStore.ts';

describe('isoMondayOf', () => {
  it('returns the same Monday for any day of that week', () => {
    // 11 May 2026 is Monday.
    assert.equal(isoMondayOf(new Date(2026, 4, 11)), '2026-05-11');
    assert.equal(isoMondayOf(new Date(2026, 4, 13)), '2026-05-11');
    assert.equal(isoMondayOf(new Date(2026, 4, 17)), '2026-05-11');
  });

  it('treats Sunday as the END of the prior week', () => {
    // 10 May 2026 is Sunday → Monday of that week is 4 May 2026.
    assert.equal(isoMondayOf(new Date(2026, 4, 10)), '2026-05-04');
  });
});

describe('deferralCountMap', () => {
  it('EXCLUDES the current week — fixes the transient-deferral false positive', () => {
    const history = new Map([
      [42, { emailId: 42, weeksDeferred: ['2026-05-11'] }],
    ]);
    const counts = deferralCountMap(history, '2026-05-11');
    assert.equal(counts.has(42), false);
  });

  it('includes weeks STRICTLY before the current week', () => {
    const history = new Map([
      [5, { emailId: 5, weeksDeferred: ['2026-04-27', '2026-05-04', '2026-05-11'] }],
    ]);
    const counts = deferralCountMap(history, '2026-05-11');
    assert.equal(counts.get(5), 2);
  });

  it('omits items with no prior weeks', () => {
    const history = new Map([
      [9, { emailId: 9, weeksDeferred: ['2026-05-11'] }],
    ]);
    const counts = deferralCountMap(history, '2026-05-11');
    assert.equal(counts.size, 0);
  });

  it('counts each distinct prior week once', () => {
    const history = new Map([
      [7, { emailId: 7, weeksDeferred: ['2026-04-13', '2026-04-20', '2026-04-27'] }],
    ]);
    const counts = deferralCountMap(history, '2026-05-11');
    assert.equal(counts.get(7), 3);
  });
});
