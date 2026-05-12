import type { Email } from './types';

export const RECIPIENT_TYPES = [
  'Admin Team',
  'Families',
  'Other Professionals',
  'Recurrent Families / Patients',
] as const;

export type RecipientType = typeof RECIPIENT_TYPES[number];

const SETTINGS_KEY = 'clinadmin-settings';

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

export function getSignatureForRecipient(recipientType: RecipientType): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    const perType = parsed?.signatures?.[recipientType];
    if (typeof perType === 'string' && perType.trim()) return perType;
    return typeof parsed?.signature === 'string' ? parsed.signature : '';
  } catch {
    return '';
  }
}
