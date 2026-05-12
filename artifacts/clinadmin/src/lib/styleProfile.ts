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
  'ADMIN TEAM': 'Admin Team',
  'FAMILIES': 'Families',
  'OTHER PROFESSIONALS': 'Other Professionals',
  'RECURRENT FAMILIES / PATIENTS': 'Recurrent Families / Patients',
  'RECURRENT FAMILIES/PATIENTS': 'Recurrent Families / Patients',
  'RECURRENT FAMILIES': 'Recurrent Families / Patients',
};

export const DEFAULT_TONE_PROFILES: Record<RecipientType, StyleProfileSection> = {
  'Admin Team': {
    greeting: 'Hi team,',
    tone: 'Casual, warm, and collegial — like talking to people you see every day.',
    signOff: 'Thanks!',
    keyPhrases: 'quick one, when you get a sec, no rush, ta, cheers',
  },
  'Families': {
    greeting: 'Hi [first name],',
    tone: 'Professional but warm and close, somewhat casual. Always address parents by their first name.',
    signOff: 'Warm regards,',
    keyPhrases: 'thanks so much, just wanted to check in, do let me know, happy to chat through this',
  },
  'Other Professionals': {
    greeting: 'Hi [first name],',
    tone: 'Casual and warm but professional — collegial peer-to-peer tone with allied health and other doctors.',
    signOff: 'Best wishes,',
    keyPhrases: 'thanks for the referral, happy to discuss, keen to hear your thoughts, will keep you posted',
  },
  'Recurrent Families / Patients': {
    greeting: 'Hi [first name],',
    tone: 'Even more casual than Families — familiar, friendly, and personal, as you already have an established relationship.',
    signOff: 'Take care,',
    keyPhrases: 'lovely to hear from you again, hope you\'ve all been well, just give me a shout, as always',
  },
};

const DEFAULT_OVERALL =
  'Warm, attentive, and clearly clinical — adapts naturally from collegial casualness with the team to a closer, friendlier tone with families you know well.';

function fieldValue(block: string, label: string): string {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

export function parseStyleProfile(text: string): StyleProfile {
  const overallMatch = text.match(/OVERALL\s*:\s*(.+?)(?:\n\s*\n|$)/is);
  const overall = overallMatch ? overallMatch[1].trim().replace(/\s+/g, ' ') : '';

  const sections: Partial<Record<RecipientType, StyleProfileSection>> = {};

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

function buildDefaultProfile(): StyleProfile {
  const sections: Partial<Record<RecipientType, StyleProfileSection>> = {};
  for (const type of RECIPIENT_TYPES) {
    sections[type] = { ...DEFAULT_TONE_PROFILES[type] };
  }
  return { overall: DEFAULT_OVERALL, sections, builtAt: 0 };
}

export function loadStyleProfile(): StyleProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (!raw) return buildDefaultProfile();
    const parsed = JSON.parse(raw) as StyleProfile;
    if (!parsed || typeof parsed !== 'object' || !parsed.sections) return buildDefaultProfile();
    const sections: Partial<Record<RecipientType, StyleProfileSection>> = { ...parsed.sections };
    for (const type of RECIPIENT_TYPES) {
      if (!sections[type]) sections[type] = { ...DEFAULT_TONE_PROFILES[type] };
    }
    return { ...parsed, sections };
  } catch {
    return buildDefaultProfile();
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
