// BacklogStrip.tsx
//
// Compact ambient reminder of pending catch-up items on the Home dashboard.
//
// Shown when:
//   · backlog.pending > 0
//   · backlog.isHydrated (avoids flash before first server response)
//   · leaveStatus.state !== 'back-today' (CatchUpPlanCard handles that state)
//
// Shows the top VISIBLE_LIMIT surfaced items from the store's drip-feed.
// Each row has inline ✓ (done) and × (dismiss) actions — the clinician
// can clear items without navigating to the full Backlog Recovery tab.
// A "See all" button navigates there for the full list + 3-week plan.

import { useState } from 'react';
import { RefreshCcw, Check, X, ChevronRight, Inbox, CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useBacklogQueue,
  markBacklogItemDone,
  dismissBacklogItem,
  surfaceMoreBacklogItems,
  type BacklogItem,
} from '@/lib/backlogQueueStore';

// ============================================================================
// Priority tier
// ============================================================================

type Tier = 'high' | 'medium' | 'low';

function scoreToTier(score: number): Tier {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

const TIER_BADGE: Record<Tier, string> = {
  high:   'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low:    'bg-slate-50 text-slate-600 border-slate-200',
};

const TIER_DOT: Record<Tier, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-400',
  low:    'bg-slate-300',
};

// ============================================================================
// Individual backlog row
// ============================================================================

function StripRow({ item }: { item: BacklogItem }) {
  const [dismissed, setDismissed] = useState(false);
  const tier = scoreToTier(item.priorityScore);
  const receivedDate = new Date(item.receivedAt);
  const daysAgo = Math.round((Date.now() - receivedDate.getTime()) / 86_400_000);
  const dateLabel =
    daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;

  if (dismissed || item.status !== 'pending') return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 group hover:bg-slate-50/60 transition-colors"
      data-testid={`backlog-strip-row-${item.id}`}
    >
      {/* Priority dot */}
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', TIER_DOT[tier])} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-snug truncate">{item.subject}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {item.senderName} · {dateLabel}
        </p>
      </div>

      {/* Tier badge — desktop only via hidden/flex trick */}
      <span
        className={cn(
          'hidden sm:inline text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0',
          TIER_BADGE[tier],
        )}
      >
        {tier}
      </span>

      {/* Actions — appear on hover for cleanliness */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          type="button"
          title="Mark as handled"
          aria-label={`Mark "${item.subject}" as handled`}
          onClick={() => markBacklogItemDone(item.id)}
          className="w-6 h-6 rounded flex items-center justify-center text-green-600 hover:bg-green-50 transition-colors"
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          title="Dismiss"
          aria-label={`Dismiss "${item.subject}"`}
          onClick={() => {
            setDismissed(true);
            dismissBacklogItem(item.id, 'manual');
          }}
          className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:bg-slate-100 hover:text-foreground transition-colors"
        >
          <X size={12} />
        </button>
        <a
          href={`https://outlook.office.com/mail/${item.outlookMessageId}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in Outlook"
          aria-label={`Open "${item.subject}" in Outlook`}
          className="w-6 h-6 rounded flex items-center justify-center text-primary hover:bg-primary/10 transition-colors"
        >
          <CornerDownRight size={11} />
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// BacklogStrip — exported component
// ============================================================================

interface Props {
  /** Navigate to the Backlog Recovery tab for the full list + plan. */
  onNavigateToBacklog: () => void;
}

export default function BacklogStrip({ onNavigateToBacklog }: Props) {
  const backlog = useBacklogQueue();

  // Nothing to show — either loading or empty.
  if (!backlog.isHydrated || backlog.pending === 0) return null;

  const { surfaced, pending, resolved, total } = backlog;
  const hasMore = pending > surfaced.length;
  const progressPct = total > 0 ? Math.round((resolved / total) * 100) : 0;

  return (
    <div
      className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white shadow-sm overflow-hidden"
      data-testid="home-backlog-strip"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-indigo-100 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <RefreshCcw size={13} className="text-indigo-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-indigo-900 leading-tight">
            Catch-up queue
            {' '}
            <span className="font-normal text-indigo-700">
              — {pending} pending{resolved > 0 ? `, ${resolved} cleared` : ''}
            </span>
          </p>
          {/* Progress bar */}
          {total > 0 && (
            <div className="mt-1 w-full bg-indigo-100 rounded-full h-1 overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onNavigateToBacklog}
          className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors flex-shrink-0"
          data-testid="backlog-strip-see-all"
        >
          See all <ChevronRight size={11} />
        </button>
      </div>

      {/* Item rows */}
      <div className="divide-y divide-border/40">
        {surfaced.length === 0 ? (
          <div className="px-4 py-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Inbox size={13} />
            <span>No items surfaced yet — go to Backlog Recovery to scan your inbox.</span>
          </div>
        ) : (
          surfaced.map((item) => <StripRow key={item.id} item={item} />)
        )}
      </div>

      {/* Footer — load more or navigate to full tab */}
      {(hasMore || surfaced.length > 0) && (
        <div className="px-4 py-2 border-t border-indigo-100 bg-indigo-50/40 flex items-center justify-between">
          {hasMore ? (
            <button
              type="button"
              onClick={surfaceMoreBacklogItems}
              className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
              data-testid="backlog-strip-load-more"
            >
              Show {Math.min(3, pending - surfaced.length)} more
            </button>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              Showing all {surfaced.length} pending item{surfaced.length !== 1 ? 's' : ''}
            </span>
          )}
          <button
            type="button"
            onClick={onNavigateToBacklog}
            className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-0.5"
          >
            Full plan <ChevronRight size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
