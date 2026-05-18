import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveMinutesForDay, leaveBlocksForDay, type LeaveBlock } from './leaveBlocksStore';

// Helper — build a LeaveBlock from local-time year/month/day/hour
// tuples. The store stores ISO strings, so we wrap Date#toISOString
// here just like the API client would.
function block(
  startLocal: [number, number, number, number?, number?],
  endLocal: [number, number, number, number?, number?],
  leaveType: LeaveBlock['leaveType'] = 'annual',
): LeaveBlock {
  const [sy, sm, sd, sh = 9, smin = 0] = startLocal;
  const [ey, em, ed, eh = 17, emin = 0] = endLocal;
  return {
    id: `lv_${sy}${sm}${sd}_${ey}${em}${ed}`,
    startAt: new Date(sy, sm - 1, sd, sh, smin, 0, 0).toISOString(),
    endAt: new Date(ey, em - 1, ed, eh, emin, 0, 0).toISOString(),
    leaveType,
    notes: null,
  };
}

test('leaveMinutesForDay — no blocks → 0', () => {
  assert.equal(leaveMinutesForDay('2026-05-18', [], 240), 0);
});

test('leaveMinutesForDay — zero working minutes short-circuits', () => {
  const b = block([2026, 5, 18, 9], [2026, 5, 18, 17]);
  assert.equal(leaveMinutesForDay('2026-05-18', [b], 0), 0);
});

test('leaveMinutesForDay — block does not overlap the day', () => {
  const b = block([2026, 5, 20, 9], [2026, 5, 20, 17]);
  assert.equal(leaveMinutesForDay('2026-05-18', [b], 240), 0);
});

test('leaveMinutesForDay — full 8h working day zeroes out a 240-min admin day', () => {
  const b = block([2026, 5, 18, 9], [2026, 5, 18, 17]);
  assert.equal(leaveMinutesForDay('2026-05-18', [b], 240), 240);
});

test('leaveMinutesForDay — half-day (4h) reduces by ~50%', () => {
  const b = block([2026, 5, 18, 9], [2026, 5, 18, 13]);
  // 240 min × 4h/8h = 120
  assert.equal(leaveMinutesForDay('2026-05-18', [b], 240), 120);
});

test('leaveMinutesForDay — overlap capped at working minutes', () => {
  // A 12h "leave" block (e.g. all-day sick from 06:00 to 18:00)
  // still can't subtract more than the actual admin minutes.
  const b = block([2026, 5, 18, 6], [2026, 5, 18, 18]);
  assert.equal(leaveMinutesForDay('2026-05-18', [b], 240), 240);
});

test('leaveMinutesForDay — multi-day block covers each calendar day inside', () => {
  const b = block([2026, 10, 21, 9], [2026, 11, 4, 17]);
  // Pick a mid-range day — should be a full-day zero out.
  assert.equal(leaveMinutesForDay('2026-10-27', [b], 180), 180);
  // Days outside the block return 0.
  assert.equal(leaveMinutesForDay('2026-11-05', [b], 180), 0);
});

test('leaveMinutesForDay — DST start day (spring forward) is day-bound, no hour-shift drift', () => {
  // 30 March 2025 = UK spring-forward (01:00 → 02:00). On a +24h
  // day-end calculation, the day window would have leaked into 31
  // March 00:00 local because of the missing hour, causing extra
  // overlap to be counted. Using calendar-day bounds, a leave block
  // entirely on 31 March must not contribute to 30 March's overlap.
  const b = block([2025, 3, 31, 9], [2025, 3, 31, 17]);
  assert.equal(leaveMinutesForDay('2025-03-30', [b], 240), 0);
});

test('leaveMinutesForDay — DST end day (fall back) is day-bound, no hour-shift drift', () => {
  // 26 October 2025 = UK fall-back (02:00 → 01:00). A leave block
  // entirely on 27 October must not contribute to 26 October's
  // overlap even though that local day is 25h long.
  const b = block([2025, 10, 27, 9], [2025, 10, 27, 17]);
  assert.equal(leaveMinutesForDay('2025-10-26', [b], 240), 0);
});

test('leaveBlocksForDay — returns only blocks that touch the calendar day', () => {
  const inside = block([2026, 5, 18, 9], [2026, 5, 18, 17]);
  const before = block([2026, 5, 17, 9], [2026, 5, 17, 17]);
  const spanning = block([2026, 5, 15, 9], [2026, 5, 20, 17]);
  const blocks = [inside, before, spanning];
  const day = leaveBlocksForDay('2026-05-18', blocks);
  assert.equal(day.length, 2);
  assert.ok(day.includes(inside));
  assert.ok(day.includes(spanning));
  assert.ok(!day.includes(before));
});

