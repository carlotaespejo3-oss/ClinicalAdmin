// Heuristic document/form detector. Runs after AI classification and ORs
// its result with the AI's `requiresDocument` flag — so even when the AI
// misses a document cue, the rules below catch it. Kept deliberately
// conservative: only short, high-signal phrases.

export interface DocumentDetection {
  requiresDocument: boolean;
  documentType: string | null;
  documentDueDays: number | null;
}

interface Pattern {
  re: RegExp;
  type: string;
}

const PATTERNS: Pattern[] = [
  { re: /\bNDIS\b.*\b(report|letter|plan|form|paperwork|application)\b/i, type: 'NDIS report' },
  { re: /\b(report|letter|form)\b.*\bNDIS\b/i, type: 'NDIS report' },
  { re: /\b(EHCP|education(?:al)?\s+health(?:care)?\s+plan)\b/i, type: 'EHCP letter' },
  { re: /\bschool\s+(support\s+)?letter\b/i, type: 'School support letter' },
  { re: /\bmedical\s+certificate\b/i, type: 'Medical certificate' },
  { re: /\breferral\s+letter\b/i, type: 'Referral letter' },
  { re: /\b(court|medico[-\s]?legal|expert)\s+report\b/i, type: 'Medico-legal report' },
  { re: /\binsurance\s+(form|claim|report|letter)\b/i, type: 'Insurance form' },
  { re: /\b(psychologist|allied\s+health|GP|paediatric(?:ian)?)\s+report\b/i, type: 'Allied health report' },
  { re: /\battach(?:ed|ment).{0,40}\bform\b/i, type: 'Form to complete' },
  // "please complete" is too broad on its own (catches conference signups,
  // CPD registrations, feedback surveys). Only match when paired with a
  // document noun nearby — that's the signal the clinician must write
  // something, not just click a link.
  { re: /\bplease\s+complete\b.{0,60}\b(form|report|letter|certificate|questionnaire|assessment)\b/i, type: 'Document to complete' },
  { re: /\b(form|report|letter|certificate|questionnaire|assessment)\b.{0,60}\bplease\s+complete\b/i, type: 'Document to complete' },
  { re: /\bplease\s+(provide|write).{0,20}\bletter\b/i, type: 'Letter requested' },
  { re: /\bplease\s+fill\s+(in|out)\b.{0,40}\b(form|questionnaire|assessment)\b/i, type: 'Form to fill in' },
  { re: /\b(we\s+need|could\s+you\s+(?:provide|write|prepare))\s+(a\s+)?(short\s+)?(letter|report|certificate)\b/i, type: 'Letter/report requested' },
];

function extractDueDays(text: string): number | null {
  const within = text.match(/within\s+(\d{1,2})\s+(day|week)s?/i);
  if (within) {
    const n = parseInt(within[1], 10);
    if (Number.isFinite(n)) return within[2].toLowerCase().startsWith('week') ? n * 7 : n;
  }
  if (/by\s+next\s+week/i.test(text)) return 7;
  if (/by\s+end\s+of\s+(this\s+)?week/i.test(text)) return 5;
  if (/by\s+(end\s+of\s+)?(the\s+)?month/i.test(text)) return 21;
  return null;
}

export function detectDocumentRequest(email: { body: string; subject: string }): DocumentDetection {
  const text = `${email.subject ?? ''}\n${email.body ?? ''}`;
  for (const { re, type } of PATTERNS) {
    if (re.test(text)) {
      return {
        requiresDocument: true,
        documentType: type,
        documentDueDays: extractDueDays(text),
      };
    }
  }
  return { requiresDocument: false, documentType: null, documentDueDays: null };
}
