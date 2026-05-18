// availability.test.ts
//
// Port of the user-provided Vitest spec to node:test (the repo's test
// runner). The test BODIES are intentionally unchanged from the
// upstream file — only the import surface + a tiny `expect` shim at
// the top differ — so future revisions of the upstream spec can be
// dropped in with minimal re-conversion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAvailability,
  WorkingPattern,
  RecoveryConfig,
  ProjectedArrivalConfig,
  LeaveBlock,
} from './availability';

// ---- Vitest-shaped shim ------------------------------------------------------

const describe = (_name: string, fn: () => void): void => fn();
const it = test;

interface Matchers {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toMatchObject: (expected: Record<string, unknown>) => void;
  toHaveLength: (n: number) => void;
  toBeUndefined: () => void;
  toBeGreaterThanOrEqual: (n: number) => void;
}

function expect(actual: unknown): Matchers {
  return {
    toBe: (expected) => assert.equal(actual, expected),
    toEqual: (expected) => assert.deepEqual(actual, expected),
    toMatchObject: (expected) => {
      assert.ok(
        actual !== null && typeof actual === 'object',
        `toMatchObject: actual is not an object (got ${typeof actual})`,
      );
      const a = actual as Record<string, unknown>;
      for (const k of Object.keys(expected)) {
        assert.deepEqual(a[k], expected[k], `field ${k} mismatch`);
      }
    },
    toHaveLength: (n) => {
      const len = (actual as { length?: number })?.length;
      assert.equal(len, n);
    },
    toBeUndefined: () => assert.equal(actual, undefined),
    toBeGreaterThanOrEqual: (n) => {
      assert.ok(
        typeof actual === 'number' && actual >= n,
        `expected ${String(actual)} >= ${n}`,
      );
    },
  };
}

// ---- Fixtures ----------------------------------------------------------------

const MON_TO_FRI: WorkingPattern = {
  monday: 180, tuesday: 180, wednesday: 180, thursday: 180, friday: 180,
  saturday: 0, sunday: 0,
};

const MON_TO_THU: WorkingPattern = {
  monday: 180, tuesday: 180, wednesday: 180, thursday: 180, friday: 0,
  saturday: 0, sunday: 0,
};

const RECOVERY: RecoveryConfig = {
  rampMultipliers: [0.5, 0.75, 1.0],
  recoveryReservedMin: [60, 30, 0],
  triageReservedMin: [20, 0, 0],
  preLeaveWindDown: [0.75, 0.5],
  triggerAfterDaysOff: 3,
};

const ARRIVALS: ProjectedArrivalConfig = {
  emailsPerWeek: 60,
  highPerWeek: 5,
  mediumPerWeek: 10,
  urgentDailyReserveMin: 10,
  mediumWeeklyReserveMin: 30,
};

// A handy Monday to anchor everything on.
const MONDAY = '2026-05-18';   // Monday

function baseInput(overrides: Partial<Parameters<typeof resolveAvailability>[0]> = {}) {
  return {
    today: MONDAY,
    workingPattern: MON_TO_FRI,
    leaveBlocks: [] as LeaveBlock[],
    publicHolidays: [] as string[],
    recoveryConfig: RECOVERY,
    arrivalConfig: ARRIVALS,
    ...overrides,
  };
}

// ---- 1. Baseline (no leave) --------------------------------------------------

