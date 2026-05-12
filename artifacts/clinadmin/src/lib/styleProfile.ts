import { RECIPIENT_TYPES, type RecipientType } from './signatures';

export interface StyleProfileSection {
  greeting: string;
  tone: string;
  signOff: string;
  keyPhrases: string;
}

export interface StyleProfile {
  overall: string;
  sections: Partial<Record<RecipientType, StyleProfileSection>>;
  builtAt: number;
}

const STYLE_KEY = 'clinadmin-style-profile';

const HEADER_TO_TYPE: Record<string, RecipientType> = {
  'PARENTS/FAMILIES': 'Parents/Families',
  'PARENTS / FAMILIES': 'Parents/Families',
  'CLINICAL COLLEAGUES': 'Clinical Colleagues',
  'GPS': 'GPs',
  'GP': 'GPs',
  'SCHOOLS / SENCOS': 'Schools / SENCOs',
  'SCHOOLS/SENCOS': 'Schools / SENCOs',
  'FORMAL / LEGAL': 'Formal / Legal',
  'FORMAL/LEGAL': 'Formal / Legal',
};

function fieldValue(block: string, label: string): string {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

export function parseStyleProfile(text: string): StyleProfile {
  const overallMatch = text.match(/OVERALL\s*:\s*(.+?)(?:\n\s*\n|$)/is);
  const overall = overallMatch ? overallMatch[1].trim().replace(/\s+/g, ' ') : '';

  const sections: Partial<Record<RecipientType, StyleProfileSection>> = {};

  // Split by blank lines and look at first line of each block as a potential header.
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const header = lines[0].toUpperCase().replace(/[*_#]/g, '').trim();
    const recipientType = HEADER_TO_TYPE[header];
    if (!recipientType) continue;
    const body = lines.slice(1).join('\n');
    sections[recipientType] = {
      greeting: fieldValue(body, 'Greeting'),
      tone: fieldValue(body, 'Tone'),
      signOff: fieldValue(body, 'Sign-?off'),
      keyPhrases: fieldValue(body, 'Key phrases'),
    };
  }

  return { overall, sections, builtAt: Date.now() };
}

export function saveStyleProfile(profile: StyleProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export function loadStyleProfile(): StyleProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StyleProfile;
    if (!parsed || typeof parsed !== 'object' || !parsed.sections) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStyleProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STYLE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Returns prompt-ready style guidance for a recipient, or null if no profile
 * has been built (or the section is empty).
 */
export function getStyleGuidanceForRecipient(recipientType: RecipientType): string | null {
  const profile = loadStyleProfile();
  if (!profile) return null;
  const section = profile.sections[recipientType];
  if (!section) return null;

  const parts: string[] = [];
  if (profile.overall) parts.push(`Overall voice: ${profile.overall}`);
  if (section.greeting) parts.push(`Greeting style: ${section.greeting}`);
  if (section.tone) parts.push(`Tone for ${recipientType}: ${section.tone}`);
  if (section.keyPhrases) parts.push(`Prefer phrases like: ${section.keyPhrases}`);
  if (section.signOff) parts.push(`Typical sign-off phrasing: ${section.signOff}`);
  if (parts.length === 0) return null;
  return parts.join('\n');
}

export { RECIPIENT_TYPES };
