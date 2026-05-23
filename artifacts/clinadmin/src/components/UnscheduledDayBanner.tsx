// UnscheduledDayBanner.tsx
//
// Shown on the Home tab when the clinician opens the app on a weekday
// that isn't in their regular schedule and there's no active session.
// Offers a single CTA to start a quick session.

import { CalendarOff, Timer } from 'lucide-react';

interface Props {
  dayAbbr: string;        // e.g. 'Tuesday'
  onStartSession: () => void;
}

export default function UnscheduledDayBanner({ dayAbbr, onStartSession }: Props) {
  return (
    <div
      className="rounded-xl border border-dashed border-sky-300 bg-sky-50/60 px-5 py-4 flex items-start gap-4"
      data-testid="unscheduled-day-banner"
    >
      {/* Icon */}
      <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <CalendarOff size={20} className="text-sky-600" />
      </div>

      {/* Copy */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-sky-900">
          {dayAbbr} isn't in your schedule — but you're here
        </p>
        <p className="text-sm text-sky-800 mt-0.5">
          You don't have anything planned for today. Let me know how long you
          have and I'll help you make the most of it.
        </p>
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={onStartSession}
        className="flex items-center gap-2 bg-sky-600 text-white text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-sky-700 transition-colors flex-shrink-0 shadow-sm"
        data-testid="button-start-quick-session"
      >
        <Timer size={15} />
        Schedule a quick session
      </button>
    </div>
  );
}