describe('resolveAvailability — baseline', () => {
  it('produces 14 days from working pattern with weekends zeroed', () => {
    const out = resolveAvailability(baseInput());
    expect(out.dailyAvailability).toHaveLength(14);

    // Day 0 is Monday 2026-05-18
    expect(out.dailyAvailability[0]).toMatchObject({
      date: '2026-05-18', minutesAvailable: 180, dayKind: 'normal',
    });
    // Day 5 is Saturday → 0
    expect(out.dailyAvailability[5]).toMatchObject({
      date: '2026-05-23', minutesAvailable: 0, dayKind: 'normal',
    });
    // Day 6 is Sunday → 0
    expect(out.dailyAvailability[6]).toMatchObject({
      date: '2026-05-24', minutesAvailable: 0, dayKind: 'normal',
    });
  });

  it('zeros out public holidays and marks them', () => {
    const out = resolveAvailability(baseInput({
      publicHolidays: ['2026-05-20'], // Wednesday
    }));
    expect(out.dailyAvailability[2]).toMatchObject({
      date: '2026-05-20', minutesAvailable: 0, dayKind: 'public_holiday',
    });
    // No recovery triggered by a lone holiday.
    expect(out.dailyAvailability[3].dayKind).toBe('normal');
  });

  it('leaveContext is empty when there is no leave', () => {
    const out = resolveAvailability(baseInput());
    expect(out.leaveContext).toEqual({});
  });
});

// ---- 2. Short leave — no recovery trigger ------------------------------------

describe('resolveAvailability — short leave', () => {
  it('1-day sick leave does not trigger wind-down or recovery', () => {
    const out = resolveAvailability(baseInput({
      leaveBlocks: [{
        id: 'l1',
        startAt: '2026-05-20T00:00:00Z', // Wed
        endAt:   '2026-05-21T00:00:00Z', // Thu (exclusive)
        type: 'sick',
      }],
    }));
    expect(out.dailyAvailability[2]).toMatchObject({
      date: '2026-05-20', minutesAvailable: 0, dayKind: 'leave',
    });
    // Day before (Tue) and day after (Thu) untouched.
    expect(out.dailyAvailability[1].dayKind).toBe('normal');
    expect(out.dailyAvailability[1].minutesAvailable).toBe(180);
    expect(out.dailyAvailability[3].dayKind).toBe('normal');
    expect(out.dailyAvailability[3].minutesAvailable).toBe(180);
  });
});

// ---- 3. Week-long annual leave — wind-down + recovery ------------------------

describe('resolveAvailability — week-long annual leave', () => {
  it('applies wind-down before and recovery after', () => {
    // Leave: Wed 2026-05-20 → Tue 2026-05-26 (6 calendar days)
    const out = resolveAvailability(baseInput({
      leaveBlocks: [{
        id: 'l1',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-26T00:00:00Z',
        type: 'annual',
      }],
    }));

    // Mon (day 0) — wind-down step [1] = 0.5  → 180 * 0.5 = 90
    expect(out.dailyAvailability[0]).toMatchObject({
      date: '2026-05-18', dayKind: 'pre_leave', minutesAvailable: 90,
    });
    // Tue (day 1) — wind-down step [0] = 0.75 → 180 * 0.75 = 135
    expect(out.dailyAvailability[1]).toMatchObject({
      date: '2026-05-19', dayKind: 'pre_leave', minutesAvailable: 135,
    });
    // Wed–Mon — leave (Sat/Sun fall inside the block too)
    expect(out.dailyAvailability[2].dayKind).toBe('leave');
    expect(out.dailyAvailability[7].dayKind).toBe('leave'); // Mon 25
    // Tue 26 is the day endAt points to (exclusive) — first day back.
    // Ramp [0] = 0.5 → 90 min, plus 60 min admin + 20 min triage protected.
    expect(out.dailyAvailability[8]).toMatchObject({
      date: '2026-05-26', dayKind: 'recovery',
      minutesAvailable: 90, recoveryReservedMin: 60, triageReservedMin: 20,
    });
    // Wed (day 9) — ramp [1] = 0.75 → 135 min, 30 min admin, no more triage.
    expect(out.dailyAvailability[9]).toMatchObject({
      date: '2026-05-27', dayKind: 'recovery',
      minutesAvailable: 135, recoveryReservedMin: 30, triageReservedMin: 0,
    });
    // Thu (day 10) — ramp [2] = 1.0 → 180, no reserved.
    expect(out.dailyAvailability[10]).toMatchObject({
      date: '2026-05-28', dayKind: 'recovery',
      minutesAvailable: 180, recoveryReservedMin: 0, triageReservedMin: 0,
    });
    // Fri onward — normal.
    expect(out.dailyAvailability[11].dayKind).toBe('normal');
  });

  it('sets the upcoming leave block in context', () => {
    const block: LeaveBlock = {
      id: 'l1',
      startAt: '2026-05-20T00:00:00Z',
      endAt:   '2026-05-26T00:00:00Z',
      type: 'annual',
    };
    const out = resolveAvailability(baseInput({ leaveBlocks: [block] }));
    expect(out.leaveContext.activeBlock).toBeUndefined();
    expect(out.leaveContext.upcomingBlock).toEqual(block);
  });
});

