import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlan,
  buildAvailability,
  priorityBand,
  deriveDeadlineDays,
  DAILY_LOW_PRIORITY_RESERVATION_MIN,
  DEFAULT_ARRIVAL_CONFIG,
  type PlannerEmail,
  type PlannerTask,
  type PlannerInput,
  type ArrivalConfig,
} from './planner.ts';

// Fixed Monday so weekday math is predictable. 11 May 2026 is a Monday.
const MONDAY = new Date(2026, 4, 11);

// No projected arrivals by default in tests — keeps capacity math simple
// and lets each test target one rule. The reservation is exercised in
// its own dedicated test below.
const NO_ARRIVALS: ArrivalConfig = {
  emailsPerWeek: 0,
  highPerWeek: 0,
  mediumPerWeek: 0,
  urgentDailyReserveMin: 0,
  mediumWeeklyReserveMin: 0,
};

function makeEmail(over: Partial<PlannerEmail> = {}): PlannerEmail {
  return {
    id: 1,
    subject: 'Subject',
    from: 'from@example.com',
    category: 'ADMIN',
    estMin: 10,
    deadlineDays: null,
    unclear: false,
    ...over,
  };
}

function makeTask(over: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id: 't1',
    title: 'Task',
    category: 'ADMIN',
    estMin: 10,
    deadlineDays: 7,
    linkedEmailId: null,
    ...over,
  };
}

