import { useMemo, useState } from 'react';
import { HelpCircle, ArrowUpRight } from 'lucide-react';
import type { Email } from '@/lib/types';
import {
  detectPotentialTasks,
  type PotentialTask,
} from '@/lib/potentialTaskDetect';
import {
  hasPromptedTaskForKind,
  isPromptDismissed,
  usePromptedTasksState,
  isHydrated as isPromptedHydrated,
} from '@/lib/promptedTasksStore';
import ClassifyTaskModal from './ClassifyTaskModal';

interface Props {
  email: Email;
}

// "Unresolved" strip shown on the email card when the AI detected
// something but couldn't commit to a date OR an intent (Tier 3).
// The clinician taps "Classify" to open a 3-question modal that
// closes the loop in ~5 seconds.
//
// Rendering rules:
//   · only Tier-3 detections (the auto-creator handles Tier 1 / 2
//     silently or via the amber strip).
//   · skip detections the clinician has already accepted via the
//     inbox panel (hasPromptedTaskForKind) or actively dismissed
//     (isPromptDismissed) — both states mean it's no longer pending.
//
// Three-bucket rule: nothing about the email body is stored here.
// We re-derive everything on every render from the detector.
export default function UnresolvedTaskStrip({ email }: Props) {
  // Subscribe so the strip disappears the moment the clinician
  // resolves it via the modal — and so this component re-renders
  // when hydration completes (the snapshot reference flips).
  const promptedState = usePromptedTasksState();

  const [activeDetection, setActiveDetection] = useState<PotentialTask | null>(null);

  const pending = useMemo(() => {
    const detected = detectPotentialTasks({
      from: email.from,
      subject: email.subject,
      body: email.body,
    });
    return detected.filter((p) => {
      if (p.tier !== 3) return false;
      if (isPromptDismissed(email.id, p.kind)) return false;
      if (hasPromptedTaskForKind(email.id, p.kind)) return false;
      return true;
    });
    // promptedState in deps so the filter re-evaluates whenever the
    // store mutates (incl. hydration completing).
  }, [email.id, email.from, email.subject, email.body, promptedState]);

  // Don't render the strip — and therefore don't let the clinician
  // press "Classify" — until prompted-tasks have hydrated from the
  // server. Otherwise a save before hydration could create a
  // duplicate row for an (email, kind) the server already has.
  if (!isPromptedHydrated()) return null;
  if (pending.length === 0) return null;

  return (
    <>
      <div className="space-y-1.5" data-testid="unresolved-tasks-strip">
        {pending.map((p) => (
          <div
            key={p.kind}
            className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2.5 text-[13px] text-blue-900"
          >
            <HelpCircle size={16} className="text-blue-700 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold">Unresolved</span>
              {' — needs a date and action before it can be saved'}
            </div>
            <button
              type="button"
              onClick={() => setActiveDetection(p)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold border border-blue-300 bg-white text-blue-900 hover:bg-blue-100 transition-colors flex-shrink-0"
              data-testid={`unresolved-classify-${email.id}-${p.kind}`}
            >
              Classify <ArrowUpRight size={12} />
            </button>
          </div>
        ))}
      </div>
      {activeDetection && (
        <ClassifyTaskModal
          open={activeDetection !== null}
          email={email}
          detection={activeDetection}
          onClose={() => setActiveDetection(null)}
        />
      )}
    </>
  );
}
