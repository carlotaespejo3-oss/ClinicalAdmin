import { useEffect } from 'react';
import { emails as seedEmails } from '@/lib/data';
import type { Email } from '@/lib/data';
import type { AiClassification } from '@/lib/types';
import {
  detectPotentialTasks,
  type PotentialTask,
} from '@/lib/potentialTaskDetect';
import {
  addPromptedTask,
  hasPromptedTaskForKind,
  isPromptDismissed,
  usePromptedTasksState,
  isHydrated as isPromptedHydrated,
} from '@/lib/promptedTasksStore';
import { useAiClassifications } from '@/lib/aiClassifyStore';
import { markAutoCreated } from '@/lib/autoTaskSeenStore';

// Auto-creator: turns high-confidence AI detections into prompted
// tasks WITHOUT clinician interaction.
//
// Per spec (May 2026):
//   Tier 1 (date + intent both high) → silent auto-create
//   Tier 2 (one medium, none low)    → auto-create + amber strip
//   Tier 3 (either dimension low)    → DO NOT auto-create. Ghost
//                                       row in My tasks instead.
//
// This module owns tiers 1 and 2. Tier 3 ghost rows are handled in
// TaskList.tsx (the auto-creator never touches them).
//
// Idempotency: addPromptedTask returns null when (emailId, kind) is
// already present, so re-running the effect on every classification
// change is safe. We also respect existing dismissals — if the
// clinician already said "no" to this kind on this email via the
// inbox panel, we honour that and stay quiet.

// Same skip rules as PotentialTaskPanel.shouldSkip — kept inline
// so the two can diverge if needed (e.g. auto-create might want
// to be stricter than the inbox prompts).
function shouldSkip(cls: AiClassification | undefined): boolean {
  if (!cls) return true;
  if (cls.prescriptionRequest) return false;
  if (cls.category === 'NONE') return true;
  if (cls.category === 'CPD') return true;
  if (cls.category === 'LEGAL') return true;
  if (cls.category === 'UNCLEAR') return true;
  // Document-bearing emails are handled by linkedDocTasksStore —
  // the document detector owns task creation for those, and
  // double-creating both a doc task and a prompted task for the
  // same email would clutter My tasks.
  if (cls.documentDirection !== null) return true;
  return false;
}

function priorityFromAi(p: AiClassification['priority']): 'high' | 'medium' | 'low' {
  if (p === 'URGENT') return 'high';
  if (p === 'LOW') return 'low';
  return 'medium';
}

function autoCreateFor(email: Email, cls: AiClassification, p: PotentialTask): void {
  if (p.tier === 3) return; // ghost rows only — never auto-create
  if (isPromptDismissed(email.id, p.kind)) return;
  if (hasPromptedTaskForKind(email.id, p.kind)) return;
  const created = addPromptedTask({
    emailId: email.id,
    kind: p.kind,
    title: p.suggestedTitle,
    type: p.type,
    estMin: p.defaultMin,
    priority: priorityFromAi(cls.priority),
    patientName: cls.patientName ?? null,
    dueDays: p.dueDays,
    // Three-bucket rule: never copy email body content into the
    // notes field. The detector's `evidence` snippet is a few
    // matched words ("by Friday", "give us a call"), so storing
    // *that* tiny phrase as audit context is acceptable — but we
    // keep the field blank by default to be safe.
    notes: '',
  });
  // Stamp provenance so AutoCreatedTasksStrip can tell its rows
  // apart from manually-accepted Tier 1/2 ones (which also live in
  // promptedTasksStore but should NOT get an undo strip).
  if (created) markAutoCreated(created.id);
}

// Mount once near the root of the inbox flow. Re-runs whenever the
// classification map OR the prompted-task state changes — the
// latter matters because if classifications hydrate before
// promptedTasks, the first effect run will bail on the hydration
// guard. Adding promptedState to the deps guarantees we rerun the
// moment hydration completes (the snapshot reference changes).
export function useAutoTaskCreator(): void {
  const classifications = useAiClassifications();
  const promptedState = usePromptedTasksState();

  useEffect(() => {
    // Wait until promptedTasks have hydrated from the server.
    // Without this we'd race the initial fetch and POST duplicates
    // for tasks the clinician already accepted in a previous session.
    if (!isPromptedHydrated()) return;
    for (const email of seedEmails) {
      const cls = classifications.get(email.id);
      if (shouldSkip(cls)) continue;
      const detected = detectPotentialTasks({
        from: email.from,
        subject: email.subject,
        body: email.body,
      });
      for (const p of detected) {
        autoCreateFor(email, cls!, p);
      }
    }
  }, [classifications, promptedState]);
}
