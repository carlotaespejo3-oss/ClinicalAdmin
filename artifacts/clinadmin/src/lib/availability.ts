// availability.ts
//
// Translates the clinician's baseline working pattern + declared leave
// + public holidays + recovery preferences into the per-day shape the
// planner consumes.
//
// Pure function. Same input -> same output. No clock reads, no IO.
// Same testing posture as planner.ts.
//
// Pipeline:
//   WorkingPattern + LeaveBlock[] + PublicHolidays + RecoveryConfig
//                      |
//                      v
//              resolveAvailability
//                      |
//                      v
//   { dailyAvailability[14], effectiveArrivalConfig, leaveContext }
//                      |
//                      v
//                  buildPlan

// ============================================================================
// Types
// ============================================================================

export type LeaveType = 'annual' | 'sick' | 'conference' | 'pd' | 'unpaid';

export interface LeaveBlock {
  id: string;
  startAt: string;         // ISO datetime, inclusive
  endAt: string;           // ISO datetime, exclusive
  type: LeaveType;
  notes?: string;
}

export interface WorkingPattern {
  // Baseline admin minutes available per weekday. 0 = non-working day.
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
}

/** Per-leave-type override: any omitted field falls back to the
 *  top-level (annual/default) value field-by-field. */
export type RecoveryConfigOverride = Partial<Omit<RecoveryConfig, 'byLeaveType'>>;

export interface RecoveryConfig {
  /** Capacity multipliers for the first N working days back from leave. */
  rampMultipliers: number[];          // e.g. [0.5, 0.75, 1.0]
  /** Minutes reserved (untouchable by the planner) for admin catch-up on the same days.
   *  This is for clearing the queue of notes / correspondence that piled up. */
  recoveryReservedMin: number[];      // e.g. [60, 30, 0]
  /** Minutes reserved for triage scanning on the same days — separate from admin
   *  catch-up because it's a different task: scanning for things that escalated
   *  while away. Usually only relevant on day 1 back. */
  triageReservedMin: number[];        // e.g. [20, 0, 0]
  /** Capacity multipliers for the last N working days *before* leave, in order [day -1, day -2, ...]. */
  preLeaveWindDown: number[];         // e.g. [0.75, 0.5]
  /** Minimum total leave-day duration (calendar days) needed to apply wind-down/recovery. */
  triggerAfterDaysOff: number;        // e.g. 3
  /** Optional per-leave-type overrides. Each entry is a partial config: any
   *  field present overrides the corresponding top-level field for that type;
   *  any omitted field falls back to the top-level value. The top-level
   *  config is treated as the default ("annual") curve.
   *
   *  When a single off-stretch is fed by multiple leave types, the resolver
   *  merges the contributing per-type configs and picks the strongest value
   *  per dimension (longest ramp / wind-down arrays, max reserved minutes
   *  per index, lowest triggerAfterDaysOff). The clinician is never
   *  under-protected by booking an extra block. */
  byLeaveType?: Partial<Record<LeaveType, RecoveryConfigOverride>>;
}

export interface ProjectedArrivalConfig {
  emailsPerWeek: number;
  highPerWeek: number;
  mediumPerWeek: number;
  urgentDailyReserveMin: number;
  mediumWeeklyReserveMin: number;
}

export type DayKind =
  | 'normal'
  | 'pre_leave'
  | 'leave'
  | 'recovery'
  | 'public_holiday';

export interface DailyAvailability {
  date: string;                       // YYYY-MM-DD
  minutesAvailable: number;
  recoveryReservedMin: number;        // protected admin/catch-up slot; planner must not consume
  triageReservedMin: number;          // protected triage-scanning slot; planner must not consume
  dayKind: DayKind;
}

export interface LeaveContext {
  /** A leave block that covers day 0. */
  activeBlock?: LeaveBlock;
  /** The earliest leave block starting in days 1..(runwayDays-1). */
  upcomingBlock?: LeaveBlock;
  /** First working non-holiday day after activeBlock ends. */
  returningOn?: string;
}

