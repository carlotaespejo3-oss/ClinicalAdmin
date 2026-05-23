import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveMinutesForDay, leaveBlocksForDay, type LeaveBlock } from './leaveBlocksStore';

// Helper — build a LeaveBlock from year/month/day/hour tuples.
// Hours are interpreted as UTC (not local time) so tests are
// timezone-independent — the store convention anchors all day
// boundaries to UTC midnight and parseDayBounds uses UTC, so the
// block timestamps must also be UTC-aligned for overlap arithmetic
// to be exact regardless of the machine's locale.
function block(
  start: [number, number, number, number?, number?],
  end: [number, number, number, number?, number?],
  leaveType: LeaveBlock['leaveType'] = 'annual',
): LeaveBlock {
  const [sy, sm, sd, sh = 9, smin = 0] = start;
  const [ey, em, ed, eh = 17, emin = 0] = end;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    id: `lv_${sy}${sm}${sd}_${ey}${em}${ed}`,
    startAt: `${sy}-${pad(sm)}-${pad(sd)}T${pad(sh)}:${pad(smin)}:00.000Z`,
    endAt:   `${ey}-${pad(em)}-${pad(ed)}T${pad(eh)}:${pad(emin)}:00.000Z`,
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
  currentLeaveStatus,
  dayWithinLeave,
  itemsAtRiskBeforeLeave,
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

// ---- T002 half-day correctness ---------------------------------------------

test('computeReturnFromLeave — half-day morning leave does NOT count as fully on leave', () => {
  // Mon morning 09–13 = 4h, working day has 4h admin. Leave covers
  // 4h × 4h/8h = 2h share — half the day. With workingMinutesByWeekday
  // supplied, Tue should NOT be flagged as "day back from Mon" because
  // Mon afternoon was still bookable.
  const halfDay = block([2026, 5, 11, 9], [2026, 5, 11, 13]);
  const mins = new Map([
    ['Mon', 240], ['Tue', 240], ['Wed', 240], ['Thu', 240], ['Fri', 240],
  ]);
  const map = computeReturnFromLeave(['2026-05-12'], [halfDay], MON_TO_FRI, mins);
  assert.equal(map.has('2026-05-12'), false);
});

test('computeReturnFromLeave — full-day leave still flagged when minutes map is provided', () => {
  const fullDay = block([2026, 5, 11, 9], [2026, 5, 11, 17]);
  const mins = new Map([
    ['Mon', 240], ['Tue', 240], ['Wed', 240], ['Thu', 240], ['Fri', 240],
  ]);
  const map = computeReturnFromLeave(['2026-05-12'], [fullDay], MON_TO_FRI, mins);
  assert.equal(map.get('2026-05-12')?.daysAway, 1);
});

// ---- T001 currentLeaveStatus ----------------------------------------------

test('currentLeaveStatus — on leave today', () => {
  const b = block([2026, 5, 18, 9], [2026, 5, 22, 17]);
  const status = currentLeaveStatus(new Date(2026, 5 - 1, 20, 11), [b], MON_TO_FRI);
  assert.equal(status.state, 'on-leave-today');
  if (status.state === 'on-leave-today') {
    assert.equal(status.block.id, b.id);
    assert.equal(status.dayBackKey, '2026-05-25'); // next Mon
  }
});

test('currentLeaveStatus — back today (Mon after Fri leave)', () => {
  const b = block([2026, 5, 15, 9], [2026, 5, 15, 17]);
  const status = currentLeaveStatus(new Date(2026, 5 - 1, 18, 9), [b], MON_TO_FRI);
  assert.equal(status.state, 'back-today');
  if (status.state === 'back-today') {
    assert.equal(status.daysAway, 1);
    assert.deepEqual(status.leaveTypes, ['annual']);
  }
});

test('currentLeaveStatus — leave starts in 3 days', () => {
  const b = block([2026, 5, 21, 9], [2026, 5, 22, 17]);
  const status = currentLeaveStatus(new Date(2026, 5 - 1, 18, 9), [b], MON_TO_FRI);
  assert.equal(status.state, 'leave-starts-soon');
  if (status.state === 'leave-starts-soon') {
    assert.equal(status.daysUntil, 3);
    assert.equal(status.block.id, b.id);
  }
});

test('currentLeaveStatus — no upcoming leave → none', () => {
  const b = block([2026, 6, 1, 9], [2026, 6, 1, 17]); // > 7 days away
  const status = currentLeaveStatus(new Date(2026, 5 - 1, 18, 9), [b], MON_TO_FRI);
  assert.equal(status.state, 'none');
});

test('currentLeaveStatus — empty blocks → none', () => {
  const status = currentLeaveStatus(new Date(2026, 5 - 1, 18), [], MON_TO_FRI);
  assert.equal(status.state, 'none');
});

test('currentLeaveStatus — half-day morning today with minutes map → NOT on-leave-today', () => {
  // Mon 18 May 09:00–13:00 — afternoon still bookable. Without the
  // minutes-map gate this would wrongly flag "on leave today" and
  // tell the clinician their admin time is paused.
  const halfDay = block([2026, 5, 18, 9], [2026, 5, 18, 13]);
  const mins = new Map<string, number>([
    ['Mon', 480], ['Tue', 480], ['Wed', 480], ['Thu', 480], ['Fri', 480],
  ]);
  const status = currentLeaveStatus(
    new Date(2026, 5 - 1, 18, 14),
    [halfDay],
    MON_TO_FRI,
    mins,
  );
  assert.notEqual(status.state, 'on-leave-today');
});

test('currentLeaveStatus — full-day today with minutes map → on-leave-today', () => {
  // Same day, but a full 09:00–17:00 block this time. Should still
  // raise the banner with the minutes-map gate in place.
  const fullDay = block([2026, 5, 18, 9], [2026, 5, 18, 17]);
  const mins = new Map<string, number>([
    ['Mon', 480], ['Tue', 480], ['Wed', 480], ['Thu', 480], ['Fri', 480],
  ]);
  const status = currentLeaveStatus(
    new Date(2026, 5 - 1, 18, 11),
    [fullDay],
    MON_TO_FRI,
    mins,
  );
  assert.equal(status.state, 'on-leave-today');
});

test('currentLeaveStatus — half-day morning, NO minutes map → on-leave-today (v1 fallback)', () => {
  // Backwards-compat: callers that don't pass a minutes map keep the
  // permissive v1 behaviour so they don't silently regress.
  const halfDay = block([2026, 5, 18, 9], [2026, 5, 18, 13]);
  const status = currentLeaveStatus(
    new Date(2026, 5 - 1, 18, 14),
    [halfDay],
    MON_TO_FRI,
  );
  assert.equal(status.state, 'on-leave-today');
});

// ---- T006 dayWithinLeave ---------------------------------------------------

test('dayWithinLeave — middle of a 5-day block returns index/total', () => {
  // Mon 18 → Fri 22. Wed is day 3 of 5.
  const b = block([2026, 5, 18, 9], [2026, 5, 22, 17]);
  const info = dayWithinLeave('2026-05-20', [b]);
  assert.ok(info);
  assert.equal(info!.index, 3);
  assert.equal(info!.total, 5);
  assert.equal(info!.block.id, b.id);
});

test('dayWithinLeave — single-day block returns null', () => {
  const b = block([2026, 5, 18, 9], [2026, 5, 18, 17]);
  assert.equal(dayWithinLeave('2026-05-18', [b]), null);
});

test('dayWithinLeave — day not within any block returns null', () => {
  const b = block([2026, 5, 18, 9], [2026, 5, 19, 17]);
  assert.equal(dayWithinLeave('2026-05-25', [b]), null);
});

test('dayWithinLeave — picks the longest covering block when overlapping', () => {
  const short = block([2026, 5, 18, 9], [2026, 5, 19, 17]); // 2 days
  const long = block([2026, 5, 15, 9], [2026, 5, 22, 17]); // 8 days
  const info = dayWithinLeave('2026-05-18', [short, long]);
  assert.equal(info?.total, 8);
  assert.equal(info?.block.id, long.id);
});

// ---- T004 itemsAtRiskBeforeLeave -------------------------------------------

test('itemsAtRiskBeforeLeave — task due during upcoming leave is flagged', () => {
  // Today = Mon 11 May 2026. Leave covers Mon 18–Fri 22.
  const today = new Date(2026, 5 - 1, 11);
  const leave = block([2026, 5, 18, 9], [2026, 5, 22, 17]);
  const items = [
    { id: 't1', title: 'Report due Wed 20th', deadlineDate: '2026-05-20' },
    { id: 't2', title: 'Email due tomorrow', deadlineDays: 1 },
  ];
  const out = itemsAtRiskBeforeLeave(today, [leave], items);
  assert.equal(out.length, 1);
  assert.equal(out[0].item.id, 't1');
  assert.equal(out[0].block.id, leave.id);
});

test('itemsAtRiskBeforeLeave — overdue items are not flagged here', () => {
  const today = new Date(2026, 5 - 1, 18);
  const leave = block([2026, 5, 20, 9], [2026, 5, 22, 17]);
  const items = [{ id: 't1', title: 'Overdue', deadlineDays: -2 }];
  assert.equal(itemsAtRiskBeforeLeave(today, [leave], items).length, 0);
});

test('itemsAtRiskBeforeLeave — leave already in progress is not "upcoming"', () => {
  // Today = Wed 20th, leave started Mon 18th, task due Thu 21st.
  // Doesn't count — the clinician is already away, not approaching.
  const today = new Date(2026, 5 - 1, 20);
  const leave = block([2026, 5, 18, 9], [2026, 5, 22, 17]);
  const items = [{ id: 't1', title: 'Due Thu', deadlineDate: '2026-05-21' }];
  assert.equal(itemsAtRiskBeforeLeave(today, [leave], items).length, 0);
});

test('itemsAtRiskBeforeLeave — sorts by deadline soonest-first', () => {
  const today = new Date(2026, 5 - 1, 11);
  const leave = block([2026, 5, 18, 9], [2026, 5, 22, 17]);
  const items = [
    { id: 'late', title: 'Late', deadlineDate: '2026-05-22' },
    { id: 'early', title: 'Early', deadlineDate: '2026-05-18' },
  ];
  const out = itemsAtRiskBeforeLeave(today, [leave], items);
  assert.equal(out[0].item.id, 'early');
  assert.equal(out[1].item.id, 'late');
});