import {
  computeReturnFromLeave,
  nextWorkingDayAfter,
} from './leaveBlocksStore';

const MON_TO_FRI = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

test('computeReturnFromLeave — Mon back from Fri-only annual leave returns 1 day away', () => {
  // 2026-05-15 is a Friday. Block covers Fri 09–17. Returning Mon 2026-05-18.
  const b = block([2026, 5, 15, 9], [2026, 5, 15, 17]);
  const map = computeReturnFromLeave(['2026-05-18'], [b], MON_TO_FRI);
  const info = map.get('2026-05-18');
  assert.ok(info, 'Mon should be flagged as return-from-leave');
  assert.equal(info!.daysAway, 1);
  assert.deepEqual(info!.leaveTypes, ['annual']);
  assert.deepEqual(info!.precedingBlockIds, [b.id]);
});

test('computeReturnFromLeave — weekend between leave and return is transparent', () => {
  // Leave runs Thu+Fri (2026-05-14, 2026-05-15). Returning Mon 2026-05-18.
  // daysAway counts the 2 weekdays of leave but NOT Sat/Sun in between.
  const b = block([2026, 5, 14, 9], [2026, 5, 15, 17]);
  const map = computeReturnFromLeave(['2026-05-18'], [b], MON_TO_FRI);
  assert.equal(map.get('2026-05-18')?.daysAway, 2);
});

test('computeReturnFromLeave — a normal working day between two leave blocks breaks the chain', () => {
  // Leave Mon 11th, working Tue 12th, leave Wed 13th. Returning Thu 14th
  // should report daysAway=1 (only Wed), not 2 — Tue interrupts the run.
  const b1 = block([2026, 5, 11, 9], [2026, 5, 11, 17]);
  const b2 = block([2026, 5, 13, 9], [2026, 5, 13, 17]);
  const map = computeReturnFromLeave(['2026-05-14'], [b1, b2], MON_TO_FRI);
  assert.equal(map.get('2026-05-14')?.daysAway, 1);
});

test('computeReturnFromLeave — day with leave on it is NOT a return day', () => {
  const b = block([2026, 5, 18, 9], [2026, 5, 20, 17]);
  const map = computeReturnFromLeave(['2026-05-18', '2026-05-19'], [b], MON_TO_FRI);
  assert.equal(map.size, 0);
});

test('computeReturnFromLeave — non-working weekday per pattern is not a return day', () => {
  // Clinician works only Tue/Wed/Thu. Leave Tue 12th. Mon 11th and Fri 15th
  // are non-working — shouldn't be reported as return days.
  const TUE_WED_THU = new Set(['Tue', 'Wed', 'Thu']);
  const b = block([2026, 5, 12, 9], [2026, 5, 12, 17]);
  const map = computeReturnFromLeave(
    ['2026-05-11', '2026-05-13', '2026-05-15'],
    [b],
    TUE_WED_THU,
  );
  // Wed 13th is the next working day after Tue leave → flagged.
  assert.equal(map.get('2026-05-13')?.daysAway, 1);
  // Fri 15th is non-working → absent.
  assert.equal(map.has('2026-05-15'), false);
});

test('computeReturnFromLeave — dedupes leave types and block ids across the run', () => {
  // Two annual-leave blocks back to back: Mon and Tue. Returning Wed.
  const b1 = block([2026, 5, 11, 9], [2026, 5, 11, 17]);
  const b2 = block([2026, 5, 12, 9], [2026, 5, 12, 17]);
  const map = computeReturnFromLeave(['2026-05-13'], [b1, b2], MON_TO_FRI);
  const info = map.get('2026-05-13')!;
  assert.equal(info.daysAway, 2);
  assert.deepEqual(info.leaveTypes, ['annual']);
  assert.deepEqual(info.precedingBlockIds.sort(), [b1.id, b2.id].sort());
});

test('nextWorkingDayAfter — Fri 17:00 end → next Monday', () => {
  // Block ends Fri 2026-05-15 17:00. Next working day should be Mon 2026-05-18.
  const endAt = new Date(2026, 5 - 1, 15, 17, 0).toISOString();
  const next = nextWorkingDayAfter(endAt, MON_TO_FRI, []);
  assert.equal(next, '2026-05-18');
});

test('nextWorkingDayAfter — skips a second leave block that immediately follows', () => {
  // First block ends Fri 15th. A second block covers Mon 18th. Next clear
  // working day is Tue 19th.
  const endAt = new Date(2026, 5 - 1, 15, 17, 0).toISOString();
  const second = block([2026, 5, 18, 9], [2026, 5, 18, 17]);
  const next = nextWorkingDayAfter(endAt, MON_TO_FRI, [second]);
  assert.equal(next, '2026-05-19');
});