export interface ResolveAvailabilityInput {
  today: string;                      // YYYY-MM-DD, becomes day 0
  workingPattern: WorkingPattern;
  leaveBlocks: LeaveBlock[];
  publicHolidays: string[];           // YYYY-MM-DD
  recoveryConfig: RecoveryConfig;
  arrivalConfig: ProjectedArrivalConfig;
  runwayDays?: number;                // default 14
}

export interface ResolveAvailabilityOutput {
  dailyAvailability: DailyAvailability[];
  effectiveArrivalConfig: ProjectedArrivalConfig;
  leaveContext: LeaveContext;
}


// ============================================================================
// Constants
// ============================================================================

const DEFAULT_RUNWAY_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
] as const;
type WeekdayKey = keyof WorkingPattern;


// ============================================================================
// Public API
// ============================================================================

export function resolveAvailability(
  input: ResolveAvailabilityInput
): ResolveAvailabilityOutput {
  const runway = input.runwayDays ?? DEFAULT_RUNWAY_DAYS;

  // 1. Seed: build the 14-day skeleton with working-pattern baseline minutes;
  //    zero out public holidays.
  const days = seedDays(input.today, runway, input.workingPattern, input.publicHolidays);

  // 2. Apply leave blocks: full-day leave zeros the day; partial-day leave
  //    halves it (the day still counts as 'leave' for UI purposes).
  applyLeaveBlocks(days, input.leaveBlocks);

  // 3. Apply pre-leave wind-down and post-leave recovery to qualifying stretches.
  applyWindDownAndRecovery(days, input);

  // 4. Finalise: minutesAvailable = baseline * the lowest collected multiplier.
  //    (Using the minimum, rather than the product, prevents stacked reductions
  //    when a day is touched by both wind-down and recovery — see notes.)
  const dailyAvailability: DailyAvailability[] = days.map(d => ({
    date: d.date,
    minutesAvailable: Math.max(
      0,
      Math.round(d.baselineMin * Math.min(1, ...d.multipliers))
    ),
    recoveryReservedMin: d.recoveryReservedMin,
    triageReservedMin: d.triageReservedMin,
    dayKind: d.dayKind,
  }));

  // 5. Scale projected arrivals to actual working days available in week 1.
  const effectiveArrivalConfig = scaleArrivalConfig(
    input.arrivalConfig,
    dailyAvailability,
    input.workingPattern
  );

  // 6. Build leave context (active/upcoming block + return date) for UI banners.
  const leaveContext = buildLeaveContext(input.leaveBlocks, dailyAvailability, input);

  return { dailyAvailability, effectiveArrivalConfig, leaveContext };
}


// ============================================================================
// Internals
// ============================================================================

interface DayInternal {
  date: string;
  baselineMin: number;
  multipliers: number[];     // collected during steps 2-3; reduced at step 4
  recoveryReservedMin: number;
  triageReservedMin: number;
  dayKind: DayKind;
}

function seedDays(
  today: string,
  runway: number,
  workingPattern: WorkingPattern,
  publicHolidays: string[]
): DayInternal[] {
  const days: DayInternal[] = [];
  for (let i = 0; i < runway; i++) {
    const date = addDays(today, i);
    const isHoliday = publicHolidays.includes(date);
    const weekday = WEEKDAYS[getWeekday(date)] as WeekdayKey;
    const baseline = isHoliday ? 0 : workingPattern[weekday];
    days.push({
      date,
      baselineMin: baseline,
      multipliers: [],
      recoveryReservedMin: 0,
      triageReservedMin: 0,
      dayKind: isHoliday ? 'public_holiday' : 'normal',
    });
  }
  return days;
}

function applyLeaveBlocks(days: DayInternal[], leaveBlocks: LeaveBlock[]): void {
  for (const block of leaveBlocks) {
    const startMs = new Date(block.startAt).getTime();
    const endMs = new Date(block.endAt).getTime();
    for (const day of days) {
      const coverage = computeLeaveCoverage(day.date, startMs, endMs);
      if (coverage === 'full') {
        day.baselineMin = 0;
        day.dayKind = 'leave';
      } else if (coverage === 'partial') {
        // Simplification: any partial-day leave halves the day. A future
        // version could compute overlap with stated work hours precisely.
        day.multipliers.push(0.5);
        day.dayKind = 'leave';
      }
    }
  }
}

