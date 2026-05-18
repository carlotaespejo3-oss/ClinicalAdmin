import type { PotentialTaskKind } from './potentialTaskDetect';

// Plain-English label for an AI detection kind, written from the
// clinician's POV — used in the AI suggestion strip inside the
// Classify modal ("Looks like a callback request — no deadline").
//
// Kept here rather than inside potentialTaskDetect.ts so the
// detector module stays pure (no UI copy).
export function kindLabel(kind: PotentialTaskKind): string {
  switch (kind) {
    case 'phone_call':     return 'callback request';
    case 'appointment':    return 'appointment request';
    case 'results_review': return 'results review';
    case 'referral':       return 'referral request';
    case 'prescription':   return 'prescription request';
    case 'follow_up':      return 'follow-up';
    case 'deadline':       return 'deadline';
  }
}
