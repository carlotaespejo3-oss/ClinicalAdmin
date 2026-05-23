// userProfileStore.ts
//
// Persists the clinician's profile collected during onboarding.
// Read by: email classifier (criticalKeywords), triage badges (deadlines),
// Home dashboard (adminTimeBlocks), draft composer (defaultReplyTone + signatures).
//
// Pattern: useSyncExternalStore, localStorage-backed, stable snapshots.

import { useSyncExternalStore } from 'react';

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
  criticalKeywords: string[]; // always-urgent regardless of AI score

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
// Mutation helpers
// ============================================================================

export function updateProfile(patch: Partial<UserProfile>): void {
  _profile = { ..._profile, ...patch };
  saveToStorage(_profile);
  notify();
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
  notify();
}

/** Read current profile outside React (e.g. in classifiers, prompt builders). */
export function getProfile(): UserProfile {
  return _profile;
}
