import { LEAVE_TYPE_LABEL, type LeaveBlock } from '@/lib/leaveBlocksStore';

// Shared copy + formatting helpers for the 'on leave' surfaces
// (OnLeaveDashboard on Home and the slim OnLeaveTabBanner on
// Inbox/Calendar/Archive). Keeping these in one place so wording or
// date formatting changes touch every surface at once.

export const ON_LEAVE_HEADLINES: Record<LeaveBlock['leaveType'], string> = {
  annual: "You're on annual leave — the planner's taking the day off too.",
  sick: "You're on sick leave — rest up. The planner's paused for today.",
  conference: "You're at a conference today — the planner's stepped back.",
  pd: "You're on professional development today — the planner's stepped back.",
  unpaid: "You're on unpaid leave — the planner's paused for today.",
};

export function onLeaveHeadlineFor(leaveType: LeaveBlock['leaveType']): string {
  return ON_LEAVE_HEADLINES[leaveType] ?? ON_LEAVE_HEADLINES.annual;
}

export function onLeaveTypeLabel(leaveType: LeaveBlock['leaveType']): string {
  return LEAVE_TYPE_LABEL[leaveType];
}

// 'YYYY-MM-DD' (local) → 'Monday, 25 May'. Returns the input
// unchanged if the key doesn't match the expected shape.
export function formatBackDay(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
