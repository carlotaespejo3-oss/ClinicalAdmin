import { useSyncExternalStore } from 'react';
import type { AiClassification } from './types';
import { emails } from './data';
import { estimateMinutes, PENDING_CLASSIFICATION_MIN } from './estimateMinutes';
import { ensureLinkedDocTask, removeLinkedDocTaskIfNoLongerRequired } from './linkedDocTasksStore';

const KEY = 'clinadmin-ai-classifications-v1';
const listeners = new Set<() => void>();
let cache: Map<number, AiClassification> | null = null;
let estimatesInitialised = false;

// Mutate the in-memory Email object so every consumer (InboxTab, HomeTab,
// ForecastTab, WeeklyPlan, HighRiskTab, WeeklySetupModal etc.) reads the
// rules-based estimate instead of the hand-coded seed value.
function applyEstimateToEmail(c: AiClassification | undefined, emailId: number) {
  const email = emails.find((e) => e.id === emailId);
  if (!email) return;
  email.estMin = c ? estimateMinutes(email, c) : PENDING_CLASSIFICATION_MIN;
  // Document/form detection side-effect: auto-create or remove the linked
  // task that pairs with this email. Kept here so every entry point that
  // sets a classification (initial run, re-classify, manual override) gets
  // the same behaviour.
  if (c) {
    if (c.requiresDocument) ensureLinkedDocTask(email, c);
    else removeLinkedDocTaskIfNoLongerRequired(emailId, c);
  }
}

function initialiseEmailEstimates(initial: Map<number, AiClassification>) {
  if (estimatesInitialised) return;
  estimatesInitialised = true;
  // Override every seeded estMin so the rules-based estimator is the
  // single source of truth at runtime. Also rehydrate linked doc tasks
  // from any cached classifications.
  for (const e of emails) {
    const c = initial.get(e.id);
    e.estMin = c ? estimateMinutes(e, c) : PENDING_CLASSIFICATION_MIN;
    if (c?.requiresDocument) ensureLinkedDocTask(e, c);
  }
}

function load(): Map<number, AiClassification> {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    const arr = raw ? (JSON.parse(raw) as AiClassification[]) : [];
    cache = new Map(arr.map((c) => [c.emailId, c]));
  } catch {
    cache = new Map();
  }
  initialiseEmailEstimates(cache);
  return cache;
}

function persist() {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(cache.values())));
  } catch {
    // ignore quota errors
  }
}

function mutate(fn: (m: Map<number, AiClassification>) => void) {
  const next = new Map(load());
  fn(next);
  cache = next;
  persist();
  listeners.forEach((l) => l());
}

export function setClassification(c: AiClassification) {
  mutate((m) => m.set(c.emailId, c));
  applyEstimateToEmail(c, c.emailId);
}

export function overrideCategory(emailId: number, category: AiClassification['category'], priority: AiClassification['priority']) {
  const existing = load().get(emailId);
  const next: AiClassification = existing
    ? { ...existing, category, priority, confidence: 1, reasoning: 'Manually classified by clinician.', classifiedAt: Date.now() }
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
      };
  mutate((m) => m.set(emailId, next));
  applyEstimateToEmail(next, emailId);
}

// Clinician-confirmed direction for an "unclear" document classification.
// Pressing "Yes — create a task" calls this with 'outgoing' (which flips
// requiresDocument to true and triggers ensureLinkedDocTask via the
// applyEstimateToEmail side-effect). Pressing "No — just information"
// calls this with 'incoming' (which leaves requiresDocument false and
// removes any task that was speculatively created).
export function confirmDocumentDirection(
  emailId: number,
  direction: 'outgoing' | 'incoming',
) {
  const existing = load().get(emailId);
  if (!existing) return;
  const next: AiClassification = {
    ...existing,
    documentDirection: direction,
    requiresDocument: direction === 'outgoing',
    classifiedAt: Date.now(),
  };
  mutate((m) => m.set(emailId, next));
  applyEstimateToEmail(next, emailId);
}

export function clearClassifications() {
  mutate((m) => m.clear());
  // After clearing, every email reverts to the pending estimate.
  for (const e of emails) e.estMin = PENDING_CLASSIFICATION_MIN;
}

export function getClassification(id: number): AiClassification | undefined {
  return load().get(id);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => load();
const getServerSnapshot = () => load();

export function useAiClassifications(): Map<number, AiClassification> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
