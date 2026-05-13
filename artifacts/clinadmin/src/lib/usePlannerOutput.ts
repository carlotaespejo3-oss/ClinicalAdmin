import { useMemo } from 'react';
import { emails } from './data';
import type { ManualTask } from './types';
import type { WeekSetup } from '@/pages/ClinAdmin';
import { useAiClassifications } from './aiClassifyStore';
import { useLinkedDocTasks } from './linkedDocTasksStore';
import { useAcknowledgedEmails } from './acknowledgedStore';
import { useArchivedEmails } from './archivedStore';
import { useArrivalsConfig } from './arrivalsConfigStore';
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

  return useMemo(() => {
    const input = buildPlannerInput({
      today: new Date(),
      emails,
      classifications,
      manualTasks,
      linkedDocTasks,
      weekSetup,
      excludeEmailId: (id) => acknowledged.has(id) || archived.has(id),
    });
    return buildPlan({ ...input, arrivals });
  }, [classifications, linkedDocTasks, manualTasks, weekSetup, acknowledged, archived, arrivals]);
}
