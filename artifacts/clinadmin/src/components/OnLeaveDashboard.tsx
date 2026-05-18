import { type LeaveBlock } from '@/lib/leaveBlocksStore';
import { onLeaveHeadlineFor, onLeaveTypeLabel, formatBackDay } from '@/lib/leaveCopy';

interface Props {
  block: LeaveBlock;
  dayBackKey: string | null;
}

// Friendly empty state shown on the dashboard when the clinician is on
// leave today. Replaces the normal dashboard body (banners, weekly
// handled card, today's plan, my tasks, week ahead) with a single
// calm panel. No counts, no buttons — the point is to get out of the
// way and let them enjoy their day off.
export default function OnLeaveDashboard({ block, dayBackKey }: Props) {
  const headline = onLeaveHeadlineFor(block.leaveType);
  const typeLabel = onLeaveTypeLabel(block.leaveType);

  return (
    <div
      className="rounded-2xl border border-sky-200 bg-gradient-to-b from-sky-50 to-white px-8 py-12 flex flex-col items-center text-center"
      data-testid="on-leave-dashboard"
      role="status"
      aria-label={`On ${typeLabel.toLowerCase()} today`}
    >
      <BeachIllustration />
      <p
        className="mt-6 text-[10px] font-bold tracking-widest uppercase text-sky-700"
        data-testid="on-leave-type-label"
      >
        {typeLabel}
      </p>
      <h2
        className="mt-2 text-2xl sm:text-3xl font-semibold text-foreground max-w-xl leading-snug"
        data-testid="on-leave-headline"
      >
        {headline}
      </h2>
      {dayBackKey ? (
        <p
          className="mt-3 text-base text-muted-foreground max-w-md"
          data-testid="on-leave-back-on"
        >
          Back on <strong className="text-foreground font-semibold">{formatBackDay(dayBackKey)}</strong>.
          We&apos;ll have your inbox triaged and waiting.
        </p>
      ) : (
        <p className="mt-3 text-base text-muted-foreground max-w-md">
          We&apos;ll have your inbox triaged and waiting for when you&apos;re back.
        </p>
      )}
    </div>
  );
}

// Inline SVG — a sun over the horizon with a deckchair on a beach.
// Soft sky tones to match the leave banner palette. No external assets.
function BeachIllustration() {
  return (
    <svg
      viewBox="0 0 240 160"
      width="200"
      height="134"
      aria-hidden="true"
      className="select-none"
    >
      {/* Sky / sun glow */}
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="100%" stopColor="#fef3c7" />
        </linearGradient>
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="240" height="120" fill="url(#sky)" rx="12" />
      {/* Sun glow + sun */}
      <circle cx="170" cy="70" r="46" fill="url(#sunGlow)" />
      <circle cx="170" cy="70" r="22" fill="#fbbf24" />
      {/* Sea */}
      <path d="M0,108 Q60,100 120,108 T240,108 L240,120 L0,120 Z" fill="#bae6fd" />
      <path d="M0,114 Q60,108 120,114 T240,114 L240,120 L0,120 Z" fill="#7dd3fc" opacity="0.75" />
      {/* Sand */}
      <rect x="0" y="120" width="240" height="40" fill="#fde68a" rx="0" />
      <ellipse cx="120" cy="122" rx="240" ry="4" fill="#fcd34d" opacity="0.6" />
      {/* Deckchair */}
      <g transform="translate(46,96)">
        {/* Back */}
        <rect x="0" y="0" width="34" height="6" rx="2" fill="#0284c7" transform="rotate(-32 0 6)" />
        {/* Seat */}
        <rect x="6" y="22" width="34" height="6" rx="2" fill="#0284c7" />
        {/* Legs */}
        <line x1="8" y1="28" x2="4" y2="36" stroke="#7c5b2e" strokeWidth="2" strokeLinecap="round" />
        <line x1="38" y1="28" x2="42" y2="36" stroke="#7c5b2e" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="22" x2="2" y2="6" stroke="#7c5b2e" strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* Umbrella */}
      <g transform="translate(100,72)">
        <line x1="0" y1="0" x2="0" y2="32" stroke="#7c5b2e" strokeWidth="2" strokeLinecap="round" />
        <path d="M-26,0 Q0,-22 26,0 Z" fill="#f87171" />
        <path d="M-26,0 Q-13,-4 0,0 Q13,-4 26,0" fill="#fca5a5" />
      </g>
    </svg>
  );
}
