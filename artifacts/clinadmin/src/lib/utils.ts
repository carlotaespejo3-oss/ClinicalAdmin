import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { CAT } from './data';
import type { Email, ManualTask } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fmtTime = (min: number) => {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
};

export const initials = (name: string) => {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

export const avatarColor = (name: string) => {
  const colors = ['bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-purple-100 text-purple-700', 'bg-orange-100 text-orange-700', 'bg-pink-100 text-pink-700'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export const dlLabel = (days: number | null) => {
  if (days === null) return null;
  if (days <= 2) return 'URGENT';
  if (days <= 5) return 'DUE SOON';
  return null;
};

export const dlClass = (days: number | null) => {
  if (days === null) return '';
  if (days <= 2) return 'bg-red-50 text-red-700 border-red-100';
  if (days <= 5) return 'bg-orange-50 text-orange-700 border-orange-100';
  return 'bg-gray-50 text-gray-700 border-gray-100';
};

export const dlText = (days: number | null) => {
  if (days === null) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
};

export const catBadge = (cat: string) => {
  switch (cat) {
    case CAT.URGENT: return 'bg-red-100 text-red-800';
    case CAT.UNSAFE: return 'bg-purple-100 text-purple-800';
    case CAT.PROF: return 'bg-blue-100 text-blue-800';
    case CAT.REVIEW: return 'bg-amber-100 text-amber-800';
    case CAT.MEETING: return 'bg-indigo-100 text-indigo-800';
    case CAT.ADMIN: return 'bg-gray-100 text-gray-800';
    case CAT.LEGAL: return 'bg-slate-100 text-slate-800';
    default: return 'bg-gray-50 text-gray-600';
  }
};

export const riskDot = (risk: string) => {
  switch (risk) {
    case 'high': return 'bg-red-500';
    case 'medium': return 'bg-orange-400';
    case 'low': return 'bg-blue-400';
    default: return 'bg-gray-200';
  }
};

export const dotColor = (risk: string) => {
  switch (risk) {
    case 'high': return '#EF4444';
    case 'medium': return '#FB923C';
    case 'low': return '#60A5FA';
    default: return '#E5E7EB';
  }
};

// ---- Priority + "Why" helpers (shared by Home dashboard and Inbox) ----
// Keeps user-facing labels consistent across the app: a single Priority pill
// (High / Medium / Low) plus a plain-English reason driven by the underlying data.

export type Priority = 'High' | 'Medium' | 'Low';

export const PRIORITY_PILL: Record<Priority, string> = {
  High: 'text-red-700 bg-red-50 border-red-200',
  Medium: 'text-amber-700 bg-amber-50 border-amber-200',
  Low: 'text-slate-600 bg-slate-50 border-slate-200',
};

export const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

export function getEmailPriority(e: Email): Priority {
  if (e.cat === CAT.UNSAFE || e.risk === 'high') return 'High';
  if (e.risk === 'medium') return 'Medium';
  return 'Low';
}

export function getTaskPriority(t: ManualTask): Priority {
  if (t.risk === 'high') return 'High';
  if (t.risk === 'medium') return 'Medium';
  return 'Low';
}

export function getEmailWhy(e: Email): string {
  if (e.cat === CAT.UNSAFE) return 'High clinical risk — needs clinical assessment, not an email reply.';
  if (e.risk === 'high') return 'High clinical risk.';
  if (e.deadline !== null && e.deadline <= 1) return e.deadline === 0 ? 'Due today.' : 'Due tomorrow.';
  if (e.deadline !== null && e.deadline <= 3) return `Due in ${e.deadline} days.`;
  if (e.isMeeting) return 'Meeting deadline approaching.';
  if (e.isProfessional) return 'Colleague waiting on your reply.';
  if (e.deadline !== null && e.deadline >= 10 && e.deadline <= 14) return 'Close to 14-day timeframe.';
  if (e.kind === 'script') return 'Script request.';
  if (e.kind === 'complex') return 'Complex case — multi-step.';
  return 'Routine review.';
}

export function getTaskWhy(t: ManualTask): string {
  if (t.risk === 'high') return 'High clinical risk.';
  if (t.deadline <= 1) return t.deadline === 0 ? 'Due today.' : 'Due tomorrow.';
  if (t.deadline <= 3) return `Due in ${t.deadline} days.`;
  if (t.deadline >= 10 && t.deadline <= 14) return 'Close to 14-day timeframe.';
  return `Due in ${t.deadline} days.`;
}