function computeLeaveCoverage(
  dateIso: string,
  blockStartMs: number,
  blockEndMs: number
): 'none' | 'partial' | 'full' {
  const dayStart = new Date(dateIso + 'T00:00:00Z').getTime();
  const dayEnd = dayStart + MS_PER_DAY;
  if (blockEndMs <= dayStart || blockStartMs >= dayEnd) return 'none';
  if (blockStartMs <= dayStart && blockEndMs >= dayEnd) return 'full';
  return 'partial';
}

/** Resolve a single leave type's effective curve by overlaying its
 *  per-type override (if any) on top of the defaults field-by-field. */
function curveForType(
  base: RecoveryConfig,
  type: LeaveType
): RecoveryConfig {
  const override = base.byLeaveType?.[type];
  if (!override) return base;
  return {
    rampMultipliers: override.rampMultipliers ?? base.rampMultipliers,
    recoveryReservedMin: override.recoveryReservedMin ?? base.recoveryReservedMin,
    triageReservedMin: override.triageReservedMin ?? base.triageReservedMin,
    preLeaveWindDown: override.preLeaveWindDown ?? base.preLeaveWindDown,
    triggerAfterDaysOff: override.triggerAfterDaysOff ?? base.triggerAfterDaysOff,
  };
}

/** Combine a set of contributing-type curves into a single "strongest"
 *  curve. Strongest = clinician is best protected:
 *    - ramp / wind-down arrays: longest length wins; per index take the
 *      lowest multiplier (lower = more protective).
 *    - reserved-min arrays: longest length wins; per index take the max.
 *    - triggerAfterDaysOff: lowest wins (triggers more easily). */
function mergeCurves(curves: RecoveryConfig[]): RecoveryConfig {
  const mergeMultipliers = (key: 'rampMultipliers' | 'preLeaveWindDown'): number[] => {
    const len = Math.max(0, ...curves.map(c => c[key].length));
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      const vals = curves.map(c => c[key][i]).filter((v): v is number => typeof v === 'number');
      out.push(vals.length ? Math.min(...vals) : 1);
    }
    return out;
  };
  const mergeReserved = (key: 'recoveryReservedMin' | 'triageReservedMin'): number[] => {
    const len = Math.max(0, ...curves.map(c => c[key].length));
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      const vals = curves.map(c => c[key][i] ?? 0);
      out.push(Math.max(0, ...vals));
    }
    return out;
  };
  return {
    rampMultipliers: mergeMultipliers('rampMultipliers'),
    recoveryReservedMin: mergeReserved('recoveryReservedMin'),
    triageReservedMin: mergeReserved('triageReservedMin'),
    preLeaveWindDown: mergeMultipliers('preLeaveWindDown'),
    triggerAfterDaysOff: Math.min(...curves.map(c => c.triggerAfterDaysOff)),
  };
}