function baseInput(over: Partial<PlannerInput> = {}): PlannerInput {
  return {
    today: MONDAY,
    emails: [],
    tasks: [],
    availability: buildAvailability(MONDAY, { Tue: 1.5, Wed: 1.5, Thu: 1.5 }),
    arrivals: NO_ARRIVALS,
    ...over,
  };
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

describe('priorityBand', () => {
  it('classifies categories into the spec bands', () => {
    assert.equal(priorityBand('SAFEGUARDING'), 'urgent');
    assert.equal(priorityBand('URGENT_CLINICAL'), 'urgent');
    assert.equal(priorityBand('LEGAL'), 'urgent');
    assert.equal(priorityBand('CLINICAL'), 'medium');
    assert.equal(priorityBand('PROFESSIONAL'), 'medium');
    assert.equal(priorityBand('ADMIN'), 'low');
    assert.equal(priorityBand('CPD'), 'low');
    assert.equal(priorityBand('NONE'), 'low');
    assert.equal(priorityBand('UNCLEAR'), 'unclear');
  });
});

describe('deriveDeadlineDays', () => {
  it('uses an explicit deadline when present', () => {
    assert.equal(deriveDeadlineDays({ category: 'CLINICAL', deadlineDays: 3 }), 3);
  });
  it('falls back to category SLA otherwise', () => {
    assert.equal(deriveDeadlineDays({ category: 'SAFEGUARDING', deadlineDays: null }), 1);
    assert.equal(deriveDeadlineDays({ category: 'CLINICAL', deadlineDays: null }), 7);
    assert.equal(deriveDeadlineDays({ category: 'ADMIN', deadlineDays: null }), 14);
  });
});

describe('buildAvailability', () => {
  it('produces a 14-day runway anchored at today', () => {
    const a = buildAvailability(MONDAY, { Tue: 2 });
    assert.equal(a.length, 14);
    assert.equal(a[0].dayLabel, 'Mon');
    assert.equal(a[0].minutesAvailable, 0);
    assert.equal(a[1].dayLabel, 'Tue');
    assert.equal(a[1].minutesAvailable, 120);
  });
});

// ----------------------------------------------------------------------------
// UNCLEAR gate
// ----------------------------------------------------------------------------

describe('buildPlan — UNCLEAR gate', () => {
  it('puts an unclear-gate item at the very top of today when unclassified emails exist', () => {
    const out = buildPlan(
      baseInput({
        emails: [
          makeEmail({ id: 1, unclear: true, category: 'UNCLEAR' }),
          makeEmail({ id: 2, unclear: true, category: 'UNCLEAR' }),
        ],
      }),
    );
    assert.equal(out.unclearCount, 2);
    assert.equal(out.todaysPlan.items.length, 1);
    assert.equal(out.todaysPlan.items[0].kind, 'unclear_gate');
    assert.match(out.todaysPlan.items[0].title, /2 emails need classifying/);
  });

  it('does not show a gate when all emails are classified', () => {
    const out = buildPlan(baseInput({ emails: [makeEmail({ id: 1 })] }));
    assert.equal(out.unclearCount, 0);
    assert.equal(out.todaysPlan.items.find((i) => i.kind === 'unclear_gate'), undefined);
  });
});

// ----------------------------------------------------------------------------
// Ordering rules
// ----------------------------------------------------------------------------

describe('buildPlan — ordering and priority', () => {
  it('overdue items get placed first and produce already_overdue breaches', () => {
    const out = buildPlan(
      baseInput({
        emails: [
          makeEmail({ id: 1, category: 'CLINICAL', estMin: 20, deadlineDays: -2 }),
          makeEmail({ id: 2, category: 'ADMIN', estMin: 5, deadlineDays: 7 }),
        ],
      }),
    );
    // Overdue item should appear on Tuesday (the first available day).
    const tue = out.runway[1];
    const overdueItem = tue.items.find((i) => i.refId === 1);
    assert.ok(overdueItem, 'overdue clinical email is scheduled on Tue');
    assert.equal(overdueItem!.reason, 'overdue');
    assert.equal(overdueItem!.daysOverdue, 2);
    assert.equal(out.breaches.length, 1);
    assert.equal(out.breaches[0].reason, 'already_overdue');
  });

  it('overdue items of any category jump ahead of due-tomorrow urgent items', () => {
    // ADMIN is normally low priority, but if it's overdue it must be
    // handled before a still-on-time URGENT_CLINICAL email.
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Mon: 1 }),
        emails: [
          makeEmail({ id: 1, category: 'URGENT_CLINICAL', estMin: 15, deadlineDays: 1 }),
          makeEmail({ id: 2, category: 'ADMIN', estMin: 10, deadlineDays: -3 }),
        ],
      }),
    );
    const today = out.todaysPlan.items.filter((i) => i.kind === 'email');
    assert.deepEqual(
      today.map((i) => i.refId),
      [2, 1],
      'overdue ADMIN should appear before due-tomorrow URGENT_CLINICAL',
    );
    const overdueItem = today.find((i) => i.refId === 2)!;
    assert.equal(overdueItem.reason, 'overdue');
    assert.equal(overdueItem.daysOverdue, 3);
  });

  it('SAFEGUARDING beats URGENT_CLINICAL beats LEGAL on the same day', () => {
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Mon: 2 }),
        emails: [
          makeEmail({ id: 30, category: 'LEGAL', estMin: 20, deadlineDays: 0 }),
          makeEmail({ id: 10, category: 'SAFEGUARDING', estMin: 20, deadlineDays: 0 }),
          makeEmail({ id: 20, category: 'URGENT_CLINICAL', estMin: 20, deadlineDays: 0 }),
        ],
      }),
    );
    const today = out.todaysPlan.items.filter((i) => i.kind === 'email');
    assert.deepEqual(today.map((i) => i.refId), [10, 20, 30]);
  });

  it('linked tasks are placed on the same day as their parent email and never split', () => {
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Mon: 1 }),
        emails: [
          makeEmail({ id: 5, category: 'CLINICAL', estMin: 15, deadlineDays: 1 }),
        ],
        tasks: [
          makeTask({
            id: 'doc5',
            title: 'Write referral letter',
            category: 'CLINICAL',
            estMin: 20,
            deadlineDays: 1,
            linkedEmailId: 5,
          }),
        ],
      }),
    );
    // Both must land on day 0 (the only available day).
    const today = out.todaysPlan.items;
    const emailItem = today.find((i) => i.refId === 5);
    const taskItem = today.find((i) => i.refId === 'doc5');
    assert.ok(emailItem, 'email is on today');
    assert.ok(taskItem, 'linked task is on today');
    assert.equal(taskItem!.linkedToEmailId, 5);
    // Total planned for the day is the sum of both.
    assert.equal(out.todaysPlan.totalPlannedMin, 35);
  });
});

// ----------------------------------------------------------------------------
// Daily low-priority allocation (NON-NEGOTIABLE rule)
// ----------------------------------------------------------------------------

