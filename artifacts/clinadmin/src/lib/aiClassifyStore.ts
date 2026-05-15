import { useSyncExternalStore } from 'react';
import {
  listAiClassifications,
  upsertAiClassification,
} from '@workspace/api-client-react';
import type { AiClassification, AiCategory, AiPriority } from './types';
import { emails } from './data';
import { estimateMinutes, PENDING_CLASSIFICATION_MIN } from './estimateMinutes';
import { ensureLinkedDocTask, removeLinkedDocTaskIfNoLongerRequired } from './linkedDocTasksStore';
import type { PrescriptionRequest } from './prescriptionDetect';

// AI classification per inbox email — the clinician's
// organisational layer over Outlook (category, priority, detector
// outputs, decision metadata). NOT email content; subject and body
// stay in Outlook and are fetched live at display time.
//
// PERSISTENCE: was localStorage, now Postgres via /api/ai-classifications.
// Same hydrate-once + fire-and-forget model as
// promptedTasksStore / acknowledgedStore. Composite PK
// (clinicianId, outlookEmailId) — multi-clinician ready.
//
// Side-effects on every mutation (kept verbatim from the
// localStorage version so behaviour is unchanged):
//   - applyEstimateToEmail: re-runs estimateMinutes and writes to
//     the in-memory Email object so all consumers (Inbox, Home,
//     Forecast, WeeklyPlan, HighRisk, WeeklySetupModal) see the
//     rules-based estimate, not the seed value.
//   - ensureLinkedDocTask / removeLinkedDocTaskIfNoLongerRequired:
//     auto-create or remove the paired document task.
//
// Hydration also runs initialiseEmailEstimates() once after the
// first server response so estimates and linked tasks are correct
// even if the user lands on Forecast/HighRisk before Inbox.

const listeners = new Set<() => void>();
let cache: Map<number, AiClassification> = new Map();
let hydrationStarted = false;
let hydrationDone = false;
let estimatesInitialised = false;

function emit() {
  cache = new Map(cache);
  listeners.forEach((l) => l());
}

function applyEstimateToEmail(c: AiClassification | undefined, emailId: number) {
  const email = emails.find((e) => e.id === emailId);
  if (!email) return;
  email.estMin = c ? estimateMinutes(email, c) : PENDING_CLASSIFICATION_MIN;
  if (c) {
    if (c.requiresDocument) ensureLinkedDocTask(email, c);
    else removeLinkedDocTaskIfNoLongerRequired(emailId, c);
  }
}

function initialiseEmailEstimates(initial: Map<number, AiClassification>) {
  if (estimatesInitialised) return;
  estimatesInitialised = true;
  for (const e of emails) {
    const c = initial.get(e.id);
    e.estMin = c ? estimateMinutes(e, c) : PENDING_CLASSIFICATION_MIN;
    if (c?.requiresDocument) ensureLinkedDocTask(e, c);
  }
}

// Map a server row into the local AiClassification shape. The
// server keeps prescriptionRequest as JSONB passthrough, so we
// trust its structure here (the type is stable across both sides).
type ServerRow = Awaited<ReturnType<typeof listAiClassifications>>[number];
function rowToClassification(r: ServerRow): AiClassification | null {
  const emailId = Number(r.outlookEmailId);
  if (!Number.isFinite(emailId)) return null;
  return {
    emailId,
    category: r.category as AiCategory,
    priority: r.priority as AiPriority,
    confidence: r.confidence,
    reasoning: r.reasoning,
    classifiedAt: new Date(r.classifiedAt).getTime(),
    professionalSubType: r.professionalSubType ?? null,
    patientName: r.patientName ?? null,
    documentRequested: r.documentRequested ?? null,
    eventDate: r.eventDate ?? null,
    registrationDeadline: r.registrationDeadline ?? null,
    documentDirection: r.documentDirection ?? null,
    requiresDocument: r.requiresDocument,
    documentType: r.documentType ?? null,
    documentDueDays: r.documentDueDays ?? null,
    prescriptionRequest:
      (r.prescriptionRequest as PrescriptionRequest | null | undefined) ?? null,
    complexity: (r.complexity as AiClassification['complexity']) ?? null,
    complexityReasons: r.complexityReasons ?? [],
  };
}