// ---- Duration-scaled recovery tiers ----------------------------------------
//
// A 3-day ramp is adequate for a short break but inadequate after 4–6 weeks
// of annual leave. These tiers stretch both the post-leave ramp and the
// pre-leave wind-down in proportion to how long the clinician was away.
//
// Ordering: tiers are applied BEFORE per-leave-type overrides so that type-
// specific behaviour (sick's empty wind-down, conference's lighter ramp) can
// still adjust the duration-scaled baseline. Highest minDays first so the
// Array.find() short-circuits at the most specific tier.
//
// The 14-day runway means any ramp longer than ~10 working days extends
// beyond what the planner can currently see — but that's fine: the reserved
// slots and reduced capacity still protect the first two weeks correctly, and
// a longer runway is a separate conversation.
const RECOVERY_TIERS: ReadonlyArray<{
  minDays: number;
  rampMultipliers: number[];
  recoveryReservedMin: number[];
  triageReservedMin: number[];
  preLeaveWindDown: number[];
}> = [
  {
    // 29+ calendar days (5+ weeks). 10 working-day ramp.
    // The clinician has been fully disconnected; the backlog is large and
    // urgent items will have escalated. 4-day wind-down so hand-over is
    // thorough. Day-1 reserved slots: 120 min admin catch-up + 60 min
    // triage — that leaves very little plannable time on day 1, intentionally.
    minDays: 29,
    rampMultipliers:     [0.25, 0.35, 0.45, 0.55, 0.65, 0.73, 0.82, 0.90, 0.96, 1.00],
    recoveryReservedMin: [120,   90,   75,   60,   45,   30,   20,   10,    0,    0],
    triageReservedMin:   [ 60,   45,   30,   20,   10,    0,    0,    0,    0,    0],
    preLeaveWindDown:    [0.80, 0.65, 0.55, 0.45],
  },
  {
    // 15–28 calendar days (2–4 weeks). 8 working-day ramp.
    // Significant backlog; some patients will have needed cover decisions.
    // Same 4-day wind-down — anything over 2 weeks warrants a proper hand-over.
    minDays: 15,
    rampMultipliers:     [0.30, 0.42, 0.54, 0.66, 0.78, 0.88, 0.95, 1.00],
    recoveryReservedMin: [120,   90,   75,   60,   45,   30,    0,    0],
    triageReservedMin:   [ 45,   30,   20,   10,    0,    0,    0,    0],
    preLeaveWindDown:    [0.80, 0.65, 0.55, 0.45],
  },
  {
    // 8–14 calendar days (1–2 weeks). 5 working-day ramp.
    // Moderate backlog; 3-day wind-down to brief whoever covers.
    minDays: 8,
    rampMultipliers:     [0.40, 0.55, 0.70, 0.85, 1.00],
    recoveryReservedMin: [ 90,   60,   45,   20,    0],
    triageReservedMin:   [ 30,   15,    0,    0,    0],
    preLeaveWindDown:    [0.80, 0.65, 0.50],
  },
  // < 8 days: base config applies unchanged (the existing 3-day defaults).
];

/** Overlay duration-appropriate ramp/reserved/wind-down arrays onto the
 *  base config. byLeaveType and triggerAfterDaysOff are preserved via
 *  spread so per-leave-type overrides still apply on top of this result. */
function scaleCurveForDuration(base: RecoveryConfig, leaveDays: number): RecoveryConfig {
  const tier = RECOVERY_TIERS.find(t => leaveDays >= t.minDays);
  if (!tier) return base; // < 8 days: existing defaults are appropriate
  return {
    ...base,                               // keeps byLeaveType, triggerAfterDaysOff
    rampMultipliers:     tier.rampMultipliers,
    recoveryReservedMin: tier.recoveryReservedMin,
    triageReservedMin:   tier.triageReservedMin,
    preLeaveWindDown:    tier.preLeaveWindDown,
  };
}

