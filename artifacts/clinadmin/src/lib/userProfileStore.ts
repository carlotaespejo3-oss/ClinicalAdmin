// userProfileStore.ts
//
// Persists the clinician's profile collected during onboarding.
// Read by: email classifier (criticalKeywords), triage badges (deadlines),
// Home dashboard (adminTimeBlocks), draft composer (defaultReplyTone + signatures).
//
// Persistence strategy (two-layer):
//   1. localStorage  — instant reads, survives page refresh, works offline.
//   2. Server (onboarding_profile column in clinician_settings) — cross-device
//      sync. On mount the store fetches the server copy; if it shows
//      onboardingComplete=true the wizard is suppressed on any new device.
//      Every updateProfile() write is fire-and-forget to the server so the
//      next device sees the latest state.

import { useSyncExternalStore } from 'react';
import {
  getClinicianSettings,
  upsertClinicianSettings,
} from '@workspace/api-client-react';

// ============================================================================
// Types
// ============================================================================

export type ClinRole =
  | 'doctor'
  | 'psychologist'
  | 'nurse'
  | 'social_worker'
  | 'therapist'
  | 'admin_staff'
  | 'other';

export type ClinSetting =
  | 'outpatient'
  | 'inpatient'
  | 'mixed'
  | 'acute'
  | 'community'
  | 'other';

export type ReplyTone = 'formal' | 'semi-formal' | 'informal';

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri';

export interface AdminTimeBlock {
  days: WeekDay[];
  startTime: string; // 'HH:MM' 24-hour
  endTime: string;   // 'HH:MM' 24-hour
}

export interface EmailSignature {
  id: string;
  label: string; // 'Formal' | 'Informal' | 'Admin' | custom label
  body: string;
}

export interface UserProfile {
  // Identity
  displayName: string;
  role: ClinRole;
  roleOther: string;      // when role === 'other'
  specialty: string;
  setting: ClinSetting;

  // Priority rules
  // Each entry is a topic/concept description (not necessarily a single word).
  // e.g. "self-harm or thoughts of hurting oneself", "clinical deterioration".
  // The AI classifies for meaning; the deterministic pass catches literal sub-words.
  criticalKeywords: string[];

  // SLA / response expectations (hours)
  deadlines: {
    urgent: number;
    clinical: number;
    admin: number;
  };

  // Scheduling
  adminTimeBlocks: AdminTimeBlock[];

  // Communication
  defaultReplyTone: ReplyTone;
  signatures: EmailSignature[];
  coverContact: string; // name or email of cover clinician

  // Wizard state
  onboardingComplete: boolean;
  onboardingStep: number; // last reached step index — for resume later
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_SIGNATURES: EmailSignature[] = [
  { id: 'formal',   label: 'Formal',   body: '' },
  { id: 'informal', label: 'Informal', body: '' },
  { id: 'admin',    label: 'Admin',    body: '' },
];

export const DEFAULT_PROFILE: UserProfile = {
  displayName: '',
  role: 'doctor',
  roleOther: '',
  specialty: '',
  setting: 'outpatient',
  criticalKeywords: [],
  deadlines: { urgent: 4, clinical: 24, admin: 72 },
  adminTimeBlocks: [],
  defaultReplyTone: 'semi-formal',
  signatures: DEFAULT_SIGNATURES,
  coverContact: '',
  onboardingComplete: false,
  onboardingStep: 0,
};

// ============================================================================
// Storage
// ============================================================================

const STORAGE_KEY = 'clinadmin:userProfile:v1';

function loadFromStorage(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE, signatures: DEFAULT_SIGNATURES.map(s => ({ ...s })) };
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    // Merge so new fields added in future versions get their defaults
    return {
      ...DEFAULT_PROFILE,
      ...parsed,
      deadlines: { ...DEFAULT_PROFILE.deadlines, ...(parsed.deadlines ?? {}) },
      // Ensure built-in signature slots always exist
      signatures: mergeSignatures(parsed.signatures ?? []),
    };
  } catch {
    return { ...DEFAULT_PROFILE, signatures: DEFAULT_SIGNATURES.map(s => ({ ...s })) };
  }
}

function mergeSignatures(saved: EmailSignature[]): EmailSignature[] {
  const map = new Map(saved.map((s) => [s.id, s]));
  const base = DEFAULT_SIGNATURES.map((s) => map.get(s.id) ?? { ...s });
  // Append any custom signatures that were saved
  const custom = saved.filter((s) => !DEFAULT_SIGNATURES.find((d) => d.id === s.id));
  return [...base, ...custom];
}

