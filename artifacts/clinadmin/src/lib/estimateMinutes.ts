import type { Email, AiClassification, AiCategory, AiPriority } from './types';

// Minutes shown to the user as "time to action" until an email has been
// classified by the AI. Per spec: UNCLEAR pending classification = 10 min.
export const PENDING_CLASSIFICATION_MIN = 10;

// Base ("simple") minutes for each category.
const CATEGORY_BASE: Record<AiCategory, number> = {
  SAFEGUARDING: 20,
  LEGAL: 30,
  URGENT_CLINICAL: 15,
  CLINICAL: 10,
  PROFESSIONAL: 5,
  ADMIN: 2,
  NONE: 1,
  CPD: 2,
  UNCLEAR: 5,
};

// Upper ("complex" / sub-typed) minutes — only set for categories that
// have a higher band per spec.
const CATEGORY_UPPER: Partial<Record<AiCategory, number>> = {
  URGENT_CLINICAL: 20,
  CLINICAL: 15,
  PROFESSIONAL: 10,
};

// The "natural" priority each category lives at by default. Used to detect
// content-driven escalation (e.g. CLINICAL is naturally MEDIUM; if the AI
// classified it URGENT then content has bumped it up — apply +5).
const CATEGORY_NATURAL_PRIORITY: Record<AiCategory, AiPriority> = {
  SAFEGUARDING: 'URGENT',
  URGENT_CLINICAL: 'URGENT',
  LEGAL: 'MEDIUM',
  CLINICAL: 'MEDIUM',
  PROFESSIONAL: 'MEDIUM',
  ADMIN: 'LOW',
  NONE: 'LOW',
  CPD: 'LOW',
  UNCLEAR: 'UNCLEAR',
};

// Comparable rank for AiPriority. Higher = more urgent. UNCLEAR is treated
// as lower than LOW so it never triggers an escalation bump.
const PRIORITY_RANK: Record<AiPriority, number> = {
  UNCLEAR: -1,
  LOW: 0,
  MEDIUM: 1,
  URGENT: 2,
};

// "Complex" content threshold for URGENT_CLINICAL / CLINICAL.
const COMPLEX_WORD_COUNT = 150;

// Heuristic for "multiple questions or concerns": triggered if the body
// has >=2 question marks, OR >=1 question mark together with a connector
// cue. Keep CONNECTORS lowercased and contained to short phrases —
// tweak the list as new patterns emerge.
const QUESTION_MARK_THRESHOLD = 2;
const CONNECTORS = [
  'also',
  'another thing',
  'and can you',
  'and could you',
  'one more',
  'in addition',
  'as well',
  'secondly',
  'furthermore',
  'follow-up question',
];

export function hasMultipleQuestionsOrConcerns(body: string): boolean {
  if (!body) return false;
  const qMarks = (body.match(/\?/g) ?? []).length;
  if (qMarks >= QUESTION_MARK_THRESHOLD) return true;
  if (qMarks >= 1) {
    const lc = body.toLowerCase();
    if (CONNECTORS.some((c) => lc.includes(c))) return true;
  }
  return false;
}

function wordCount(s: string): number {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Email is "complex" if EITHER the deterministic heuristic (>150 words
// or ≥2 questions/concerns) fires OR the AI explicitly flagged the
// content as complex. The AI signal lets short-but-weighty emails
// (e.g. distressed parent with one urgent ambiguous concern) get the
// upper band; the heuristic stays as a safety net for older
// classifications and for cases the AI under-rates.
export function isComplex(email: Email, classification?: AiClassification | null): boolean {
  if (classification?.complexity === 'complex') return true;
  return wordCount(email.body) > COMPLEX_WORD_COUNT || hasMultipleQuestionsOrConcerns(email.body);
}

// Returns the reasons the email is considered complex, suitable for
// surfacing in a UI tooltip next to the time estimate. The AI's own
// reasons take precedence; falls back to a heuristic-derived label
// when only the word-count / question-mark rule fired.
export function complexityReasonsFor(
  email: Email,
  classification?: AiClassification | null,
): string[] {
  if (classification?.complexity === 'complex' && classification.complexityReasons.length > 0) {
    return classification.complexityReasons;
  }
  if (!isComplex(email, classification)) return [];
  const reasons: string[] = [];
  if (wordCount(email.body) > COMPLEX_WORD_COUNT) reasons.push('Long detailed history');
  if (hasMultipleQuestionsOrConcerns(email.body)) reasons.push('Multiple distinct issues');
  return reasons;
}

// Single source of truth for an email's estimated minutes-to-action.
// Returns the PENDING value when no classification is available yet.
// When an email requires a document, the email reply and the document
// write are ONE piece of work. Override the category default entirely
// rather than adding to it.
export const DOCUMENT_BLOCK_MIN = 20;
export const LEGAL_DOCUMENT_BLOCK_MIN = 30;

export function estimateMinutes(email: Email, classification: AiClassification | undefined | null): number {
  if (!classification) return PENDING_CLASSIFICATION_MIN;
  if (classification.requiresDocument) {
    return classification.category === 'LEGAL' ? LEGAL_DOCUMENT_BLOCK_MIN : DOCUMENT_BLOCK_MIN;
  }
  const { category, priority, professionalSubType } = classification;
  const base = CATEGORY_BASE[category];
  const upper = CATEGORY_UPPER[category];
  let minutes = base;

  // Complexity bump for URGENT_CLINICAL and CLINICAL — now driven by
  // either the AI's content assessment or the >150-word / multi-question
  // heuristic (whichever fires first).
  if ((category === 'URGENT_CLINICAL' || category === 'CLINICAL') && upper != null && isComplex(email, classification)) {
    minutes = upper;
  }

  // PROFESSIONAL: bump to upper band for clinical_input / document_request
  // sub-types (those are inherently more involved), OR when the AI flags
  // the content itself as complex even on a meeting/coordination email
  // (e.g. multi-party coordination, clinical uncertainty).
  if (
    category === 'PROFESSIONAL' &&
    upper != null &&
    (
      professionalSubType === 'clinical_input' ||
      professionalSubType === 'document_request' ||
      isComplex(email, classification)
    )
  ) {
    minutes = upper;
  }

  // Content-driven escalation: if the AI bumped priority above the
  // category's natural priority, add 5 minutes on top.
  const natural = CATEGORY_NATURAL_PRIORITY[category];
  if (PRIORITY_RANK[priority] > PRIORITY_RANK[natural]) {
    minutes += 5;
  }

  return minutes;
}
