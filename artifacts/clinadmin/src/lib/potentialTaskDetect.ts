// Heuristic scanner that finds potential follow-up actions inside an
// email — phone calls, appointment requests, results to review,
// referrals, repeat prescriptions, follow-ups, and generic deadlines.
//
// CRITICAL: this NEVER creates a task. It only surfaces "possible task"
// suggestions that the clinician must approve via the inbox prompt.
// Document requests are handled separately by documentDetect.ts and
// must not appear here (we filter them out at the call site by skipping
// when classification.documentDirection !== null).
//
// One match per kind, so a long email mentioning the same kind of
// action three times won't generate three duplicate prompts.

export type PotentialTaskKind =
  | 'phone_call'
  | 'appointment'
  | 'results_review'
  | 'referral'
  | 'prescription'
  | 'follow_up'
  | 'deadline';

// Confidence model — the AI scores its own certainty in two
// dimensions so the UI can decide whether to act silently, act
// loudly, or refuse to act.
//
//   dateConfidence  — how sure we are about WHEN
//     high   : explicit weekday/date phrase we could parse exactly
//              ("by Friday", "by Wed", "deadline is in 5 days")
//     medium : anchored relative phrase ("end of this week",
//              "before end of term", "by next week")
//     low    : no date detected at all (dueDays === null)
//
//   intentConfidence — how sure we are this is a real ask of THIS
//                      clinician (vs FYI / passive / CC'd)
//     high   : 2nd-person direct address — "could you", "please
//              send", "can you call" — kind is action-shaped
//     medium : actionable but ambiguous owner — "the report needs
//              to be done", "results should be reviewed"
//     low    : vague follow-up language without ask wording, or
//              kind === 'deadline' with no co-detected action
//
// Tier collapses the two scores into the policy the UI applies:
//
//   1 — silent auto-create (both high)
//   2 — auto-create with amber "estimated" strip (one medium, none low)
//   3 — do NOT auto-create; surface as an unresolved ghost row that
//       the clinician taps to classify (either dimension low)
export type DateConfidence = 'high' | 'medium' | 'low';
export type IntentConfidence = 'high' | 'medium' | 'low';
export type DetectionTier = 1 | 2 | 3;

export interface PotentialTask {
  kind: PotentialTaskKind;
  // Human-readable suggested task title. Pre-fills the creation form
  // and is shown verbatim in the prompt panel.
  suggestedTitle: string;
  // Default task type label that maps to the time-estimate table.
  type: string;
  // Default minutes estimate (clinician can edit before saving).
  defaultMin: number;
  // The phrase that triggered detection — kept short, used in the
  // "This email might need a follow-up action: '...'" sentence.
  evidence: string;
  // Optional days-from-today deadline if the email mentions one.
  dueDays: number | null;
  // Two-dimension confidence (see comment above for semantics).
  dateConfidence: DateConfidence;
  intentConfidence: IntentConfidence;
  // Derived from the two scores. See deriveTier().
  tier: DetectionTier;
}

export function deriveTier(
  date: DateConfidence,
  intent: IntentConfidence,
): DetectionTier {
  if (date === 'low' || intent === 'low') return 3;
  if (date === 'high' && intent === 'high') return 1;
  return 2;
}

interface KindRule {
  kind: PotentialTaskKind;
  patterns: RegExp[];
  type: string;
  defaultMin: number;
  // Builds the suggested title from the matched evidence + email
  // sender. Kept simple; the clinician can edit before saving.
  buildTitle: (sender: string) => string;
}

