import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { observeArrivals, recommendArrivals, parseEmailDate } from './arrivalsLearning';
import type { Email } from './types';
import { CAT } from './data';
import { DEFAULT_ARRIVAL_CONFIG } from './planner';

const TODAY = new Date('2026-05-13T12:00:00Z');

function makeEmail(overrides: Partial<Email> & Pick<Email, 'id' | 'date'>): Email {
  return {
    from: 'x',
    subject: 'x',
    preview: '',
    body: '',
    risk: 'low',
    cat: CAT.ADMIN,
    deadline: 14,
    estMin: 5,
    ...overrides,
  };
}

describe('parseEmailDate', () => {
  it('parses Today / Yesterday / N days ago / N weeks ago / ISO', () => {
    const startOfToday = new Date(TODAY);
    startOfToday.setHours(0, 0, 0, 0);
    const daysBetween = (a: Date, b: Date) =>
      Math.floor((b.getTime() - a.getTime()) / 86400000);

    assert.equal(parseEmailDate('Today, 09:12', TODAY)!.getTime(), startOfToday.getTime());
    const y = parseEmailDate('Yesterday', TODAY)!;
    assert.equal(daysBetween(y, startOfToday), 1);
    const d3 = parseEmailDate('3 days ago', TODAY)!;
    assert.equal(daysBetween(d3, startOfToday), 3);
    const w2 = parseEmailDate('2 weeks ago', TODAY)!;
    assert.equal(daysBetween(w2, startOfToday), 14);
    const iso = parseEmailDate('2026-04-29T10:00:00Z', TODAY)!;
    assert.ok(iso instanceof Date);
  });

  it('returns null for unparseable strings', () => {
    assert.equal(parseEmailDate('', TODAY), null);
    assert.equal(parseEmailDate('whenever', TODAY), null);
  });
});

describe('observeArrivals', () => {
  it('returns null when there is less than minDays of history', () => {
    const emails = [
      makeEmail({ id: 1, date: 'Today, 09:00' }),
      makeEmail({ id: 2, date: 'Yesterday' }),
      makeEmail({ id: 3, date: '3 days ago' }),
    ];
    assert.equal(observeArrivals(emails, TODAY), null);
  });

  it('returns null when emails array is empty', () => {
    assert.equal(observeArrivals([], TODAY), null);
  });

  it('computes weekly rates over a 4-week window', () => {
    const emails: Email[] = [];
    // 28 days × 2 emails per day = 56 in window. Plus one really old to
    // anchor history > 28 days so the divisor is exactly 28d / 7 = 4.
    for (let day = 0; day < 28; day++) {
      emails.push(makeEmail({ id: day * 2, date: `${day} days ago`, risk: 'high', cat: CAT.URGENT, estMin: 20 }));
      emails.push(makeEmail({ id: day * 2 + 1, date: `${day} days ago`, risk: 'low', cat: CAT.ADMIN, estMin: 4 }));
    }
    emails.push(makeEmail({ id: 999, date: '40 days ago' }));
    const out = observeArrivals(emails, TODAY)!;
    assert.ok(out, 'returns an observation');
    assert.equal(out.totalEmails, 56, 'only items inside the 28-day window are counted');
    assert.equal(out.emailsPerWeek, 14);
    assert.equal(out.highPerWeek, 7);
    assert.equal(out.lowPerWeek, 7);
    assert.equal(out.avgEstMinHigh, 20);
    assert.equal(out.avgEstMinLow, 4);
  });

  it('includes an email exactly at the window boundary (28 days ago)', () => {
    const emails: Email[] = [
      makeEmail({ id: 1, date: '28 days ago', cat: CAT.ADMIN, estMin: 4 }),
      makeEmail({ id: 2, date: '40 days ago' }),
    ];
    const out = observeArrivals(emails, TODAY)!;
    assert.ok(out, 'returns observation when at least one email is inside the window');
    assert.equal(out.totalEmails, 1, 'the 28-days-ago email is inside the 28-day window');
  });

  it('excludes emails just outside the window (29 days ago)', () => {
    const emails: Email[] = [
      makeEmail({ id: 1, date: '29 days ago', cat: CAT.ADMIN, estMin: 4 }),
      makeEmail({ id: 2, date: '40 days ago' }),
    ];
    const out = observeArrivals(emails, TODAY)!;
    assert.equal(out.totalEmails, 0);
  });

  it('still requires minDays (14) of history at the boundary', () => {
    const emails13 = [
      makeEmail({ id: 1, date: '13 days ago' }),
      makeEmail({ id: 2, date: 'Today, 09:00' }),
    ];
    assert.equal(observeArrivals(emails13, TODAY), null, '13 days of history is below minDays');

    const emails14 = [
      makeEmail({ id: 1, date: '14 days ago' }),
      makeEmail({ id: 2, date: 'Today, 09:00' }),
    ];
    assert.ok(observeArrivals(emails14, TODAY), '14 days of history meets minDays');
  });

  it('produces stable rates regardless of clock time-of-day', () => {
    const emails: Email[] = [];
    for (let day = 0; day < 28; day++) {
      emails.push(makeEmail({ id: day, date: `${day} days ago`, cat: CAT.ADMIN, estMin: 4 }));
    }
    emails.push(makeEmail({ id: 999, date: '40 days ago' }));
    const morning = observeArrivals(emails, new Date('2026-05-13T01:00:00Z'))!;
    const evening = observeArrivals(emails, new Date('2026-05-13T23:00:00Z'))!;
    assert.deepEqual(morning, evening);
  });

  it('classifies medium-band emails (PROF, REVIEW, MEETING) as medium', () => {
    const emails: Email[] = [];
    for (let day = 0; day < 21; day++) {
      emails.push(makeEmail({ id: day, date: `${day} days ago`, cat: CAT.PROF, risk: 'medium', estMin: 8 }));
    }
    emails.push(makeEmail({ id: 999, date: '40 days ago' }));
    const out = observeArrivals(emails, TODAY)!;
    assert.ok(out.mediumPerWeek > 0);
    assert.equal(out.avgEstMinMedium, 8);
  });
});

