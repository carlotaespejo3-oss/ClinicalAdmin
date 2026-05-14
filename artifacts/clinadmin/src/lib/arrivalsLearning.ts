import type { Email } from './types';
import { CAT } from './data';
import type { ArrivalConfig } from './planner';

export interface ObservedArrivals {
  totalEmails: number;
  weeksObserved: number;
  emailsPerWeek: number;
  highPerWeek: number;
  mediumPerWeek: number;
  lowPerWeek: number;
  avgEstMinHigh: number;
  avgEstMinMedium: number;
  avgEstMinLow: number;
}

export interface ArrivalsRecommendation {
  observed: ObservedArrivals | null;
  recommendation: ArrivalConfig | null;
  diff: {
    emailsPerWeekDelta: number;
    emailsPerWeekDeltaPct: number;
  } | null;
  confidence: 'low' | 'medium' | 'high';
  reason: string;
}

const HIGH_CATS = new Set<string>([CAT.URGENT, CAT.UNSAFE, CAT.LEGAL]);
const MEDIUM_CATS = new Set<string>([CAT.PROF, CAT.REVIEW, CAT.MEETING]);

function bandFor(e: Email): 'high' | 'medium' | 'low' {
  if (HIGH_CATS.has(e.cat) || e.risk === 'high') return 'high';
  if (MEDIUM_CATS.has(e.cat) || e.risk === 'medium') return 'medium';
  return 'low';
}

// Parse the human-readable email date strings used in seed data
// ("Today, 09:12", "Yesterday", "3 days ago", "2 weeks ago", or a real
// ISO date) into a Date. Returns null if it can't be parsed.
export function parseEmailDate(raw: string, today: Date): Date | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  if (s.startsWith('today')) return new Date(startOfToday);
  if (s.startsWith('yesterday')) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - 1);
    return d;
  }
  const daysAgo = s.match(/^(\d+)\s+days?\s+ago/);
  if (daysAgo) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - parseInt(daysAgo[1], 10));
    return d;
  }
  const weeksAgo = s.match(/^(\d+)\s+weeks?\s+ago/);
  if (weeksAgo) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - parseInt(weeksAgo[1], 10) * 7);
    return d;
  }
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t);
  return null;
}

// Pure analyzer: compute observed arrival rates over a rolling window.
// Defaults to a 28-day (4-week) window. Emails outside the window are
// ignored. If fewer than `minDays` of history are present, returns null.
export function observeArrivals(
  emails: readonly Email[],
  today: Date,
  windowDays = 28,
  minDays = 14,
): ObservedArrivals | null {
  if (emails.length === 0) return null;

  const dated: Array<{ email: Email; received: Date }> = [];
  for (const e of emails) {
    const d = parseEmailDate(e.date, today);
    if (d) dated.push({ email: e, received: d });
  }
  if (dated.length === 0) return null;

  // Normalize "now" to start-of-day so day-bucketed history (e.g. "3 days
  // ago" → midnight) and the rolling-window cutoff use the same scale.
  // Without this, the answer drifts with the wall clock during a day.
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();

  // How much history do we actually have?
  const oldest = dated.reduce((acc, x) => (x.received < acc ? x.received : acc), dated[0].received);
  const observedDays = Math.max(
    1,
    Math.round((todayMs - oldest.getTime()) / 86400000),
  );
  if (observedDays < minDays) return null;

  const cutoffMs = todayMs - windowDays * 86400000;
  const inWindow = dated.filter((x) => x.received.getTime() >= cutoffMs);
  const effectiveDays = Math.min(windowDays, observedDays);
  const weeks = effectiveDays / 7;

  let highCount = 0,
    medCount = 0,
    lowCount = 0;
  let highMin = 0,
    medMin = 0,
    lowMin = 0;
  for (const { email } of inWindow) {
    const b = bandFor(email);
    if (b === 'high') {
      highCount++;
      highMin += email.estMin;
    } else if (b === 'medium') {
      medCount++;
      medMin += email.estMin;
    } else {
      lowCount++;
      lowMin += email.estMin;
    }
  }

  return {
    totalEmails: inWindow.length,
    weeksObserved: Math.round(weeks * 10) / 10,
    emailsPerWeek: Math.round(inWindow.length / weeks),
    highPerWeek: Math.round(highCount / weeks),
    mediumPerWeek: Math.round(medCount / weeks),
    lowPerWeek: Math.round(lowCount / weeks),
    avgEstMinHigh: highCount > 0 ? Math.round(highMin / highCount) : 0,
    avgEstMinMedium: medCount > 0 ? Math.round(medMin / medCount) : 0,
    avgEstMinLow: lowCount > 0 ? Math.round(lowMin / lowCount) : 0,
  };
}

// Convert an observed reading into a recommended ArrivalConfig and
// compare it to whatever's currently configured. The recommendation
// uses observed counts × observed avg-est-min for the time reserves,
// so the planner's hypothetical-arrivals buffer matches reality.
export function recommendArrivals(
  emails: readonly Email[],
  today: Date,
  current: ArrivalConfig,
  windowDays = 28,
): ArrivalsRecommendation {
  const observed = observeArrivals(emails, today, windowDays);
  if (!observed) {
    return {
      observed: null,
      recommendation: null,
      diff: null,
      confidence: 'low',
      reason:
        'Not enough history yet. We need at least two weeks of email activity before recommending changes.',
    };
  }

  // Reserves under the new tiered model:
  //   urgent — held per admin day, sized to one urgent email's typical
  //   length (floor 10 min so the buffer is meaningful even when a
  //   clinician's urgent emails happen to be very short).
  //   medium — a single weekly block, sized to roughly two medium
  //   emails' typical length (floor 30 min for the same reason).
  const recommendation: ArrivalConfig = {
    emailsPerWeek: observed.emailsPerWeek,
    highPerWeek: observed.highPerWeek,
    mediumPerWeek: observed.mediumPerWeek,
    urgentDailyReserveMin: Math.max(10, observed.avgEstMinHigh || 10),
    mediumWeeklyReserveMin: Math.max(30, Math.round((observed.avgEstMinMedium || 0) * 2)),
  };

  const delta = observed.emailsPerWeek - current.emailsPerWeek;
  const pct = current.emailsPerWeek > 0 ? (delta / current.emailsPerWeek) * 100 : 0;

  let confidence: 'low' | 'medium' | 'high';
  if (observed.weeksObserved >= 4) confidence = 'high';
  else if (observed.weeksObserved >= 3) confidence = 'medium';
  else confidence = 'low';

  let reason: string;
  if (Math.abs(pct) < 10) {
    reason = `Your configured rate (${current.emailsPerWeek}/wk) matches what we're seeing (${observed.emailsPerWeek}/wk over ${observed.weeksObserved} weeks). No change needed.`;
  } else if (delta > 0) {
    reason = `You're actually receiving ${observed.emailsPerWeek} emails/week (last ${observed.weeksObserved} weeks), but planning for ${current.emailsPerWeek}. Consider raising the configured rate so the planner reserves enough time for arrivals.`;
  } else {
    reason = `You're receiving fewer emails than configured (${observed.emailsPerWeek}/wk vs ${current.emailsPerWeek}/wk over ${observed.weeksObserved} weeks). Consider lowering the configured rate so existing work isn't crowded out by an oversized arrivals buffer.`;
  }

  return {
    observed,
    recommendation,
    diff: { emailsPerWeekDelta: delta, emailsPerWeekDeltaPct: Math.round(pct) },
    confidence,
    reason,
  };
}