function applyWindDownAndRecovery(
  days: DayInternal[],
  input: ResolveAvailabilityInput
): void {
  const { recoveryConfig, leaveBlocks } = input;

  // A day is "off" if its baseline minutes are zero (full-day leave, holiday,
  // or non-working weekday). Partial-day leave still has minutes, so it does
  // not count as off for stretch-finding.
  const isOff = (i: number): boolean =>
    i >= 0 && i < days.length && days[i].baselineMin === 0;

  let i = 0;
  while (i < days.length) {
    if (!isOff(i)) { i++; continue; }

    // Walk to the end of this maximal off-stretch.
    let j = i;
    while (j + 1 < days.length && isOff(j + 1)) j++;

    // Stretch only qualifies if it contains at least one actual leave day.
    // (A weekend on its own, or a public holiday on its own, does not trigger
    // recovery treatment.)
    const stretchHasLeave = days.slice(i, j + 1).some(d => d.dayKind === 'leave');

    if (stretchHasLeave) {
      // Sum the full calendar-day duration of every leave block overlapping
      // this stretch. We use the full block duration (not clipped to the
      // window) so leave extending beyond either edge still counts toward
      // the trigger threshold.
      const stretchStartMs = new Date(days[i].date + 'T00:00:00Z').getTime();
      const stretchEndMs = new Date(days[j].date + 'T00:00:00Z').getTime() + MS_PER_DAY;

      // Gather the leave types that contribute to this stretch — each
      // brings its own per-type curve override (sick skips wind-down,
      // conference/PD use a lighter ramp, etc). We accumulate one
      // curve per *type* (not per block) so two annual blocks that
      // touch the same stretch don't double-count.
      const contributingTypes = new Set<LeaveType>();
      const intervals: Array<[number, number]> = [];
      for (const block of leaveBlocks) {
        const bs = new Date(block.startAt).getTime();
        const be = new Date(block.endAt).getTime();
        if (bs < stretchEndMs && be > stretchStartMs) {
          intervals.push([bs, be]);
          contributingTypes.add(block.type);
        }
      }
      // Union overlapping intervals before counting leave days so that two
      // blocks covering identical (or overlapping) dates count as one
      // duration, not two — otherwise the tier threshold can be wrongly
      // crossed (e.g. annual + conference on the same week = 12 days instead
      // of 6, spuriously activating the 8-day tier).
      intervals.sort((a, b) => a[0] - b[0]);
      let leaveDays = 0;
      if (intervals.length > 0) {
        let [mergeStart, mergeEnd] = intervals[0];
        for (let ii = 1; ii < intervals.length; ii++) {
          const [s, e] = intervals[ii];
          if (s <= mergeEnd) {
            mergeEnd = Math.max(mergeEnd, e);
          } else {
            leaveDays += Math.ceil((mergeEnd - mergeStart) / MS_PER_DAY);
            mergeStart = s;
            mergeEnd = e;
          }
        }
        leaveDays += Math.ceil((mergeEnd - mergeStart) / MS_PER_DAY);
      }

      // Scale the base config to the leave duration FIRST, then apply
      // per-leave-type overrides on top. This order means:
      //   · a 6-week annual leave gets a 10-day ramp (duration tier),
      //     with no per-type override → keeps the tiered values.
      //   · a 6-week sick leave gets the same 10-day ramp for recovery
      //     but sick's preLeaveWindDown: [] override still removes
      //     wind-down (sick days aren't planned in advance).
      //   · conference/PD override rampMultipliers explicitly, so their
      //     lighter 2-day ramp wins over the duration tier — the
      //     clinician was professionally engaged throughout.
      const durationScaled = scaleCurveForDuration(recoveryConfig, leaveDays);
      const curves = Array.from(contributingTypes).map(t => curveForType(durationScaled, t));
      const stretchCurve: RecoveryConfig =
        curves.length === 0
          ? durationScaled
          : curves.length === 1
            ? curves[0]
            : mergeCurves(curves);

      if (leaveDays >= stretchCurve.triggerAfterDaysOff) {
        // Wind-down: walk backwards from i, applying preLeaveWindDown
        // multipliers to each working day found (skip non-working days
        // like weekends entirely). When the curve has an empty wind-down
        // array (sick, conference, PD) this loop runs zero iterations
        // and no pre_leave days are marked.
        let steps = 0;
        for (let k = i - 1; k >= 0 && steps < stretchCurve.preLeaveWindDown.length; k--) {
          if (days[k].baselineMin === 0) continue;
          days[k].multipliers.push(stretchCurve.preLeaveWindDown[steps]);
          // Recovery takes precedence over pre_leave for dayKind, since
          // recovery's reservedMin block is the more important UI signal.
          if (days[k].dayKind !== 'recovery') days[k].dayKind = 'pre_leave';
          steps++;
        }

        // Recovery: walk forwards from j, applying ramp + reserved admin + triage.
        steps = 0;
        for (let k = j + 1; k < days.length && steps < stretchCurve.rampMultipliers.length; k++) {
          if (days[k].baselineMin === 0) continue;
          days[k].multipliers.push(stretchCurve.rampMultipliers[steps]);
          days[k].recoveryReservedMin = Math.max(
            days[k].recoveryReservedMin,
            stretchCurve.recoveryReservedMin[steps] ?? 0
          );
          days[k].triageReservedMin = Math.max(
            days[k].triageReservedMin,
            stretchCurve.triageReservedMin[steps] ?? 0
          );
          days[k].dayKind = 'recovery';
          steps++;
        }
      }
    }

    i = j + 1;
  }
}