function classificationToBody(c: AiClassification) {
  return {
    outlookEmailId: String(c.emailId),
    category: c.category,
    priority: c.priority,
    confidence: c.confidence,
    reasoning: c.reasoning,
    classifiedAt: new Date(c.classifiedAt).toISOString(),
    professionalSubType: c.professionalSubType,
    patientName: c.patientName,
    documentRequested: c.documentRequested,
    eventDate: c.eventDate,
    registrationDeadline: c.registrationDeadline,
    documentDirection: c.documentDirection,
    requiresDocument: c.requiresDocument,
    documentType: c.documentType,
    documentDueDays: c.documentDueDays,
    prescriptionRequest: c.prescriptionRequest,
    complexity: c.complexity,
    complexityReasons: c.complexityReasons,
  };
}

function persist(c: AiClassification) {
  // Fire-and-forget; the server upsert is idempotent on
  // (clinicianId, outlookEmailId).
  upsertAiClassification(classificationToBody(c)).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[aiClassifyStore] failed to persist classification', err);
  });
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const rows = await listAiClassifications();
    // Merge: keep any locally-set classifications (added before
    // hydration finished) and back-fill from the server only where
    // we don't already have a value.
    for (const r of rows) {
      const c = rowToClassification(r);
      if (!c) continue;
      if (cache.has(c.emailId)) continue;
      cache.set(c.emailId, c);
    }
    hydrationDone = true;
    initialiseEmailEstimates(cache);
    // Apply estimates for any classifications that arrived from the
    // server (initialiseEmailEstimates sets PENDING for all emails
    // first; then we re-apply for those we just hydrated so linked
    // doc tasks get created from server state).
    for (const c of cache.values()) applyEstimateToEmail(c, c.emailId);
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[aiClassifyStore] failed to hydrate from server', err);
    hydrationDone = true;
    initialiseEmailEstimates(cache);
  }
}

export function setClassification(c: AiClassification) {
  cache.set(c.emailId, c);
  emit();
  applyEstimateToEmail(c, c.emailId);
  persist(c);
}

export function overrideCategory(
  emailId: number,
  category: AiClassification['category'],
  priority: AiClassification['priority'],
) {
  const existing = cache.get(emailId);
  const next: AiClassification = existing
    ? {
        ...existing,
        category,
        priority,
        confidence: 1,
        reasoning: 'Manually classified by clinician.',
        classifiedAt: Date.now(),
      }
    : {
        emailId,
        category,
        priority,
        confidence: 1,
        reasoning: 'Manually classified by clinician.',
        classifiedAt: Date.now(),
        professionalSubType: null,
        patientName: null,
        documentRequested: null,
        eventDate: null,
        registrationDeadline: null,
        documentDirection: null,
        requiresDocument: false,
        documentType: null,
        documentDueDays: null,
        prescriptionRequest: null,
        complexity: null,
        complexityReasons: [],
      };
  cache.set(emailId, next);
  emit();
  applyEstimateToEmail(next, emailId);
  persist(next);
}

// Clinician-confirmed direction for an "unclear" document
// classification. See store header for the two cases.
export function confirmDocumentDirection(
  emailId: number,
  direction: 'outgoing' | 'incoming',
) {
  const existing = cache.get(emailId);
  if (!existing) return;
  const next: AiClassification = {
    ...existing,
    documentDirection: direction,
    requiresDocument: direction === 'outgoing',
    classifiedAt: Date.now(),
  };
  cache.set(emailId, next);
  emit();
  applyEstimateToEmail(next, emailId);
  persist(next);
}

// Test-only / dev-only: wipe local cache. Does NOT touch the
// server. (Same scope as the original localStorage helper —
// only the store's own module exports it; no UI calls it.)
export function clearClassifications() {
  cache = new Map();
  hydrationStarted = false;
  hydrationDone = false;
  estimatesInitialised = false;
  for (const e of emails) e.estMin = PENDING_CLASSIFICATION_MIN;
  listeners.forEach((l) => l());
}

export function getClassification(id: number): AiClassification | undefined {
  return cache.get(id);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) {
    void hydrate();
  }
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;
const getServerSnapshot = () => cache;

export function useAiClassifications(): Map<number, AiClassification> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function isHydrated(): boolean {
  return hydrationDone;
}
