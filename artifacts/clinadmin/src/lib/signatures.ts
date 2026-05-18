import type { Email } from './types';
import { RECIPIENT_TYPES, type RecipientType } from './recipientTypes';
import {
  getSignaturesSettings,
  setSignaturesSettingsInternal,
  useSignaturesSettingsCache,
  getAppSettings,
  getDefaultSignatureFromProfile,
  type SignaturesSettings,
} from './clinicianSettingsStore';

// Recipient-type detection (pure) + signature accessors. The
// signatures themselves now live in the shared clinicianSettings
// store; this file just exposes the existing helper API.

export { RECIPIENT_TYPES };
export type { RecipientType, SignaturesSettings };

export function detectRecipientType(email: Pick<Email, 'from' | 'cat'>): RecipientType {
  const from = email.from || '';
  const cat = (email.cat || '').toLowerCase();

  if (/\(recurrent\)|\brecurrent\b|\breturning\b|\bex-patient\b|\bfollow[- ]?up family\b/i.test(from) || cat.includes('recurrent')) {
    return 'Recurrent Families / Patients';
  }
  if (/\badmin\b|reception|secretary|practice manager|clinic team|@clinic|\bcolleague\b/i.test(from) || cat.includes('admin')) {
    return 'Admin Team';
  }
  if (/\(parent\)|\bparent\b|\bfamily\b|\bmum\b|\bdad\b/i.test(from)) {
    return 'Families';
  }
  if (/\bgp\b|general practitioner|surgery|senco|school|teacher|head ?teacher|consultant|paediatrician|psychologist|therapist|allied health|nurse/i.test(from)) {
    return 'Other Professionals';
  }
  return 'Other Professionals';
}

// Synchronous read — used by draftPrompts.ts inside prompt builders.
// Falls back to the default signature when no per-recipient value
// is set, matching the previous localStorage behaviour.
export function getSignatureForRecipient(recipientType: RecipientType): string {
  const settings = getSignaturesSettings();
  const perType = settings.perRecipient[recipientType];
  if (typeof perType === 'string' && perType.trim()) return perType;
  if (settings.default && settings.default.trim()) return settings.default;
  // Final fallback — always derive from the clinician's own profile.
  // Never a hardcoded other-person name.
  return getDefaultSignatureFromProfile(getAppSettings().profile);
}

// Writers used by SettingsTab. Each delegates to the central store
// (in-memory write + fire-and-forget POST).
export function setDefaultSignature(value: string): void {
  const current = getSignaturesSettings();
  setSignaturesSettingsInternal({ ...current, default: value });
}

export function setRecipientSignature(recipient: RecipientType, value: string): void {
  const current = getSignaturesSettings();
  setSignaturesSettingsInternal({
    ...current,
    perRecipient: { ...current.perRecipient, [recipient]: value },
  });
}

// React hook for SettingsTab — re-renders when any signature
// changes (including hydration completing).
export function useSignatures(): SignaturesSettings {
  return useSignaturesSettingsCache();
}