// ---- 4. Half-day leave -------------------------------------------------------

describe('resolveAvailability — half-day leave', () => {
  it('halves the day, marks dayKind leave, but does not trigger recovery', () => {
    const out = resolveAvailability(baseInput({
      leaveBlocks: [{
        id: 'l1',
        startAt: '2026-05-20T09:00:00Z',
        endAt:   '2026-05-20T13:00:00Z',
        type: 'pd',
      }],
    }));
    expect(out.dailyAvailability[2]).toMatchObject({
      date: '2026-05-20', dayKind: 'leave', minutesAvailable: 90,
    });
    // No recovery on Thu — half-day doesn't count toward trigger.
    expect(out.dailyAvailability[3].dayKind).toBe('normal');
  });
});

// ---- 5. Currently on leave ---------------------------------------------------

describe('resolveAvailability — currently on leave', () => {
  it('sets activeBlock and returningOn', () => {
    // Leave started last week, ends Wednesday this week.
    const block: LeaveBlock = {
      id: 'l1',
      startAt: '2026-05-11T00:00:00Z',
      endAt:   '2026-05-21T00:00:00Z', // exclusive → return on Thu 21
      type: 'annual',
    };
    const out = resolveAvailability(baseInput({ leaveBlocks: [block] }));

    // Today (Mon 18) is mid-leave.
    expect(out.dailyAvailability[0]).toMatchObject({
      date: '2026-05-18', minutesAvailable: 0, dayKind: 'leave',
    });
    expect(out.leaveContext.activeBlock).toEqual(block);
    expect(out.leaveContext.returningOn).toBe('2026-05-21');

    // Thu 21 should be 'recovery' day [0] with both admin and triage blocks.
    expect(out.dailyAvailability[3]).toMatchObject({
      date: '2026-05-21', dayKind: 'recovery',
      minutesAvailable: 90, recoveryReservedMin: 60, triageReservedMin: 20,
    });
  });
});

// ---- 6. Leave straddling weekends merges into one stretch --------------------

describe('resolveAvailability — adjacent off days merge', () => {
  it('treats leave + weekend + leave as a single stretch', () => {
    // Block A: Fri only.  Block B: following Mon-Tue.
    // The full off-stretch is Fri+Sat+Sun+Mon+Tue. Two blocks sum to
    // 3 calendar days of leave → trigger fires.
    const blocks: LeaveBlock[] = [
      { id: 'a', startAt: '2026-05-22T00:00:00Z', endAt: '2026-05-23T00:00:00Z', type: 'annual' },
      { id: 'b', startAt: '2026-05-25T00:00:00Z', endAt: '2026-05-27T00:00:00Z', type: 'annual' },
    ];
    const out = resolveAvailability(baseInput({ leaveBlocks: blocks }));

    // Thu (day 3) is the day before the stretch — should be wind-down.
    expect(out.dailyAvailability[3]).toMatchObject({
      date: '2026-05-21', dayKind: 'pre_leave',
    });
    // Wed (day 9, 2026-05-27) is first day back — recovery [0].
    expect(out.dailyAvailability[9]).toMatchObject({
      date: '2026-05-27', dayKind: 'recovery', recoveryReservedMin: 60,
    });
  });
});