describe('recommendArrivals', () => {
  it('returns insufficient-history reason when nothing to learn from', () => {
    const r = recommendArrivals([], TODAY, DEFAULT_ARRIVAL_CONFIG);
    assert.equal(r.observed, null);
    assert.equal(r.recommendation, null);
    assert.equal(r.confidence, 'low');
    assert.match(r.reason, /not enough history/i);
  });

  it('flags an under-configured rate as "raise the configured rate"', () => {
    const emails: Email[] = [];
    for (let day = 0; day < 28; day++) {
      for (let i = 0; i < 15; i++) {
        emails.push(
          makeEmail({ id: day * 100 + i, date: `${day} days ago`, cat: CAT.ADMIN, estMin: 4 }),
        );
      }
    }
    emails.push(makeEmail({ id: 9999, date: '40 days ago' }));
    const r = recommendArrivals(emails, TODAY, DEFAULT_ARRIVAL_CONFIG);
    assert.ok(r.observed);
    assert.ok(r.observed!.emailsPerWeek > DEFAULT_ARRIVAL_CONFIG.emailsPerWeek);
    assert.ok(r.diff!.emailsPerWeekDelta > 0);
    assert.match(r.reason, /raising/i);
    assert.equal(r.confidence, 'high');
  });

  it('flags an over-configured rate as "lower the configured rate"', () => {
    const emails: Email[] = [];
    for (let day = 0; day < 28; day += 4) {
      emails.push(makeEmail({ id: day, date: `${day} days ago`, cat: CAT.ADMIN, estMin: 4 }));
    }
    emails.push(makeEmail({ id: 9999, date: '40 days ago' }));
    const r = recommendArrivals(emails, TODAY, DEFAULT_ARRIVAL_CONFIG);
    assert.ok(r.observed);
    assert.ok(r.observed!.emailsPerWeek < DEFAULT_ARRIVAL_CONFIG.emailsPerWeek);
    assert.ok(r.diff!.emailsPerWeekDelta < 0);
    assert.match(r.reason, /lowering/i);
  });

  it('says "no change needed" when observed is within 10% of configured', () => {
    const emails: Email[] = [];
    // 60/week observed → matches default
    for (let day = 0; day < 28; day++) {
      for (let i = 0; i < Math.round(60 / 7); i++) {
        emails.push(
          makeEmail({ id: day * 100 + i, date: `${day} days ago`, cat: CAT.ADMIN, estMin: 4 }),
        );
      }
    }
    emails.push(makeEmail({ id: 9999, date: '40 days ago' }));
    const r = recommendArrivals(emails, TODAY, DEFAULT_ARRIVAL_CONFIG);
    assert.ok(r.observed);
    assert.match(r.reason, /no change needed/i);
  });

  it('produces a recommendation with reserves matching observed avg time', () => {
    const emails: Email[] = [];
    for (let day = 0; day < 28; day++) {
      emails.push(makeEmail({ id: day, date: `${day} days ago`, cat: CAT.URGENT, risk: 'high', estMin: 25 }));
    }
    emails.push(makeEmail({ id: 9999, date: '40 days ago' }));
    const r = recommendArrivals(emails, TODAY, DEFAULT_ARRIVAL_CONFIG);
    assert.ok(r.recommendation);
    assert.equal(r.recommendation!.highReserveMin, r.recommendation!.highPerWeek * 25);
  });
});
