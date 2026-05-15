import type { RecipientType } from './recipientTypes';

// Pure types + defaults for the writing-style profile. Split out
// from styleProfile.ts so the central settings store can import
// the defaults without pulling in the React/persistence layer.

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

export const DEFAULT_OVERALL =
  'Warm, attentive, and clearly clinical — adapts naturally from collegial casualness with the team to a closer, friendlier tone with families you know well.';
