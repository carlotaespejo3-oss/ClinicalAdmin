// BreachNoticeStrip.tsx
//
// Two-tier breach notice shown on the Home tab, directly under the
// "You're currently" status banner:
//
//   Admin breaches (ADMIN / CPD / NONE) — low-priority SLA overruns.
//   Soft slate strip, dismissible, calm reassurance that the plan will
//   move them to first thing next session. No panic.
//
//   Clinical / urgent breaches (SAFEGUARDING / URGENT_CLINICAL /
//   LEGAL / CLINICAL / PROFESSIONAL) — amber strip with a compact tier
//   legend (Urgent / Clinical / Admin — low priority) and per-item
//   "Review now" / "Defer to [day]" actions. "Review" navigates to the
//   email. "Defer" records the item in manualDeferStore so the alarm is
//   suppressed for this session and the planner silently brings it back
//   at the top of the next one.
//
//   Once all clinical items are deferred the amber strip turns green.

import { useState } from 'react';
import {
  AlertTriangle,
  Eye,
  CalendarClock,
  X,
  CheckCircle2,
  Info,
} from 'lucide-react';
import type { BreachInfo } from '@/lib/planner';
import type { AiCategory } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  useDeferredEmails,
  deferEmail,
  undeferEmail,
} from '@/lib/manualDeferStore';
import { CLINICAL_CATS } from '@/lib/currentBreachStore';

// ── Tier classification ───────────────────────────────────────────────────────

type Tier = 'urgent' | 'clinical' | 'admin';

const CAT_TIER: Record<AiCategory, Tier> = {
  SAFEGUARDING:    'urgent',
  URGENT_CLINICAL: 'urgent',
  LEGAL:           'clinical',
  CLINICAL:        'clinical',
  PROFESSIONAL:    'clinical',
  ADMIN:           'admin',
  CPD:             'admin',
  NONE:            'admin',
};

const CAT_LABEL: Partial<Record<AiCategory, string>> = {
  SAFEGUARDING:    'Safeguarding',
  URGENT_CLINICAL: 'Urgent clinical',
  LEGAL:           'Legal',
  CLINICAL:        'Clinical',
  PROFESSIONAL:    'Professional',
  ADMIN:           'Admin',
  CPD:             'CPD',
  NONE:            'Admin',
};