describe('buildPlan — daily low-priority allocation', () => {
  it('reserves the daily low quota even when urgent items exist', () => {
    // 60 min of urgent work + a small low admin item. Without the
    // protected daily low quota the urgent would consume all 60 min on
    // Tue and the admin would have nowhere to land. With the rule, 15
    // min are protected per non-today day, so the admin still gets
    // placed somewhere in the runway via the low_daily slot.
    //
    // Note: low items deliberately spread across days (emptiest first)
    // for visual balance — so the admin doesn't have to land on the
    // same Tue as the urgent. The invariant being tested is that the
    // low quota mechanism reliably gives the admin a slot, not which
    // day it lands on.
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 1 }),
        emails: [
          makeEmail({ id: 1, category: 'URGENT_CLINICAL', estMin: 45, deadlineDays: 0 }),
          makeEmail({ id: 2, category: 'ADMIN', estMin: 5, deadlineDays: 14 }),
        ],
      }),
    );
    const lowItems = out.runway.flatMap((d) => d.items.filter((i) => i.reason === 'low_daily'));
    assert.equal(lowItems.length, 1, 'admin email landed in a low-quota slot');
    assert.equal(lowItems[0].refId, 2);
    assert.equal(out.deferredItems.length, 0, 'admin was not deferred');
  });

  it('does NOT let an urgent item dip into the low quota — it postpones to the next admin day instead', () => {
    // Tue has 30 min capacity → 15 bookable + 15 protected low quota.
    // Urgent (25 min) with a 48h window (deadlineDays=2) cannot fit in
    // Tuesday's 15-min bookable and is NOT allowed to cannibalise the
    // protected low quota. With Wed (60 min) available it should land on
    // Wednesday — still within the 48h SLA — and Tuesday's low quota
    // stays intact.
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 0.5, Wed: 1 }),
        emails: [
          makeEmail({ id: 1, category: 'SAFEGUARDING', estMin: 25, deadlineDays: 2 }),
        ],
      }),
    );
    const tue = out.runway[1];
    const wed = out.runway[2];
    assert.equal(tue.items.find((i) => i.refId === 1), undefined, 'urgent did not land on Tuesday');
    assert.ok(wed.items.find((i) => i.refId === 1), 'urgent was postponed to Wednesday');
    // Tuesday's protected low quota (15 min) was not consumed → nothing
    // unrelated should be planned on Tue beyond the low slot itself.
    assert.ok(tue.totalPlannedMin <= 15, 'Tuesday low-quota slot was not cannibalised');
    // Within 48h, so no SLA breach.
    assert.equal(out.breaches.length, 0);
  });

  it('overdue items DO dip into the low quota since their SLA is already violated', () => {
    // Same shape as above but the item is already overdue. Overdue
    // privileges kick in: the 25-min urgent dips into Tuesday's low
    // quota and lands today rather than tomorrow.
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 0.5, Wed: 1 }),
        emails: [
          makeEmail({ id: 1, category: 'URGENT_CLINICAL', estMin: 25, deadlineDays: -1 }),
        ],
      }),
    );
    const tue = out.runway[1];
    assert.ok(tue.items.find((i) => i.refId === 1), 'overdue lands on first available day');
  });

  it('does NOT let a medium item consume the protected daily low quota', () => {
    // 30 min capacity Tue. After 15 reserved for low, bookable = 15.
    // A medium 25-min item cannot fit → defers (or breaches if past SLA).
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 0.5 }),
        emails: [
          makeEmail({ id: 1, category: 'CLINICAL', estMin: 25, deadlineDays: 1 }),
        ],
      }),
    );
    const tue = out.runway[1];
    // Medium item should NOT be on Tuesday — its size > bookable post-reserve.
    const placedTue = tue.items.find((i) => i.refId === 1);
    assert.equal(placedTue, undefined);
    // Either deferred entirely or placed past its deadline → must show as breach.
    assert.equal(out.breaches.length, 1);
    assert.equal(out.breaches[0].itemId, 1);
  });
});

// ----------------------------------------------------------------------------
// Capacity / breach detection
// ----------------------------------------------------------------------------

describe('buildPlan — low-priority handling', () => {
  it('low items larger than the daily quota still schedule via bookable capacity', () => {
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 2 }), // 120 min
        emails: [
          makeEmail({ id: 1, category: 'ADMIN', estMin: 45, deadlineDays: 14 }),
        ],
      }),
    );
    const tue = out.runway[1];
    const placed = tue.items.find((i) => i.refId === 1);
    assert.ok(placed, 'large low item is scheduled into bookable capacity');
    assert.equal(out.deferredItems.length, 0);
  });

  it('records a no_capacity_before_sla breach when a low item cannot be placed before its deadline', () => {
    // Only Mon (no admin), then days 1-13 also no admin. ADMIN due in 5 days
    // — runway covers it but no capacity exists, so it should breach.
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, {}),
        emails: [
          makeEmail({ id: 1, category: 'ADMIN', estMin: 10, deadlineDays: 5 }),
        ],
      }),
    );
    assert.equal(out.deferredItems.length, 1);
    assert.equal(out.breaches.length, 1);
    assert.equal(out.breaches[0].reason, 'no_capacity_before_sla');
    assert.equal(out.breaches[0].itemId, 1);
  });
});

