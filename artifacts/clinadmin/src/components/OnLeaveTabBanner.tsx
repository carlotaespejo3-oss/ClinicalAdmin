import { useMemo } from 'react';
import { Plane } from 'lucide-react';
import {
  useLeaveBlocks,
  currentLeaveStatus,
} from '@/lib/leaveBlocksStore';
import { onLeaveTypeLabel, formatBackDay } from '@/lib/leaveCopy';
import type { WeekSetup } from '@/pages/ClinAdmin';

interface Props {
  weekSetup: WeekSetup | null;
  // Distinguishes the testid so tests can target a specific tab's banner.
  surface: 'inbox' | 'calendar' | 'archive';
}

// Slim sky-toned 'you're on leave today' banner shown at the top of
// Inbox / Calendar / Archive tabs so the warmth from the Home
// dashboard's OnLeaveDashboard panel carries across the app. Unlike
// the dashboard variant this DOES NOT hide the underlying content —
// the clinician can still browse if they want. Renders nothing
// outside of the on-leave-today state. Uses the same half-day
// detection (95% threshold via workingMinutesByWeekday) as HomeTab so
// the three surfaces stay in lockstep.
export default function OnLeaveTabBanner({ weekSetup, surface }: Props) {
  const leaveBlocks = useLeaveBlocks();

  const workingMinutesByWeekday = useMemo(() => {
    if (!weekSetup || weekSetup.days.length === 0) return undefined;
    const totalMins = Math.round(weekSetup.hours * 60);
    const evenSplit = Math.round(totalMins / weekSetup.days.length);
    const m = new Map<string, number>();
    for (const day of weekSetup.days) {
      const override = weekSetup.minutesByDay?.[day];
      m.set(day, override != null ? override : evenSplit);
    }
    return m;
  }, [weekSetup]);

  const leaveStatus = useMemo(
    () => currentLeaveStatus(
      new Date(),
      leaveBlocks,
      new Set(weekSetup?.days ?? []),
      workingMinutesByWeekday,
    ),
    [leaveBlocks, weekSetup?.days, workingMinutesByWeekday],
  );

  if (leaveStatus.state !== 'on-leave-today') return null;

  const typeLabel = onLeaveTypeLabel(leaveStatus.block.leaveType);
  const dayBackKey = leaveStatus.dayBackKey;

  return (
    <div
      className="rounded-xl border border-sky-200 bg-sky-50 text-sky-900 px-5 py-3 flex items-start gap-3"
      data-testid={`${surface}-on-leave-banner`}
      role="status"
    >
      <Plane size={18} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0 text-sm leading-snug">
        <p className="font-bold">
          You&apos;re on {typeLabel.toLowerCase()} today.
        </p>
        {dayBackKey ? (
          <p className="text-xs mt-0.5">
            Back on <strong className="font-semibold">{formatBackDay(dayBackKey)}</strong>.
            Browse if you need to — nothing here is waiting on you.
          </p>
        ) : (
          <p className="text-xs mt-0.5">
            Browse if you need to — nothing here is waiting on you.
          </p>
        )}
      </div>
    </div>
  );
}
