// BreachNoticeStrip.tsx
//
// Two-tier breach notice shown on the Home tab:
//
//   Admin breaches (ADMIN / CPD / NONE) — these are low-priority
//   SLA overruns. Shown as a soft slate strip with a calm reassurance
//   that the plan will move them to first thing next session. The
//   clinician can dismiss it for the rest of the session. No panic.
//
//   Clinical / urgent breaches (SAFEGUARDING / URGENT_CLINICAL /
//   LEGAL / CLINICAL / PROFESSIONAL) — shown as an amber strip with
//   per-item "Review now" and "Defer to next session" actions. "Review"
//   navigates straight to the email. "Defer" records the item in
//   manualDeferStore so the red alarm is suppressed for this session
//   and the planner silently brings it back at the top of the next one.
//
//   Once all clinical items are deferred, the amber strip closes and
//   the beforeunload guard also disarms.

import { useState } from 'react';
import {
  AlertTriangle,
  Mail,
  Eye,
  CalendarClock,
  X,
  CheckCircle2,
  ShieldAlert,
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

// Human-readable category label for breach messages
const CAT_LABEL: Partial<Record<AiCategory, string>> = {
  SAFEGUARDING: 'safeguarding',
  URGENT_CLINICAL: 'urgent clinical',
  LEGAL: 'legal',
  CLINICAL: 'clinical',
  PROFESSIONAL: 'professional',
  ADMIN: 'admin',
  CPD: 'CPD',
  NONE: 'admin',
};

interface Props {
  breaches: BreachInfo[];
  /** Label for the next admin session, e.g. "Monday" or "Tomorrow". */
  nextSessionLabel: string;
  /** Navigate to email in the inbox. */
  onOpenEmail: (id: number) => void;
}

export default function BreachNoticeStrip({
  breaches,
  nextSessionLabel,
  onOpenEmail,
}: Props) {
  const deferred = useDeferredEmails();
  const [adminDismissed, setAdminDismissed] = useState(false);

  const adminBreaches = breaches.filter((b) => !CLINICAL_CATS.has(b.category));
  const clinicalBreaches = breaches.filter((b) => CLINICAL_CATS.has(b.category));

  // Split clinical into active (still needs attention) and deferred.
  const activeClinical = clinicalBreaches.filter(
    (b) => !deferred.has(b.itemId as number),
  );
  const deferredClinical = clinicalBreaches.filter((b) =>
    deferred.has(b.itemId as number),
  );

  const showAdmin = adminBreaches.length > 0 && !adminDismissed;
  const showClinical = clinicalBreaches.length > 0;

  if (!showAdmin && !showClinical) return null;

  return (
    <div className="space-y-2" data-testid="breach-notice-strip">

      {/* ---- Clinical / urgent breach strip ---- */}
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
          {/* Header */}
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                activeClinical.length > 0 ? 'bg-amber-100' : 'bg-green-100',
              )}
            >
              {activeClinical.length > 0 ? (
                <AlertTriangle
                  size={16}
                  className="text-amber-700"
                />
              ) : (
                <CheckCircle2 size={16} className="text-green-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {activeClinical.length > 0 ? (
                <>
                  <p className="text-sm font-bold text-amber-900">
                    {activeClinical.length === 1
                      ? '1 clinical email has passed its timeframe'
                      : `${activeClinical.length} clinical emails have passed their timeframe`}
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    These need your attention. Review them now or I'll move
                    them to the very top of your {nextSessionLabel} session.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-green-900">
                    All clinical emails deferred to {nextSessionLabel}
                  </p>
                  <p className="text-xs text-green-800 mt-0.5">
                    I'll put {deferredClinical.length === 1 ? 'it' : 'them'}{' '}
                    first thing on your {nextSessionLabel} plan.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Active items — Review / Defer per item */}
          {activeClinical.length > 0 && (
            <div className="space-y-2 pl-11">
              {activeClinical.map((b) => (
                <div
                  key={String(b.itemId)}
                  className="flex items-start gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2.5"
                  data-testid={`breach-item-${b.itemId}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {b.title}
                    </p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      {CAT_LABEL[b.category] ?? b.category} ·{' '}
                      {b.reason === 'already_overdue'
                        ? `${Math.abs(b.deadlineDays)} day${Math.abs(b.deadlineDays) !== 1 ? 's' : ''} overdue`
                        : 'approaching SLA'}
                    </p>
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

          {/* Deferred items summary (collapsed, shows they're handled) */}
          {deferredClinical.length > 0 && activeClinical.length > 0 && (
            <div className="pl-11">
              <p className="text-[11px] text-amber-700">
                {deferredClinical.length === 1
                  ? '+ 1 item already deferred to '
                  : `+ ${deferredClinical.length} items already deferred to `}
                {nextSessionLabel}.{' '}
                <button
                  type="button"
                  onClick={() =>
                    deferredClinical.forEach((b) =>
                      undeferEmail(b.itemId as number),
                    )
                  }
                  className="underline underline-offset-2 hover:text-amber-900"
                >
                  Undo
                </button>
              </p>
            </div>
          )}
        </div>
      )}

      {/* ---- Admin breach strip ---- */}
      {showAdmin && (
        <div
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-start gap-3"
          data-testid="breach-strip-admin"
        >
          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Info size={14} className="text-slate-500" />
          </div>
          <div className="flex-1 min-w-0 text-xs text-slate-700 space-y-0.5">
            <p className="font-semibold text-slate-800">
              {adminBreaches.length === 1
                ? '1 admin email passed its usual timeframe'
                : `${adminBreaches.length} admin emails passed their usual timeframe`}
            </p>
            <p>
              {adminBreaches.length === 1 ? "It's" : "They're"} low priority —
              no need to act now. I'll move{' '}
              {adminBreaches.length === 1 ? 'it' : 'them'} to the top of your{' '}
              {nextSessionLabel} session automatically.
            </p>
            {adminBreaches.length <= 3 && (
              <ul className="mt-1 space-y-0.5 text-slate-500">
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