// Order matters: more specific kinds first so that, e.g., a
// "please call us about your repeat prescription" email gets tagged as
// phone_call rather than prescription. The first matching rule wins
// per kind, but kinds themselves are independent so an email can
// trigger multiple prompts.
const KIND_RULES: KindRule[] = [
  {
    kind: 'phone_call',
    patterns: [
      /\bcould\s+you\s+(please\s+)?(give\s+us\s+a\s+call|call\s+(me|us)|phone\s+(me|us))\b/i,
      /\bplease\s+(give\s+us\s+a\s+call|call\s+(me|us)\s+back|phone\s+(me|us))\b/i,
      /\bgive\s+us\s+a\s+call\b/i,
      /\bcall\s+(us|me)\s+back\b/i,
      /\b(I|we)\s+tried\s+to\s+reach\s+you\b/i,
      /\bwould\s+you\s+be\s+able\s+to\s+(call|phone|ring)\s+(me|us)\b/i,
      /\bring\s+(me|us)\s+back\b/i,
      /\b(can|could)\s+(we|you)\s+(have\s+)?a\s+(quick\s+)?(phone\s+)?call\b/i,
    ],
    type: 'Phone call',
    defaultMin: 10,
    buildTitle: (sender) => `Call ${sender} back`,
  },
  {
    kind: 'appointment',
    patterns: [
      /\bbook\s+(an?|the\s+next)\s+appointment\b/i,
      /\bschedule\s+(an?|the\s+next)\s+appointment\b/i,
      /\bwe\s+would\s+like\s+to\s+come\s+in\b/i,
      /\bwhen\s+(is|are)\s+(the\s+)?next\s+available\b/i,
      /\bwe\s+need\s+to\s+be\s+seen\b/i,
      /\bappointment\s+to\s+discuss\b/i,
      /\bwould\s+like\s+to\s+book\s+(an?\s+)?(appointment|session|slot)\b/i,
      /\bcan\s+we\s+book\s+(an?\s+)?(appointment|session|slot)\b/i,
    ],
    type: 'Book appointment',
    defaultMin: 2,
    buildTitle: (sender) => `Book appointment for ${sender}`,
  },
  {
    kind: 'results_review',
    patterns: [
      /\b(blood|pathology|test|imaging|MRI|EEG|ECG|scan)\s+results?\s+(are|is)\s+(attached|back|ready|in|available)\b/i,
      /\bresults?\s+(are\s+)?(attached|back|ready|in|available)\b/i,
      /\bplease\s+review\s+the\s+(attached\s+)?results?\b/i,
      /\bpathology\s+(is\s+)?(ready|back|attached)\b/i,
      /\b(blood|pathology|test|imaging)\s+results?\s+attached\b/i,
    ],
    type: 'Review results',
    defaultMin: 5,
    buildTitle: () => 'Review attached results',
  },
  {
    kind: 'referral',
    patterns: [
      /\bcould\s+you\s+refer\s+(us|me|him|her|them)\b/i,
      /\bwe\s+would\s+like\s+a\s+referral\b/i,
      /\b(can|could)\s+you\s+(send|write|provide)\s+a\s+referral\b/i,
      /\bplease\s+(send|write|provide)\s+a\s+referral\b/i,
      /\breferral\s+(letter\s+)?(to|for)\s+\w+/i,
    ],
    type: 'Write referral',
    defaultMin: 15,
    buildTitle: (sender) => `Write referral for ${sender}`,
  },
  {
    kind: 'prescription',
    patterns: [
      /\b(we|I)\s+need\s+a\s+repeat\s+prescription\b/i,
      /\brepeat\s+prescription\b/i,
      /\b(can|could)\s+you\s+renew\s+(the\s+|my\s+|his\s+|her\s+|our\s+)?(prescription|script|medication)\b/i,
      /\b(we|I|he|she)\s+(have|has|have just)?\s*run\s+out\s+of\b/i,
      /\bprescription\s+(renewal|repeat)\b/i,
      /\bplease\s+renew\s+(the\s+|my\s+|his\s+|her\s+)?(prescription|script|medication)\b/i,
    ],
    type: 'Repeat prescription',
    defaultMin: 3,
    buildTitle: (sender) => `Repeat prescription for ${sender}`,
  },
  {
    kind: 'follow_up',
    patterns: [
      /\bfollowing\s+up\s+on\b/i,
      /\bjust\s+checking\s+in\b/i,
      /\bwe\s+haven'?t\s+heard\s+back\b/i,
      /\b(I|we)\s+wanted\s+to\s+follow\s+up\b/i,
      /\bany\s+update\s+on\b/i,
      /\bchasing\s+(this|up|on)\b/i,
    ],
    type: 'Follow-up action',
    defaultMin: 10,
    buildTitle: (sender) => `Follow up with ${sender}`,
  },
];

// Deadline phrases — pulled out separately because they piggy-back
// on the other detected kinds (we attach `dueDays` to the first
// detected kind). When NO kind matched but the email mentions a
// deadline tied to an action, we surface a generic 'deadline'
// prompt so the clinician isn't left with nothing.
const DEADLINE_PATTERNS: Array<{ re: RegExp; days: (m: RegExpMatchArray) => number }> = [
  {
    re: /\b(by|before)\s+(this\s+)?friday\b/i,
    days: () => daysUntilWeekday(5),
  },
  {
    re: /\b(by|before)\s+(this\s+)?monday\b/i,
    days: () => daysUntilWeekday(1),
  },
  {
    re: /\b(by|before)\s+(this\s+)?tuesday\b/i,
    days: () => daysUntilWeekday(2),
  },
  {
    re: /\b(by|before)\s+(this\s+)?wednesday\b/i,
    days: () => daysUntilWeekday(3),
  },
  {
    re: /\b(by|before)\s+(this\s+)?thursday\b/i,
    days: () => daysUntilWeekday(4),
  },
  {
    re: /\bdeadline\s+is\s+in\s+(\d{1,2})\s+(day|week)s?\b/i,
    days: (m) => parseInt(m[1], 10) * (m[2].toLowerCase().startsWith('week') ? 7 : 1),
  },
  {
    re: /\bdue\s+(by\s+|in\s+)?(\d{1,2})\s+(day|week)s?\b/i,
    days: (m) => parseInt(m[2], 10) * (m[3].toLowerCase().startsWith('week') ? 7 : 1),
  },
  {
    re: /\bbefore\s+the\s+end\s+of\s+(this\s+)?term\b/i,
    days: () => 28,
  },
  {
    re: /\bby\s+next\s+week\b/i,
    days: () => 7,
  },
  {
    re: /\bby\s+end\s+of\s+(this\s+)?week\b/i,
    days: () => 5,
  },
];