// Pill styling per tier
const TIER_PILL: Record<Tier, { label: string; cls: string }> = {
  urgent:   { label: 'Urgent',             cls: 'bg-red-100 text-red-700 border-red-200' },
  clinical: { label: 'Clinical',           cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  admin:    { label: 'Admin — low priority', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  breaches: BreachInfo[];
  /** Label for the next admin session, e.g. "Monday", "tomorrow", "next session". */
  nextSessionLabel: string;
  /** Navigate to email in the inbox. */
  onOpenEmail: (id: number) => void;
}

// ── Helper: tier badge for a single breach item ───────────────────────────────

function TierBadge({ category }: { category: AiCategory }) {
  const tier = CAT_TIER[category] ?? 'admin';
  const { label, cls } = TIER_PILL[tier];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', cls)}>
      {label}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BreachNoticeStrip({
  breaches,
  nextSessionLabel,
  onOpenEmail,
}: Props) {
  const deferred = useDeferredEmails();
  const [adminDismissed, setAdminDismissed] = useState(false);

  const adminBreaches    = breaches.filter((b) => !CLINICAL_CATS.has(b.category));
  const clinicalBreaches = breaches.filter((b) =>  CLINICAL_CATS.has(b.category));

  const activeClinical  = clinicalBreaches.filter((b) => !deferred.has(b.itemId as number));
  const deferredClinical = clinicalBreaches.filter((b) =>  deferred.has(b.itemId as number));

  const showAdmin    = adminBreaches.length > 0 && !adminDismissed;
  const showClinical = clinicalBreaches.length > 0;

  if (!showAdmin && !showClinical) return null;

  // Which tiers are present across all clinical breaches — drives legend display
  const tiersPresent = new Set(clinicalBreaches.map((b) => CAT_TIER[b.category]));

  return (
    <div className="space-y-2" data-testid="breach-notice-strip">

      {/* ── Clinical / urgent strip ── */}
      {showClinical && (
        <div
          className={cn(
            'rounded-xl border px-4 py-3.5 space-y-3',
            activeClinical.length > 0
              ? 'border-amber-300 bg-amber-50'
              : 'border-green-200 bg-green-50',
          )}
          data-testid="breach-strip-clinical"
        >
          {/* Header row */}
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                activeClinical.length > 0 ? 'bg-amber-100' : 'bg-green-100',
              )}
            >
              {activeClinical.length > 0
                ? <AlertTriangle size={16} className="text-amber-700" />
                : <CheckCircle2 size={16} className="text-green-600" />}
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              {activeClinical.length > 0 ? (
                <>
                  <p className="text-sm font-bold text-amber-900">
                    {activeClinical.length === 1
                      ? '1 clinical email has passed its timeframe'
                      : `${activeClinical.length} clinical emails have passed their timeframe`}
                  </p>
                  <p className="text-xs text-amber-800">
                    These need your attention — review them now or I'll move
                    them to first thing {nextSessionLabel}.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-green-900">
                    All clinical emails deferred to {nextSessionLabel}
                  </p>
                  <p className="text-xs text-green-800">
                    I'll put {deferredClinical.length === 1 ? 'it' : 'them'}{' '}
                    first thing on your {nextSessionLabel} plan.
                  </p>
                </>
              )}

              {/* Tier legend — compact pill row showing which tiers are present */}
              {activeClinical.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[10px] text-amber-700 font-medium">Priority:</span>
                  {(['urgent', 'clinical', 'admin'] as Tier[])
                    .filter((t) => tiersPresent.has(t))
                    .map((t) => {
                      const { label, cls } = TIER_PILL[t];
                      return (
                        <span
                          key={t}
                          className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', cls)}
                        >
                          {label}
                        </span>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Active items */}
          {activeClinical.length > 0 && (
            <div className="space-y-2 pl-11">
              {activeClinical.map((b) => (
                <div
                  key={String(b.itemId)}
                  className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2.5"
                  data-testid={`breach-item-${b.itemId}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {b.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <TierBadge category={b.category} />
                      <span className="text-[10px] text-muted-foreground">
                        {CAT_LABEL[b.category] ?? b.category}
                      </span>
                      <span className="text-[10px] text-amber-600">
                        ·{' '}
                        {b.reason === 'already_overdue'
                          ? `${Math.abs(b.deadlineDays)} day${Math.abs(b.deadlineDays) !== 1 ? 's' : ''} overdue`
                          : 'approaching deadline'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenEmail(b.itemId as number)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary border border-primary/30 bg-white hover:bg-primary/5 px-2.5 py-1.5 rounded-lg transition-colors"
                      data-testid={`breach-review-${b.itemId}`}
                    >
                      <Eye size={11} />
                      Review now
                    </button>
                    <button
                      type="button"
                      onClick={() => deferEmail(b.itemId as number)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 border border-amber-300 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-colors"
                      data-testid={`breach-defer-${b.itemId}`}
                    >
                      <CalendarClock size={11} />
                      Defer to {nextSessionLabel}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Deferred items tally */}
          {deferredClinical.length > 0 && activeClinical.length > 0 && (
            <div className="pl-11">
              <p className="text-[11px] text-amber-700">
                {deferredClinical.length === 1
                  ? '+ 1 item already deferred to '
                  : `+ ${deferredClinical.length} items already deferred to `}
                {nextSessionLabel}.{' '}
                <button
                  type="button"
                  onClick={() => deferredClinical.forEach((b) => undeferEmail(b.itemId as number))}
                  className="underline underline-offset-2 hover:text-amber-900"
                >
                  Undo
                </button>
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Admin breach strip ── */}
      {showAdmin && (
        <div
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-start gap-3"
          data-testid="breach-strip-admin"
        >
          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Info size={14} className="text-slate-500" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-slate-800">
                {adminBreaches.length === 1
                  ? '1 admin email passed its usual timeframe'
                  : `${adminBreaches.length} admin emails passed their usual timeframe`}
              </p>
              <span className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold flex-shrink-0',
                TIER_PILL.admin.cls,
              )}>
                Admin — low priority
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {adminBreaches.length === 1 ? "It's" : "They're"} low priority —
              no need to act now. I'll move{' '}
              {adminBreaches.length === 1 ? 'it' : 'them'} to first thing{' '}
              {nextSessionLabel} automatically.
            </p>
            {adminBreaches.length <= 3 && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                {adminBreaches.map((b) => (
                  <li key={String(b.itemId)} className="truncate">
                    · {b.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAdminDismissed(true)}
            className="text-slate-400 hover:text-slate-600 p-1 rounded flex-shrink-0"
            aria-label="Dismiss"
            data-testid="breach-admin-dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
