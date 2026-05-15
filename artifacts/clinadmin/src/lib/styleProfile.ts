import { RECIPIENT_TYPES, type RecipientType } from './recipientTypes';
import {
  DEFAULT_TONE_PROFILES,
  DEFAULT_OVERALL,
  type StyleProfile,
  type StyleProfileSection,
} from './styleProfileTypes';
import {
  getStyleProfile,
  setStyleProfileInternal,
  clearStyleProfileInternal,
} from './clinicianSettingsStore';

// Writing-style profile module. The pure parsing helper
// (parseStyleProfile) and the type/default exports are unchanged.
// Persistence (load/save/clear) used to live in localStorage and
// now delegates to the shared clinicianSettings store.

export type { StyleProfile, StyleProfileSection };
export { DEFAULT_TONE_PROFILES, RECIPIENT_TYPES };

function fieldValue(block: string, label: string): string {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

const HEADER_TO_TYPE: Record<string, RecipientType> = {
  'ADMIN TEAM': 'Admin Team',
  'FAMILIES': 'Families',
  'OTHER PROFESSIONALS': 'Other Professionals',
  'RECURRENT FAMILIES / PATIENTS': 'Recurrent Families / Patients',
  'RECURRENT FAMILIES/PATIENTS': 'Recurrent Families / Patients',
  'RECURRENT FAMILIES': 'Recurrent Families / Patients',
};

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
  setStyleProfileInternal(profile);
}

export function loadStyleProfile(): StyleProfile | null {
  // Returns the in-memory cached profile (or built-in defaults if
  // hydration hasn't completed). The function still returns
  // `StyleProfile | null` to match the existing call sites; in
  // practice the central store always supplies defaults so it's
  // never null.
  return getStyleProfile();
}

export function clearStyleProfile(): void {
  clearStyleProfileInternal();
}

/**
 * Returns prompt-ready style guidance for a recipient, or null if
 * the section is empty. Reads from the in-memory cache — no I/O.
 *
 * `DEFAULT_OVERALL` is re-exported indirectly via the cached
 * profile's `overall` field when nothing has been built yet.
 */
export function getStyleGuidanceForRecipient(recipientType: RecipientType): string | null {
  const profile = getStyleProfile();
  const section = profile.sections[recipientType];
  if (!section) return null;

  const parts: string[] = [];
  const overall = profile.overall || DEFAULT_OVERALL;
  if (overall) parts.push(`Overall voice: ${overall}`);
  if (section.greeting) parts.push(`Greeting style: ${section.greeting}`);
  if (section.tone) parts.push(`Tone for ${recipientType}: ${section.tone}`);
  if (section.keyPhrases) parts.push(`Prefer phrases like: ${section.keyPhrases}`);
  if (section.signOff) parts.push(`Typical sign-off phrasing: ${section.signOff}`);
  if (parts.length === 0) return null;
  return parts.join('\n');
}
