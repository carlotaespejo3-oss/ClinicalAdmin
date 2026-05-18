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

export interface RecoveryConfig {
  /** Capacity multipliers for the first N working days back from leave. */
  rampMultipliers: number[];          // e.g. [0.5, 0.75, 1.0]
  /** Minutes reserved (untouchable by the planner) for catch-up admin on the same days. */
  recoveryReservedMin: number[];      // e.g. [60, 30, 0]
  /** Capacity multipliers for the last N working days *before* leave, in order [day -1, day -2, ...]. */
  preLeaveWindDown: number[];         // e.g. [0.75, 0.5]
  /** Minimum total leave-day duration (calendar days) needed to apply wind-down/recovery. */
  triggerAfterDaysOff: number;        // e.g. 3
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
  recoveryReservedMin: number;        // protected admin slot; planner must not consume
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

      let leaveDays = 0;
      for (const block of leaveBlocks) {
        const bs = new Date(block.startAt).getTime();
        const be = new Date(block.endAt).getTime();
        if (bs < stretchEndMs && be > stretchStartMs) {
          leaveDays += Math.ceil((be - bs) / MS_PER_DAY);
        }
      }

      if (leaveDays >= recoveryConfig.triggerAfterDaysOff) {
        // Wind-down: walk backwards from i, applying preLeaveWindDown
        // multipliers to each working day found (skip non-working days
        // like weekends entirely).
        let steps = 0;
        for (let k = i - 1; k >= 0 && steps < recoveryConfig.preLeaveWindDown.length; k--) {
          if (days[k].baselineMin === 0) continue;
          days[k].multipliers.push(recoveryConfig.preLeaveWindDown[steps]);
          // Recovery takes precedence over pre_leave for dayKind, since
          // recovery's reservedMin block is the more important UI signal.
          if (days[k].dayKind !== 'recovery') days[k].dayKind = 'pre_leave';
          steps++;
        }

        // Recovery: walk forwards from j, applying ramp + reserved admin.
        steps = 0;
        for (let k = j + 1; k < days.length && steps < recoveryConfig.rampMultipliers.length; k++) {
          if (days[k].baselineMin === 0) continue;
          days[k].multipliers.push(recoveryConfig.rampMultipliers[steps]);
          days[k].recoveryReservedMin = Math.max(
            days[k].recoveryReservedMin,
            recoveryConfig.recoveryReservedMin[steps] ?? 0
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
