// =============================================================================
// Server-side de-identification for the draft_audit carve-out.
// =============================================================================
//
// Stage 4 scrubber. Deliberately simple, deterministic, rule-based — to be
// replaced by a proper NER service before any clinical pilot. The point of
// this implementation is to make the carve-out safe in development with the
// seed data we have: nothing labelled as a patient or parent name should
// land in the database in plaintext.
//
// Inputs:
//   - text:         the AI draft text (pre-scrub).
//   - participants: a list of { name, role } the client extracted from the
//                   email context (sender, recipients, body mentions). The
//                   server does not have Microsoft Graph access; the client
//                   is the source of truth for "who is this email about".
//
// Output:
//   - The same text with each participant name (case-insensitive, word-
//     boundary matched) replaced by the appropriate placeholder.
//
// Rules:
//   - role=patient → [PATIENT_NAME]
//   - role=parent  → [PARENT_NAME]
//   - role=other   → [NAME]
//   - Full names are scrubbed first (longest-first), then first names, so
//     "Sasha Chenoweth" is replaced wholesale before "Sasha" alone would
//     trigger.
//   - Already-present placeholder tokens are left alone.
//   - Empty participants list → text returned unchanged.
//   - Names of zero or one character are ignored (false-positive risk).
// =============================================================================

export type ParticipantRole = "patient" | "parent" | "other";

export interface Participant {
  name: string;
  role: ParticipantRole;
}

const PLACEHOLDER: Record<ParticipantRole, string> = {
  patient: "[PATIENT_NAME]",
  parent: "[PARENT_NAME]",
  other: "[NAME]",
};

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Replacement {
  needle: string;
  placeholder: string;
  length: number;
}

function buildReplacements(participants: Participant[]): Replacement[] {
  const seen = new Set<string>();
  const out: Replacement[] = [];

  // Pass 1: full names (anything with whitespace), then individual tokens.
  // Longest-first ordering inside each pass prevents partial overlaps.
  const fullNames: Replacement[] = [];
  const partNames: Replacement[] = [];

  for (const p of participants) {
    const name = p.name.trim();
    if (name.length < 2) continue;
    const placeholder = PLACEHOLDER[p.role];

    const fullKey = `${name.toLowerCase()}::${placeholder}`;
    if (!seen.has(fullKey)) {
      seen.add(fullKey);
      fullNames.push({ needle: name, placeholder, length: name.length });
    }

    for (const token of name.split(/\s+/)) {
      if (token.length < 2) continue;
      const partKey = `${token.toLowerCase()}::${placeholder}`;
      if (seen.has(partKey)) continue;
      seen.add(partKey);
      partNames.push({ needle: token, placeholder, length: token.length });
    }
  }

  fullNames.sort((a, b) => b.length - a.length);
  partNames.sort((a, b) => b.length - a.length);
  out.push(...fullNames, ...partNames);
  return out;
}

export function deidentify(text: string, participants: Participant[]): string {
  if (!text) return text;
  if (!participants || participants.length === 0) return text;

  let scrubbed = text;
  for (const r of buildReplacements(participants)) {
    // Word-boundary match, case-insensitive. \b handles "Sasha." and "Sasha,"
    // but won't fire mid-word (so "Sashay" survives "Sasha").
    const re = new RegExp(`\\b${escapeRegex(r.needle)}\\b`, "gi");
    scrubbed = scrubbed.replace(re, r.placeholder);
  }
  return scrubbed;
}