function scaleArrivalConfig(
  config: ProjectedArrivalConfig,
  days: DailyAvailability[],
  workingPattern: WorkingPattern
): ProjectedArrivalConfig {
  // Compare actual vs normally-working days within the same window (days 1-6,
  // today excluded — matching the planner's "today gets no arrivals reservation"
  // invariant). Same window on both sides → ratio is 1.0 when no leave applies.
  let normallyWorking = 0;
  let actuallyWorking = 0;
  for (let i = 1; i <= 6 && i < days.length; i++) {
    const weekday = WEEKDAYS[getWeekday(days[i].date)] as WeekdayKey;
    if (workingPattern[weekday] > 0) {
      normallyWorking++;
      if (days[i].minutesAvailable > 0) actuallyWorking++;
    }
  }
  const scale = normallyWorking > 0 ? actuallyWorking / normallyWorking : 0;

  return {
    emailsPerWeek: Math.round(config.emailsPerWeek * scale),
    highPerWeek: Math.round(config.highPerWeek * scale),
    mediumPerWeek: Math.round(config.mediumPerWeek * scale),
    urgentDailyReserveMin: config.urgentDailyReserveMin,   // per-day knob, unchanged
    mediumWeeklyReserveMin: Math.round(config.mediumWeeklyReserveMin * scale),
  };
}

function buildLeaveContext(
  leaveBlocks: LeaveBlock[],
  days: DailyAvailability[],
  input: ResolveAvailabilityInput
): LeaveContext {
  const todayMs = new Date(days[0].date + 'T00:00:00Z').getTime();
  const windowEndMs = new Date(days[days.length - 1].date + 'T00:00:00Z').getTime() + MS_PER_DAY;
  const ctx: LeaveContext = {};

  // activeBlock: a block whose [startAt, endAt) range covers today.
  for (const block of leaveBlocks) {
    const bs = new Date(block.startAt).getTime();
    const be = new Date(block.endAt).getTime();
    if (bs <= todayMs && be > todayMs) {
      ctx.activeBlock = block;
      ctx.returningOn = findNextWorkingDay(block.endAt, input);
      break;
    }
  }

  // upcomingBlock: earliest block starting in days 1 .. runwayDays-1.
  const day1Ms = todayMs + MS_PER_DAY;
  let earliestStart = Infinity;
  for (const block of leaveBlocks) {
    const bs = new Date(block.startAt).getTime();
    if (bs >= day1Ms && bs < windowEndMs && bs < earliestStart) {
      ctx.upcomingBlock = block;
      earliestStart = bs;
    }
  }

  return ctx;
}

function findNextWorkingDay(
  fromIso: string,
  input: ResolveAvailabilityInput
): string | undefined {
  const fromMs = new Date(fromIso).getTime();
  const dateOnly = fromIso.slice(0, 10);
  const dateOnlyMs = new Date(dateOnly + 'T00:00:00Z').getTime();
  // If fromIso is exactly midnight UTC, the return day candidate is that date.
  // Otherwise (mid-day endAt) start searching from the next calendar day.
  let cursor = (fromMs === dateOnlyMs) ? dateOnly : addDays(dateOnly, 1);

  // 60-day cap is plenty; we mostly look ~14 days ahead in practice.
  for (let i = 0; i < 60; i++) {
    const isHoliday = input.publicHolidays.includes(cursor);
    const weekday = WEEKDAYS[getWeekday(cursor)] as WeekdayKey;
    const workingMin = input.workingPattern[weekday];

    if (!isHoliday && workingMin > 0) {
      // Also make sure cursor isn't inside another leave block.
      const cs = new Date(cursor + 'T00:00:00Z').getTime();
      const ce = cs + MS_PER_DAY;
      const inLeave = input.leaveBlocks.some(b => {
        const bs = new Date(b.startAt).getTime();
        const be = new Date(b.endAt).getTime();
        return bs < ce && be > cs;
      });
      if (!inLeave) return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  return undefined;
}


// ============================================================================
// Date utilities (UTC-anchored, no timezone drift)
// ============================================================================

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function getWeekday(isoDate: string): number {
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  return new Date(isoDate + 'T00:00:00Z').getUTCDay();
}