describe('buildPlan — deferral history annotation', () => {
  it('adds deferralCount to placed email items with prior deferrals', () => {
    const out = buildPlan(
      baseInput({
        emails: [
          makeEmail({ id: 42, category: 'CLINICAL', estMin: 30, deadlineDays: 3 }),
        ],
        deferralHistory: new Map([[42, 1]]),
      }),
    );
    const placed = out.runway
      .flatMap((d) => d.items)
      .find((i) => i.refId === 42);
    assert.ok(placed, 'item should be placed');
    assert.equal(placed!.deferralCount, 1);
    assert.equal(placed!.deferralWarning, undefined);
  });

  it('raises deferralWarning at count >= 2', () => {
    const out = buildPlan(
      baseInput({
        emails: [
          makeEmail({ id: 7, category: 'CLINICAL', estMin: 30, deadlineDays: 5 }),
        ],
        deferralHistory: new Map([[7, 2]]),
      }),
    );
    const placed = out.runway
      .flatMap((d) => d.items)
      .find((i) => i.refId === 7);
    assert.ok(placed);
    assert.equal(placed!.deferralCount, 2);
    assert.equal(placed!.deferralWarning, 'twice_or_more');
  });

  it('annotates items that get deferred again (in deferredItems)', () => {
    // No availability → everything defers.
    const out = buildPlan(
      baseInput({
        emails: [
          makeEmail({ id: 99, category: 'ADMIN', estMin: 30, deadlineDays: 10 }),
        ],
        availability: buildAvailability(MONDAY, {}),
        deferralHistory: new Map([[99, 3]]),
      }),
    );
    const def = out.deferredItems.find((i) => i.refId === 99);
    assert.ok(def, 'should be in deferredItems');
    assert.equal(def!.deferralCount, 3);
    assert.equal(def!.deferralWarning, 'twice_or_more');
  });

  it('does not annotate items with no prior history', () => {
    const out = buildPlan(
      baseInput({
        emails: [
          makeEmail({ id: 1, category: 'CLINICAL', estMin: 30, deadlineDays: 3 }),
        ],
        deferralHistory: new Map(),
      }),
    );
    const placed = out.runway
      .flatMap((d) => d.items)
      .find((i) => i.refId === 1);
    assert.ok(placed);
    assert.equal(placed!.deferralCount, undefined);
    assert.equal(placed!.deferralWarning, undefined);
  });

  it('never annotates task items even with matching id', () => {
    // Task ids are strings, but ensure tasks generally aren't annotated.
    const out = buildPlan(
      baseInput({
        tasks: [makeTask({ id: 't42', deadlineDays: 3 })],
        deferralHistory: new Map([[42, 5]]),
      }),
    );
    const placed = out.runway
      .flatMap((d) => d.items)
      .find((i) => i.kind === 'task');
    assert.ok(placed);
    assert.equal(placed!.deferralCount, undefined);
    assert.equal(placed!.deferralWarning, undefined);
  });
});

describe('buildPlan — breach detection', () => {
  it('flags no_capacity_before_sla when an urgent item lands after its deadline', () => {
    // Tuesday only (no Mon). Urgent due TODAY (Mon, day 0) → earliest
    // placement is day 1, which is past day 0 → breach.
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 2 }),
        emails: [
          makeEmail({ id: 1, category: 'URGENT_CLINICAL', estMin: 20, deadlineDays: 0 }),
        ],
      }),
    );
    assert.equal(out.breaches.length, 1);
    assert.equal(out.breaches[0].reason, 'no_capacity_before_sla');
    assert.equal(out.overallStatus, 'red');
  });

  it('green status when everything fits with margin and nothing breaches', () => {
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 2, Wed: 2, Thu: 2 }),
        emails: [
          makeEmail({ id: 1, category: 'CLINICAL', estMin: 15, deadlineDays: 5 }),
          makeEmail({ id: 2, category: 'ADMIN', estMin: 10, deadlineDays: 14 }),
        ],
      }),
    );
    assert.equal(out.overallStatus, 'green');
    assert.equal(out.breaches.length, 0);
    assert.match(out.statusHeadline, /nicely on top of things/i);
  });
});