// 1=Mon, 2=Tue, ... 5=Fri. Days from today (UTC-ish — close enough
// for a placeholder estimate the clinician can edit).
function daysUntilWeekday(target: number): number {
  const today = new Date().getDay();
  const current = today === 0 ? 7 : today; // Sun=7
  const diff = target - current;
  return diff > 0 ? diff : diff + 7;
}

interface DeadlineMatch {
  days: number;
  confidence: DateConfidence;
}

// The same patterns split into "exact" (high) vs "anchored relative"
// (medium). When no pattern matches, the caller treats dateConfidence
// as 'low'. Order mirrors DEADLINE_PATTERNS so behaviour is identical.
const EXACT_DATE_REGEXES: RegExp[] = [
  /\b(by|before)\s+(this\s+)?(monday|tuesday|wednesday|thursday|friday)\b/i,
  /\bdeadline\s+is\s+in\s+\d{1,2}\s+(day|week)s?\b/i,
  /\bdue\s+(by\s+|in\s+)?\d{1,2}\s+(day|week)s?\b/i,
];

function detectDueDays(text: string): DeadlineMatch | null {
  for (const { re, days } of DEADLINE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const isExact = EXACT_DATE_REGEXES.some((r) => r.test(m[0]));
      return { days: days(m), confidence: isExact ? 'high' : 'medium' };
    }
  }
  return null;
}

// Direct-address phrases mean "this is an ask, addressed to YOU".
// When the detected evidence contains one of these, intent is HIGH.
// Otherwise we treat the action as ambient/passive (MEDIUM), and the
// 'deadline' fallback (no concrete kind) is always LOW.
const DIRECT_ADDRESS_RE =
  /\b(could|can|would)\s+you|please\s+(send|call|phone|ring|write|provide|renew|refer|book|schedule|review)|we\s+would\s+like\s+to\s+(book|come\s+in)|we\s+need\s+to\s+be\s+seen|give\s+us\s+a\s+call|call\s+(us|me)\s+back|ring\s+(us|me)\s+back|tried\s+to\s+reach\s+you/i;

function scoreIntent(
  kind: PotentialTaskKind,
  evidence: string,
  fullText: string,
): IntentConfidence {
  // The generic deadline fallback (no kind detected, only a date) is
  // never a confident ask — it might be informational.
  if (kind === 'deadline') return 'low';
  // Direct 2nd-person ask either in the evidence phrase itself or
  // somewhere in the email body counts as high.
  if (DIRECT_ADDRESS_RE.test(evidence) || DIRECT_ADDRESS_RE.test(fullText)) {
    return 'high';
  }
  return 'medium';
}

// "Mrs Davies (SENCO) <a@b>" → "Mrs Davies"
function senderShortName(from: string): string {
  return from.replace(/<.*?>/g, '').replace(/\(.+?\)/g, '').trim() || from;
}

export interface DetectInput {
  from: string;
  subject: string;
  body: string;
}

export function detectPotentialTasks(email: DetectInput): PotentialTask[] {
  const text = `${email.subject ?? ''}\n${email.body ?? ''}`;
  const sender = senderShortName(email.from ?? '');
  const deadline = detectDueDays(text);
  const dueDays = deadline?.days ?? null;
  const dateConfidence: DateConfidence = deadline?.confidence ?? 'low';

  const found: PotentialTask[] = [];
  for (const rule of KIND_RULES) {
    for (const re of rule.patterns) {
      const m = text.match(re);
      if (m) {
        const evidence = m[0].trim();
        // Only the FIRST detected kind inherits the deadline — the
        // clinician can adjust the rest manually if needed. Later
        // kinds therefore have dateConfidence='low'.
        const isFirst = found.length === 0;
        const intent = scoreIntent(rule.kind, evidence, text);
        const date: DateConfidence = isFirst ? dateConfidence : 'low';
        found.push({
          kind: rule.kind,
          suggestedTitle: rule.buildTitle(sender),
          type: rule.type,
          defaultMin: rule.defaultMin,
          evidence,
          dueDays: isFirst ? dueDays : null,
          dateConfidence: date,
          intentConfidence: intent,
          tier: deriveTier(date, intent),
        });
        break; // first matching pattern per kind wins
      }
    }
  }

  // If no kind matched but a deadline is mentioned with action
  // language ("by Friday", "deadline is in 5 days"), surface a
  // generic deadline prompt so the clinician can decide what to do.
  // Intent is always 'low' here (we found a date but no ask), which
  // forces tier 3 — surfaced as a ghost row, never auto-created.
  if (found.length === 0 && dueDays !== null) {
    const m = DEADLINE_PATTERNS.map((p) => text.match(p.re)).find(Boolean);
    const intent: IntentConfidence = 'low';
    found.push({
      kind: 'deadline',
      suggestedTitle: `Action by deadline (${sender})`,
      type: 'Follow-up action',
      defaultMin: 10,
      evidence: m ? m[0].trim() : 'deadline mentioned',
      dueDays,
      dateConfidence,
      intentConfidence: intent,
      tier: deriveTier(dateConfidence, intent),
    });
  }

  return found;
}
