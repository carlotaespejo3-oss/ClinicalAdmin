// QuickSessionSummaryModal.tsx
//
// Shown when a quick session ends (naturally or manually). Summarises
// what was handled during the session — emails acknowledged/archived,
// tasks completed. Offers to permanently add this weekday to the
// clinician's schedule.

import { CheckCircle2, Mail, ListChecks, CalendarPlus, X } from 'lucide-react';
import type { ActiveSession } from '@/lib/quickSessionStore';

interface SessionResult {
  session: ActiveSession;
  actualMin: number;          // real elapsed time in minutes
  emailsHandled: number;      // new acknowledges + archives during session
  tasksCompleted: number;     // tasks that went done=true during session
}

interface Props {
  result: SessionResult;
  /** Whether this day is already in the clinician's schedule (prevents duplicate add). */
  alreadyScheduled: boolean;
  onAddToSchedule: () => void;
  onClose: () => void;
}

function fmtMins(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export default function QuickSessionSummaryModal({
  result,
  alreadyScheduled,
  onAddToSchedule,
  onClose,
}: Props) {
  const { session, actualMin, emailsHandled, tasksCompleted } = result;
  const totalHandled = emailsHandled + tasksCompleted;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Session summary"
      >
        {/* Header */}
        <div className="relative p-6 text-center border-b border-border">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 text-muted-foreground hover:text-foreground p-1 rounded"
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 size={28} className="text-green-600" />
          </div>
          <h2 className="text-base font-bold text-foreground">Session complete</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {fmtMins(actualMin)} on {session.dayAbbr}
          </p>
        </div>

        {/* Stats */}
        <div className="p-5 space-y-3">
          {totalHandled === 0 ? (
            <div className="text-center py-2">
              <p className="text-sm text-muted-foreground">
                Nothing was logged this session — but you showed up, and that counts.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
                What you got done
              </p>
              {emailsHandled > 0 && (
                <div className="flex items-center gap-3 bg-muted/30 rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Mail size={15} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {emailsHandled} email{emailsHandled !== 1 ? 's' : ''} handled
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Acknowledged or archived during this session
                    </p>
                  </div>
                </div>
              )}
              {tasksCompleted > 0 && (
                <div className="flex items-center gap-3 bg-muted/30 rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <ListChecks size={15} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {tasksCompleted} task{tasksCompleted !== 1 ? 's' : ''} completed
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Marked done during this session
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Add to schedule prompt */}
          {!alreadyScheduled && (
            <div className="mt-4 rounded-xl border border-dashed border-sky-300 bg-sky-50 px-4 py-3.5">
              <p className="text-sm font-semibold text-sky-900">
                Want to make {session.dayAbbr}s regular?
              </p>
              <p className="text-xs text-sky-700 mt-0.5 mb-3">
                Add {fmtMins(session.durationMin)} of admin time to{' '}
                {session.dayAbbr}s in your weekly schedule. The planner will
                start including it in your capacity.
              </p>
              <button
                type="button"
                onClick={onAddToSchedule}
                className="w-full flex items-center justify-center gap-2 bg-sky-600 text-white text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-sky-700 transition-colors shadow-sm"
                data-testid="button-add-day-to-schedule"
              >
                <CalendarPlus size={15} />
                Add {session.dayAbbr}s to my schedule
              </button>
            </div>
          )}
          {alreadyScheduled && (
            <p className="text-xs text-muted-foreground text-center py-1">
              {session.dayAbbr} is already in your schedule — your plan will
              include today's work automatically.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 text-sm font-semibold rounded-xl border border-border hover:bg-muted/40 transition-colors"
            data-testid="button-session-close"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
