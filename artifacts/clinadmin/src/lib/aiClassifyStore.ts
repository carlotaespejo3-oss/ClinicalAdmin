import { useSyncExternalStore } from 'react';
import type { AiClassification } from './types';

const KEY = 'clinadmin-ai-classifications-v1';
const listeners = new Set<() => void>();
let cache: Map<number, AiClassification> | null = null;

function load(): Map<number, AiClassification> {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    const arr = raw ? (JSON.parse(raw) as AiClassification[]) : [];
    cache = new Map(arr.map((c) => [c.emailId, c]));
  } catch {
    cache = new Map();
  }
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
      };
  mutate((m) => m.set(emailId, next));
}

export function clearClassifications() {
  mutate((m) => m.clear());
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
