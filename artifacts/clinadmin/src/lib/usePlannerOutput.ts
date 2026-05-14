import { useEffect, useMemo } from 'react';
import { emails } from './data';
import type { ManualTask } from './types';
import type { WeekSetup } from '@/pages/ClinAdmin';
import { useAiClassifications } from './aiClassifyStore';
import { useLinkedDocTasks } from './linkedDocTasksStore';
import { useAcknowledgedEmails } from './acknowledgedStore';
import { useArchivedEmails } from './archivedStore';
import { useArrivalsConfig } from './arrivalsConfigStore';
import {
  useDeferralHistory,
  deferralCountMap,
  recordDeferralsForWeek,
  isoMondayOf,
} from './deferralStore';
import { buildPlannerInput } from './plannerAdapter';
import { buildPlan, type PlannerOutput } from './planner';

// Shared planner subscription: both HomeTab (Today's Plan) and the Detailed
// View (Runway / Projected Workload) call this hook so they recompute from
// the same live stores. When an email is acknowledged / archived in the
// inbox, a manual task is marked done in Tasks, an AI classification
// streams in, or a linked doc task is created/completed, every consumer
// re-renders together — no stale slices, no per-tab desync.
export function usePlannerOutput(
  manualTasks: ManualTask[],
  weekSetup: WeekSetup | null,
): PlannerOutput {
  const classifications = useAiClassifications();
  const linkedDocTasks = useLinkedDocTasks();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const arrivals = useArrivalsConfig();
  const deferralHistory = useDeferralHistory();

  const weekMondayKey = isoMondayOf(new Date());

  const output = useMemo(() => {
    const input = buildPlannerInput({
      today: new Date(),
      emails,
      classifications,
      manualTasks,
      linkedDocTasks,
      weekSetup,
      excludeEmailId: (id) => acknowledged.has(id) || archived.has(id),
    });
    return buildPlan({
      ...input,
      arrivals,
      // Only counts weeks STRICTLY before this week. Records made
      // for the current week (by the effect below) are deliberately
      // ignored here — otherwise an item transiently in
      // deferredItems would show "Deferred 1×" the instant the user
      // adds capacity and it gets placed.
      deferralHistory: deferralCountMap(deferralHistory, weekMondayKey),
    });
  }, [classifications, linkedDocTasks, manualTasks, weekSetup, acknowledged, archived, arrivals, deferralHistory, weekMondayKey]);

  // Side-effect: any email the planner couldn't fit into this week's
  // runway gets recorded against this ISO week. recordDeferralsForWeek
  // is idempotent for the same (emailId, weekMonday) pair, so render
  // churn during the week never inflates counts — only crossing into
  // a new ISO week with the item still unplaced increments it AND
  // makes it visible in the planner's `deferralHistory` input.
  const deferredEmailIds = output.deferredItems
    .filter((it) => it.kind === 'email' && typeof it.refId === 'number')
    .map((it) => it.refId as number);
  const deferredKey = deferredEmailIds.join(',');
  useEffect(() => {
    if (deferredEmailIds.length === 0) return;
    recordDeferralsForWeek(deferredEmailIds, weekMondayKey);
    // deferredEmailIds is captured via deferredKey in the deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredKey, weekMondayKey]);

  return output;
}
