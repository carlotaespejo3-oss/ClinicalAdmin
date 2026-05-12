import type { Email } from './types';

export const RECIPIENT_TYPES = [
  'Parents/Families',
  'GPs',
  'Schools / SENCOs',
  'Clinical Colleagues',
  'Formal / Legal',
] as const;

export type RecipientType = typeof RECIPIENT_TYPES[number];

const SETTINGS_KEY = 'clinadmin-settings';

export function detectRecipientType(email: Pick<Email, 'from' | 'cat'>): RecipientType {
  const from = email.from || '';
  const cat = (email.cat || '').toLowerCase();

  if (cat.includes('legal') || /resolution|legal|\blac\b|social services/i.test(from)) {
    return 'Formal / Legal';
  }
  if (/\(parent\)|\bparent\b|\bfamily\b|\bmum\b|\bdad\b/i.test(from)) {
    return 'Parents/Families';
  }
  if (/\bgp\b|general practitioner|surgery/i.test(from)) {
    return 'GPs';
  }
  if (/senco|school|teacher|head ?teacher/i.test(from)) {
    return 'Schools / SENCOs';
  }
  return 'Clinical Colleagues';
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