// ---- 7. Working pattern with non-standard days -------------------------------

describe('resolveAvailability — Mon-Thu working pattern', () => {
  it('skips Friday when looking for wind-down/recovery working days', () => {
    // Leave Mon-Tue next week (2026-05-25 → 2026-05-27, 2 calendar days,
    // doesn't trigger by itself). Add Wed-Thu too to push it over.
    const block: LeaveBlock = {
      id: 'l',
      startAt: '2026-05-25T00:00:00Z',
      endAt:   '2026-05-29T00:00:00Z', // exclusive → Mon-Thu = 4 days
      type: 'annual',
    };
    const out = resolveAvailability(baseInput({
      workingPattern: MON_TO_THU,
      leaveBlocks: [block],
    }));
    // The day before the stretch (walking back through Fri 22 which is
    // non-working, Thu 21 which IS working) — Thu gets wind-down [0].
    expect(out.dailyAvailability[3]).toMatchObject({
      date: '2026-05-21', dayKind: 'pre_leave', minutesAvailable: 135,
    });
    // After the leave ends Thu 28 23:59, return is Mon Jun 1 (Fri+Sat+Sun
    // all non-working). Day 14 from May 18 is May 31; out of window.
    // Within the window, the last day is Sun May 31 — no recovery applied
    // inside this window. (That's correct — recovery happens next window.)
    // Just sanity-check the leave days fill through Thu 28.
    expect(out.dailyAvailability[10].dayKind).toBe('leave'); // 28
  });
});

// ---- 8. Arrivals scaling -----------------------------------------------------

describe('resolveAvailability — arrivals scaling', () => {
  it('does not scale when no leave touches week 1', () => {
    const out = resolveAvailability(baseInput());
    expect(out.effectiveArrivalConfig).toEqual(ARRIVALS);
  });

  it('scales arrivals down proportionally when week 1 has leave', () => {
    // Leave Wed-Fri this week. Working days in week 1 (days 1-6) drop from
    // 4 (Tue, Wed, Thu, Fri) to 1 (Tue). Baseline = 5 working days/week.
    // Scale = 1/5.
    const out = resolveAvailability(baseInput({
      leaveBlocks: [{
        id: 'l',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-23T00:00:00Z',
        type: 'annual',
      }],
    }));
    // Working days normally in days 1-6: Tue, Wed, Thu, Fri = 4.
    // After leave: only Tue still has minutes > 0 → actuallyWorking = 1.
    // scale = 1/4 = 0.25.
    expect(out.effectiveArrivalConfig.emailsPerWeek).toBe(15);  // round(60 * 0.25)
    expect(out.effectiveArrivalConfig.urgentDailyReserveMin).toBe(10); // unchanged
  });
});

// ---- 8b. Per-leave-type curves ----------------------------------------------

const RECOVERY_PER_TYPE: RecoveryConfig = {
  ...RECOVERY,
  byLeaveType: {
    sick: {
      preLeaveWindDown: [],
    },
    conference: {
      rampMultipliers: [0.75, 1.0],
      recoveryReservedMin: [30, 0],
      triageReservedMin: [10, 0],
      preLeaveWindDown: [],
    },
    pd: {
      rampMultipliers: [0.75, 1.0],
      recoveryReservedMin: [30, 0],
      triageReservedMin: [10, 0],
      preLeaveWindDown: [],
    },
  },
};