function saveToStorage(p: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Quota exceeded — silently ignore
  }
}

// ============================================================================
// Module-level store state
// ============================================================================

let _profile: UserProfile = loadFromStorage();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((l) => l());
}

// ============================================================================
// Stable snapshot (avoids infinite re-renders in useSyncExternalStore)
// ============================================================================

export interface ProfileState {
  profile: UserProfile;
  isHydrated: true;
}

let _lastProfileRef = _profile;
let _lastSnapshot: ProfileState = { profile: _profile, isHydrated: true };

function getSnapshot(): ProfileState {
  if (_profile === _lastProfileRef) return _lastSnapshot;
  _lastProfileRef = _profile;
  _lastSnapshot = { profile: _profile, isHydrated: true };
  return _lastSnapshot;
}

// ============================================================================
// React hook
// ============================================================================

export function useUserProfile(): ProfileState {
  return useSyncExternalStore(
    (cb) => {
      _listeners.add(cb);
      return () => _listeners.delete(cb);
    },
    getSnapshot,
    getSnapshot,
  );
}

// ============================================================================
// Server sync
// ============================================================================

let _serverSyncStarted = false;

/** Fire-and-forget: write the current profile to the server. */
function persistToServer(p: UserProfile): void {
  upsertClinicianSettings(
    { onboardingProfile: p as unknown as Record<string, unknown> },
  ).catch((err: unknown) => {
    console.warn('[userProfileStore] server write failed', err);
  });
}

/**
 * Called once on app start. Fetches the server copy of onboardingProfile and
 * merges it into the local state — server wins on `onboardingComplete` (so a
 * clinician who finished on one device doesn't see the wizard on another), but
 * we keep the local copy for all other fields if the server has nothing yet.
 */
export function startServerSync(): void {
  if (_serverSyncStarted) return;
  _serverSyncStarted = true;

  getClinicianSettings().then((settings) => {
    const remote = settings.onboardingProfile as Partial<UserProfile> | null;
    if (!remote) return; // server has no saved profile yet — localStorage is authoritative

    // Server wins on completion flag; merge everything else with local as baseline
    const merged: UserProfile = {
      ..._profile,
      ...remote,
      deadlines: { ..._profile.deadlines, ...(remote.deadlines ?? {}) },
      signatures: Array.isArray(remote.signatures) && remote.signatures.length > 0
        ? mergeSignatures(remote.signatures as EmailSignature[])
        : _profile.signatures,
    };

    if (
      merged.onboardingComplete !== _profile.onboardingComplete ||
      merged.displayName        !== _profile.displayName
    ) {
      _profile = merged;
      saveToStorage(_profile);
      notify();
    }
  }).catch((err: unknown) => {
    console.warn('[userProfileStore] server hydration failed — using localStorage', err);
  });
}

// ============================================================================
// Mutation helpers
// ============================================================================

export function updateProfile(patch: Partial<UserProfile>): void {
  _profile = { ..._profile, ...patch };
  saveToStorage(_profile);
  notify();
  // Cross-device: persist asynchronously; localStorage is the
  // synchronous source of truth so the UI never waits on the network.
  persistToServer(_profile);
}

export function completeOnboarding(): void {
  updateProfile({ onboardingComplete: true });
}

export function resetOnboarding(): void {
  _profile = {
    ...DEFAULT_PROFILE,
    signatures: DEFAULT_SIGNATURES.map((s) => ({ ...s })),
  };
  saveToStorage(_profile);
  persistToServer(_profile);
  notify();
}

/** Read current profile outside React (e.g. in classifiers, prompt builders). */
export function getProfile(): UserProfile {
  return _profile;
}

/**
 * Returns the clinician's preferred SLA for a given email category,
 * in whole days (rounded up). Returns null for categories with no
 * natural SLA (NONE, CPD, UNCLEAR). Used as a fallback "Reply within"
 * badge when an email has no explicit per-email deadline set.
 */
export function getSlaDays(category: string): number | null {
  const { deadlines } = _profile;
  switch (category) {
    case 'SAFEGUARDING':
    case 'URGENT_CLINICAL': return Math.ceil(deadlines.urgent / 24);
    case 'CLINICAL':        return Math.ceil(deadlines.clinical / 24);
    case 'ADMIN':
    case 'PROFESSIONAL':
    case 'LEGAL':           return Math.ceil(deadlines.admin / 24);
    default:                return null;
  }
}
