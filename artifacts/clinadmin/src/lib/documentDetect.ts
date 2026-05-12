// Heuristic document/form detector. Runs alongside AI classification:
//   1. Find a document noun (report / letter / certificate / NDIS / EHCP …)
//   2. If one is present, decide DIRECTION — is the document being sent
//      TO the clinician (incoming, FYI) or being requested FROM the
//      clinician (outgoing, action required).
//
// Only outgoing documents create a task and add the 20/30 min combined
// block. Incoming documents are FYI: stay at the category default time
// and surface a "Document received" badge. When direction can't be
// determined, return 'unclear' so the UI can ask the clinician.
//
// Kept conservative: high-signal phrases only, so we don't flag every
// email that happens to mention a "letter".

export type DocumentDirection = 'incoming' | 'outgoing' | 'unclear';

export interface DocumentDetection {
  hasDocument: boolean;
  direction: DocumentDirection | null;
  documentType: string | null;
  documentDueDays: number | null;
}

interface Pattern {
  re: RegExp;
  type: string;
}

// Document NOUN patterns — these only tell us "a document is being
// discussed". Direction is decided separately below.
const NOUN_PATTERNS: Pattern[] = [
  { re: /\bNDIS\b.*\b(report|letter|plan|form|paperwork|application)\b/i, type: 'NDIS report' },
  { re: /\b(report|letter|form)\b.*\bNDIS\b/i, type: 'NDIS report' },
  { re: /\b(EHCP|education(?:al)?\s+health(?:care)?\s+plan)\b/i, type: 'EHCP letter' },
  { re: /\bschool\s+(support\s+)?letter\b/i, type: 'School support letter' },
  { re: /\bmedical\s+certificate\b/i, type: 'Medical certificate' },
  { re: /\breferral\s+letter\b/i, type: 'Referral letter' },
  { re: /\b(court|medico[-\s]?legal|expert)\s+report\b/i, type: 'Medico-legal report' },
  { re: /\binsurance\s+(form|claim|report|letter)\b/i, type: 'Insurance form' },
  { re: /\b(psychological|psychology|psychiatric|allied\s+health|GP|paediatric(?:ian)?)\s+(assessment|report|letter|summary)\b/i, type: 'Allied health report' },
  { re: /\bdischarge\s+summary\b/i, type: 'Discharge summary' },
  { re: /\bprogress\s+(note|report)\b/i, type: 'Progress note' },
  { re: /\bpathology\s+(results?|report)\b/i, type: 'Pathology results' },
  { re: /\bclinical\s+summary\s+letter\b/i, type: 'Clinical summary letter' },
  { re: /\battach(?:ed|ment).{0,40}\b(form|report|letter|certificate|assessment)\b/i, type: 'Document' },
  // Generic "please complete <doc>" — noun without committing on direction.
  { re: /\b(form|report|letter|certificate|questionnaire|assessment)\b.{0,80}\b(please\s+complete|please\s+fill\s+(in|out)|please\s+provide|please\s+write)\b/i, type: 'Document to complete' },
  { re: /\b(please\s+complete|please\s+fill\s+(in|out)|please\s+provide|please\s+write)\b.{0,80}\b(form|report|letter|certificate|questionnaire|assessment)\b/i, type: 'Document to complete' },
];

// Outgoing signals — the sender is asking the clinician to produce
// something. Strong, action-language phrases.
const OUTGOING_SIGNALS: RegExp[] = [
  /\bplease\s+complete\b/i,
  /\bplease\s+provide\b/i,
  /\bplease\s+fill\s+(in|out)\b/i,
  /\bplease\s+(prepare|write|draft|send\s+us)\b/i,
  /\bcould\s+you\s+(please\s+)?(write|provide|complete|prepare|send|draft|fill)\b/i,
  /\bcan\s+you\s+(please\s+)?(write|provide|send|draft|complete)\b/i,
  /\bwe\s+(would|'d)\s+(be\s+)?(grateful|very\s+grateful|appreciate)\s+if\s+you\s+(could|would)\b/i,
  /\bwould\s+be\s+grateful\s+if\s+you\s+could\s+(provide|write|complete|prepare|send|draft)\b/i,
  /\bwe\s+(need|require|are\s+requesting)\s+(a\s+|the\s+|your\s+)?(\w+\s+){0,3}(letter|report|certificate|form|summary|referral|opinion|note)\b/i,
  /\brequesting\s+(a\s+|the\s+)?(\w+\s+){0,3}(letter|report|certificate|form|summary|referral)\b/i,
  /\bwould\s+(you\s+)?(be\s+able\s+to\s+)?(provide|write|complete|send|prepare|draft)\b/i,
  /\b(kindly|please)\s+forward\s+(us|me)\b/i,
  /\bare\s+you\s+able\s+to\s+(write|provide|complete|prepare|send|draft)\b/i,
];

// Incoming signals — the sender is sending something for the
// clinician's information.
const INCOMING_SIGNALS: RegExp[] = [
  /\bplease\s+find\s+attached\b/i,
  /\bplease\s+see\s+attached\b/i,
  /\battached\s+please\s+find\b/i,
  /\bI\s+(am|'m)\s+sending\s+you\b/i,
  /\bI\s+(have\s+)?attached\b/i,
  /\battached\s+is\b/i,
  /\benclosed\s+(is|are|please)\b/i,
  /\bfor\s+your\s+(information|records|reference|interest)\b/i,
  /\bFYI\b/i,
  /\bI\s+wanted\s+to\s+share\b/i,
  /\bsharing\s+(this|the|our|my)\b/i,
  /\bI\s+hope\s+this\s+is\s+helpful\b/i,
  /\bthought\s+you\s+might\s+(want|like)\s+to\s+see\b/i,
  /\bplease\s+see\s+(the\s+)?(attached\s+)?(report|letter|results|assessment|summary|note|notes)\b/i,
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

function detectDirection(text: string): DocumentDirection {
  const outgoing = OUTGOING_SIGNALS.some((re) => re.test(text));
  const incoming = INCOMING_SIGNALS.some((re) => re.test(text));
  // Outgoing wins when both are present — action language is the more
  // expensive signal to miss (an unmade task is worse than an extra
  // "received" badge).
  if (outgoing) return 'outgoing';
  if (incoming) return 'incoming';
  return 'unclear';
}

export function detectDocumentRequest(email: { body: string; subject: string }): DocumentDetection {
  const text = `${email.subject ?? ''}\n${email.body ?? ''}`;
  let documentType: string | null = null;
  for (const { re, type } of NOUN_PATTERNS) {
    if (re.test(text)) {
      documentType = type;
      break;
    }
  }
  if (!documentType) {
    return { hasDocument: false, direction: null, documentType: null, documentDueDays: null };
  }
  const direction = detectDirection(text);
  // Document due days only matters for outgoing requests; for incoming
  // FYI documents the clinician isn't on the hook for a deadline.
  const documentDueDays = direction === 'outgoing' ? extractDueDays(text) : null;
  return { hasDocument: true, direction, documentType, documentDueDays };
}