describe('resolveAvailability — per-type recovery curves', () => {
  it('annual leave keeps the existing curve unchanged', () => {
    // Same scenario as the "week-long annual leave" test above, but
    // run through the per-type config. The output must match exactly.
    const out = resolveAvailability(baseInput({
      recoveryConfig: RECOVERY_PER_TYPE,
      leaveBlocks: [{
        id: 'l1',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-26T00:00:00Z',
        type: 'annual',
      }],
    }));
    expect(out.dailyAvailability[0]).toMatchObject({
      date: '2026-05-18', dayKind: 'pre_leave', minutesAvailable: 90,
    });
    expect(out.dailyAvailability[1]).toMatchObject({
      date: '2026-05-19', dayKind: 'pre_leave', minutesAvailable: 135,
    });
    expect(out.dailyAvailability[8]).toMatchObject({
      date: '2026-05-26', dayKind: 'recovery',
      minutesAvailable: 90, recoveryReservedMin: 60, triageReservedMin: 20,
    });
    expect(out.dailyAvailability[10]).toMatchObject({
      date: '2026-05-28', dayKind: 'recovery',
      minutesAvailable: 180, recoveryReservedMin: 0, triageReservedMin: 0,
    });
  });

  it('sick leave produces no wind-down but normal recovery', () => {
    // Sick block Wed-Mon (6 cal days, same length as the annual case).
    const out = resolveAvailability(baseInput({
      recoveryConfig: RECOVERY_PER_TYPE,
      leaveBlocks: [{
        id: 'l1',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-26T00:00:00Z',
        type: 'sick',
      }],
    }));
    // Mon/Tue before — NO wind-down (sick is entered too late for it).
    expect(out.dailyAvailability[0]).toMatchObject({
      date: '2026-05-18', dayKind: 'normal', minutesAvailable: 180,
    });
    expect(out.dailyAvailability[1]).toMatchObject({
      date: '2026-05-19', dayKind: 'normal', minutesAvailable: 180,
    });
    // Recovery on return is the annual default — sick override only
    // touched preLeaveWindDown, so ramp+reserved fall through.
    expect(out.dailyAvailability[8]).toMatchObject({
      date: '2026-05-26', dayKind: 'recovery',
      minutesAvailable: 90, recoveryReservedMin: 60, triageReservedMin: 20,
    });
  });

  it('conference leave uses a shorter ramp and lighter reserved minutes', () => {
    const out = resolveAvailability(baseInput({
      recoveryConfig: RECOVERY_PER_TYPE,
      leaveBlocks: [{
        id: 'l1',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-26T00:00:00Z',
        type: 'conference',
      }],
    }));
    // No wind-down before.
    expect(out.dailyAvailability[0].dayKind).toBe('normal');
    expect(out.dailyAvailability[1].dayKind).toBe('normal');
    // First day back: ramp [0.75] → 135 min, lighter reserved (30/10).
    expect(out.dailyAvailability[8]).toMatchObject({
      date: '2026-05-26', dayKind: 'recovery',
      minutesAvailable: 135, recoveryReservedMin: 30, triageReservedMin: 10,
    });
    // Day 2 back: ramp [1.0] → full 180, no reserved.
    expect(out.dailyAvailability[9]).toMatchObject({
      date: '2026-05-27', dayKind: 'recovery',
      minutesAvailable: 180, recoveryReservedMin: 0, triageReservedMin: 0,
    });
    // Day 3 back: ramp array only has 2 steps → back to normal.
    expect(out.dailyAvailability[10].dayKind).toBe('normal');
  });

  it('pd leave behaves like conference', () => {
    const out = resolveAvailability(baseInput({
      recoveryConfig: RECOVERY_PER_TYPE,
      leaveBlocks: [{
        id: 'l1',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-26T00:00:00Z',
        type: 'pd',
      }],
    }));
    expect(out.dailyAvailability[0].dayKind).toBe('normal');
    expect(out.dailyAvailability[8]).toMatchObject({
      date: '2026-05-26', dayKind: 'recovery',
      minutesAvailable: 135, recoveryReservedMin: 30, triageReservedMin: 10,
    });
  });

  it('unpaid leave behaves like annual (no override → falls back to baseline)', () => {
    const out = resolveAvailability(baseInput({
      recoveryConfig: RECOVERY_PER_TYPE,
      leaveBlocks: [{
        id: 'l1',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-26T00:00:00Z',
        type: 'unpaid',
      }],
    }));
    // Wind-down before — same as annual.
    expect(out.dailyAvailability[0]).toMatchObject({
      date: '2026-05-18', dayKind: 'pre_leave', minutesAvailable: 90,
    });
    expect(out.dailyAvailability[1]).toMatchObject({
      date: '2026-05-19', dayKind: 'pre_leave', minutesAvailable: 135,
    });
    // Full annual recovery curve on the way back.
    expect(out.dailyAvailability[8]).toMatchObject({
      date: '2026-05-26', dayKind: 'recovery',
      minutesAvailable: 90, recoveryReservedMin: 60, triageReservedMin: 20,
    });
    expect(out.dailyAvailability[9]).toMatchObject({
      date: '2026-05-27', dayKind: 'recovery',
      minutesAvailable: 135, recoveryReservedMin: 30, triageReservedMin: 0,
    });
    expect(out.dailyAvailability[10]).toMatchObject({
      date: '2026-05-28', dayKind: 'recovery', minutesAvailable: 180,
    });
  });

  it('overlapping annual + conference resolves to the stronger (annual) curve', () => {
    // Two blocks covering the same Wed-Mon stretch. The merge should
    // pick the longer ramp + higher reserved minutes (annual wins on
    // every dimension) and re-instate the wind-down (annual has one,
    // conference doesn't — longer wins).
    const blocks: LeaveBlock[] = [
      { id: 'a', startAt: '2026-05-20T00:00:00Z', endAt: '2026-05-26T00:00:00Z', type: 'annual' },
      { id: 'b', startAt: '2026-05-20T00:00:00Z', endAt: '2026-05-26T00:00:00Z', type: 'conference' },
    ];
    const out = resolveAvailability(baseInput({
      recoveryConfig: RECOVERY_PER_TYPE,
      leaveBlocks: blocks,
    }));
    // Wind-down restored.
    expect(out.dailyAvailability[0]).toMatchObject({
      date: '2026-05-18', dayKind: 'pre_leave', minutesAvailable: 90,
    });
    expect(out.dailyAvailability[1]).toMatchObject({
      date: '2026-05-19', dayKind: 'pre_leave', minutesAvailable: 135,
    });
    // Recovery uses the annual ramp + reserved (the higher of the two).
    expect(out.dailyAvailability[8]).toMatchObject({
      date: '2026-05-26', dayKind: 'recovery',
      minutesAvailable: 90, recoveryReservedMin: 60, triageReservedMin: 20,
    });
    expect(out.dailyAvailability[9]).toMatchObject({
      date: '2026-05-27', dayKind: 'recovery',
      minutesAvailable: 135, recoveryReservedMin: 30, triageReservedMin: 0,
    });
    expect(out.dailyAvailability[10]).toMatchObject({
      date: '2026-05-28', dayKind: 'recovery', minutesAvailable: 180,
    });
  });
});

// ---- 9. Stress / smoke -------------------------------------------------------

describe('resolveAvailability — invariants', () => {
  it('is deterministic: same input -> same output', () => {
    const input = baseInput({
      leaveBlocks: [{
        id: 'l',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-26T00:00:00Z',
        type: 'annual',
      }],
    });
    const a = resolveAvailability(input);
    const b = resolveAvailability(input);
    expect(a).toEqual(b);
  });

  it('never produces negative minutes', () => {
    const out = resolveAvailability(baseInput({
      leaveBlocks: [{
        id: 'l',
        startAt: '2026-05-20T00:00:00Z',
        endAt:   '2026-05-26T00:00:00Z',
        type: 'annual',
      }],
    }));
    for (const day of out.dailyAvailability) {
      expect(day.minutesAvailable).toBeGreaterThanOrEqual(0);
      expect(day.recoveryReservedMin).toBeGreaterThanOrEqual(0);
    }
  });
});