// ----------------------------------------------------------------------------
// Projected workload reservation
// ----------------------------------------------------------------------------

describe('buildPlan — projected workload reservation', () => {
  it('reserves capacity for incoming emails and reports it in the summary', () => {
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 5 }),
        emails: [],
        // New tiered model: 10 min/admin-day urgent + single 30-min weekly medium.
        // With only Tue available (1 future admin day): 10 + 30 = 40 min reserved.
        arrivals: DEFAULT_ARRIVAL_CONFIG,
      }),
    );
    assert.equal(out.reservation.totalReserveMin, 40);
    assert.equal(out.reservation.adminDayCount, 1);
    assert.equal(out.reservation.urgentDailyReserveMin, 10);
    assert.equal(out.reservation.mediumWeeklyReserveMin, 30);
    assert.equal(out.reservation.highCount, 5);
    assert.equal(out.reservation.mediumCount, 10);
    // Weekly capacity is reported pre-reservation so the UI can show
    // "of your 5h, X is reserved".
    assert.equal(out.weeklyCapacityMin, 300);
  });

  it('reservation never swallows more than half of a day so real work still fits', () => {
    // 60 min Tue (week 1 only). Default reservation = 180 min, but the
    // per-day carve-out is capped at half the day's bookable so a sparse
    // week (e.g. clinician only works one day) doesn't have its single
    // active day fully drained by hypothetical arrivals. A 5-min admin
    // email therefore lands on week-1 Tue, not week 2.
    const out = buildPlan(
      baseInput({
        availability: buildAvailability(MONDAY, { Tue: 1 }),
        emails: [makeEmail({ id: 1, category: 'ADMIN', estMin: 5, deadlineDays: 14 })],
        arrivals: DEFAULT_ARRIVAL_CONFIG,
      }),
    );
    const week1Tue = out.runway[1];
    assert.ok(
      week1Tue.items.find((i) => i.refId === 1),
      'real work lands on week-1 Tue even with a large arrivals reservation',
    );
    assert.equal(out.deferredItems.length, 0);
  });

  it('defers only when there is no real availability anywhere in the runway', () => {
    // Real existing work should NEVER be deferred just because the
    // projected-arrivals reservation notionally claimed every minute —
    // the reservation is for hypothetical future emails, real ones in
    // hand take priority. To truly force a deferral the runway must
    // have zero scheduleable minutes.
    const avail = buildAvailability(MONDAY, {}, { days: 7 });
    while (avail.length < 14) {
      const last = avail[avail.length - 1];
      const d = new Date(last.date);
      d.setDate(d.getDate() + 1);
      avail.push({
        date: d.toISOString().slice(0, 10),
        dayLabel: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
        displayLabel: 'pad',
        minutesAvailable: 0,
      });
    }
    const out = buildPlan(
      baseInput({
        availability: avail,
        emails: [makeEmail({ id: 1, category: 'ADMIN', estMin: 5, deadlineDays: 14 })],
        arrivals: DEFAULT_ARRIVAL_CONFIG,
      }),
    );
    assert.equal(out.deferredItems.length, 1);
  });

  it('places real work onto a day even when reservation claimed all of it', () => {
    // Inverse of the test above: when there IS some availability but
    // the projected-arrivals reservation has eaten the bookable pool,
    // a real existing item must still be scheduled (not deferred or
    // pushed past its deadline). This is the "Thursday looks empty
    // even though I have an hour free" bug.
    const avail = buildAvailability(MONDAY, { Tue: 1 }, { days: 7 });
    while (avail.length < 14) {
      const last = avail[avail.length - 1];
      const d = new Date(last.date);
      d.setDate(d.getDate() + 1);
      avail.push({
        date: d.toISOString().slice(0, 10),
        dayLabel: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
        displayLabel: 'pad',
        minutesAvailable: 0,
      });
    }
    const out = buildPlan(
      baseInput({
        availability: avail,
        emails: [makeEmail({ id: 1, category: 'ADMIN', estMin: 5, deadlineDays: 14 })],
        arrivals: DEFAULT_ARRIVAL_CONFIG,
      }),
    );
    assert.equal(out.deferredItems.length, 0);
    const tue = out.runway[1];
    assert.ok(tue.items.find((i) => i.refId === 1), 'item lands on Tue despite reservation');
  });
});
