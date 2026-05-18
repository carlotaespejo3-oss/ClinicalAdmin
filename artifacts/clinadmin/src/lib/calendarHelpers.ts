// Shared date + tone helpers used by both the full Calendar tab and the
// mini workload calendar on Home. Kept in one place so the colour
// mapping stays consistent across views.

import type { AiCategory } from './types';
import type { DailyPlan, DayStatus } from './planner';

export const CATEGORY_TONE: Record<AiCategory, { dot: string; chipBg: string; chipText: string; chipBorder: string }> = {
  SAFEGUARDING:    { dot: 'bg-red-500',     chipBg: 'bg-red-50',     chipText: 'text-red-800',     chipBorder: 'border-red-200' },
  URGENT_CLINICAL: { dot: 'bg-rose-500',    chipBg: 'bg-rose-50',    chipText: 'text-rose-800',    chipBorder: 'border-rose-200' },
  CLINICAL:        { dot: 'bg-amber-500',   chipBg: 'bg-amber-50',   chipText: 'text-amber-800',   chipBorder: 'border-amber-200' },
  PROFESSIONAL:    { dot: 'bg-purple-500',  chipBg: 'bg-purple-50',  chipText: 'text-purple-800',  chipBorder: 'border-purple-200' },
  ADMIN:           { dot: 'bg-blue-500',    chipBg: 'bg-blue-50',    chipText: 'text-blue-800',    chipBorder: 'border-blue-200' },
  LEGAL:           { dot: 'bg-slate-700',   chipBg: 'bg-slate-100',  chipText: 'text-slate-800',   chipBorder: 'border-slate-300' },
  CPD:             { dot: 'bg-emerald-500', chipBg: 'bg-emerald-50', chipText: 'text-emerald-800', chipBorder: 'border-emerald-200' },
  NONE:            { dot: 'bg-slate-400',   chipBg: 'bg-slate-50',   chipText: 'text-slate-700',   chipBorder: 'border-slate-200' },
  UNCLEAR:         { dot: 'bg-zinc-400',    chipBg: 'bg-zinc-50',    chipText: 'text-zinc-700',    chipBorder: 'border-zinc-200' },
};

export const STATUS_TONE: Record<DayStatus, { ring: string; pillBg: string; pillText: string; label: string }> = {
  safe:   { ring: 'ring-green-200',  pillBg: 'bg-green-100',  pillText: 'text-green-800',  label: 'On track' },
  tight:  { ring: 'ring-amber-200',  pillBg: 'bg-amber-100',  pillText: 'text-amber-800',  label: 'Tight' },
  breach: { ring: 'ring-red-300',    pillBg: 'bg-red-100',    pillText: 'text-red-800',    label: 'Overloaded' },
  idle:   { ring: 'ring-slate-200',  pillBg: 'bg-slate-100',  pillText: 'text-slate-600',  label: 'No admin time' },
};

export function fmtMin(m: number): string {
  if (m <= 0) return '—';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function addDays(d: Date, n: number): Date {
  const c = startOfDay(d);
  c.setDate(c.getDate() + n);
  return c;
}

// Local-timezone YYYY-MM-DD key, matching the format produced by
// `buildAvailability` in planner.ts. Using toISOString() here would
// shift the date in any positive timezone (e.g. BST), so calendar
// cells would silently look up the wrong day's plan.
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Build a Map<YYYY-MM-DD, DailyPlan> from runway so callers can look
// up planned days by date without depending on dayIndex order.
export function indexRunway(runway: DailyPlan[]): Map<string, DailyPlan> {
  const m = new Map<string, DailyPlan>();
  for (const day of runway) {
    const key = day.date.slice(0, 10);
    m.set(key, day);
  }
  return m;
}
