// Deterministic prescription / script request detector.
//
// Why a separate module from potentialTaskDetect? Prescription requests
// carry a LOT of structured data the clinician needs at a glance —
// medication, dose, controlled-drug status, travel context, deadline,
// patient name — and the spec demands very specific behaviours
// (escalate to URGENT on short deadlines, set the task due date one
// day BEFORE the family deadline as a safety buffer, flag controlled
// drugs). Folding all of this into the generic detector would obscure
// intent and make tests brittle.
//
// The detector is a PURE function — pass in an optional `now` for
// deterministic tests. It NEVER creates a task or modifies state.

export type PrescriptionFlavour = 'repeat' | 'early' | 'lost';

export interface PrescriptionRequest {
  flavour: PrescriptionFlavour;
  // Whether the email mentions travel/holiday — drives the special
  // case rules (always early, always check for travel date, draft
  // adds the international travel note).
  travelMentioned: boolean;
  // True when the body hints at international travel ("abroad",
  // "overseas", "international"). Used to decide whether to add the
  // travel-letter note to the task.
  internationalTravelHint: boolean;
  // Extracted medication details — null when the detector couldn't
  // confidently extract them. The clinician can fill in via the form.
  medicationName: string | null;
  medicationDose: string | null;
  medicationQuantity: string | null;
  patientName: string | null;
  // True if the medication is a controlled / stimulant ADHD drug
  // (Ritalin, Concerta, methylphenidate, dexamphetamine, Vyvanse,
  // lisdexamfetamine, Strattera). Drives the warning banner on both
  // the email and the task, and bumps time estimate to 8 minutes.
  controlledDrug: boolean;
  // Family's actual deadline (e.g. they leave on Friday). Days from
  // `now`. Null when no deadline phrase was matched.
  deadlineDays: number | null;
  // Friendly label for the deadline ("Friday", "the 15th", etc.) for
  // the banner copy. Null when deadlineDays is null.
  deadlineLabel: string | null;
  // Short evidence snippet — first matched prescription phrase. Used
  // in the prompt for transparency ("we spotted: '...'").
  evidence: string;
}

// ---- Medication dictionary --------------------------------------------------
// Common psychiatric / ADHD medications seen in a child & adolescent
// psychiatry inbox. Order matters only for display ("methylphenidate"
// before "Ritalin" doesn't matter — we match all and pick the first
// occurrence in the text). Dictionary is lowercase; matched
// case-insensitively.
const MEDICATIONS = [
  'ritalin',
  'concerta',
  'methylphenidate',
  'dexamphetamine',
  'dexamfetamine',
  'vyvanse',
  'lisdexamfetamine',
  'strattera',
  'atomoxetine',
  'aripiprazole',
  'abilify',
  'sertraline',
  'zoloft',
  'fluoxetine',
  'prozac',
  'risperidone',
  'risperdal',
  'melatonin',
  'quetiapine',
  'seroquel',
  'olanzapine',
  'zyprexa',
  'clonidine',
  'catapres',
  'guanfacine',
  'intuniv',
] as const;

// Controlled / stimulant medications. Per spec: Ritalin, Concerta,
// methylphenidate, dexamphetamine, Vyvanse, lisdexamfetamine, and
// Strattera (not technically controlled but flagged as
// stimulant-adjacent).
const CONTROLLED_DRUGS = new Set<string>([
  'ritalin',
  'concerta',
  'methylphenidate',
  'dexamphetamine',
  'dexamfetamine',
  'vyvanse',
  'lisdexamfetamine',
  'strattera',
]);

export const CONTROLLED_DRUG_WARNING =
  'Controlled drug — check prescribing rules and patient record before issuing';

// ---- Trigger patterns -------------------------------------------------------
// ANY match here means we treat the email as a prescription request.
// Each rule also tells us the FLAVOUR (repeat / early / lost). Travel
// patterns force "early" regardless.

interface TriggerRule {
  re: RegExp;
  flavour: PrescriptionFlavour;
  travel?: boolean;
  // When true, the rule alone is too weak to confirm a prescription
  // request — we additionally require a medication name nearby.
  // Otherwise "running low on patience" or "we are going away on
  // Friday" would false-positive.
  requiresMedAnchor?: boolean;
}

const TRIGGER_RULES: TriggerRule[] = [
  // Explicit early script language
  { re: /\bearly\s+(script|prescription)\b/i, flavour: 'early' },
  { re: /\b(can|could)\s+(we|you)\s+have\s+an\s+early\b/i, flavour: 'early' },
  // Repeat script language
  { re: /\brepeat\s+(prescription|script)\b/i, flavour: 'repeat' },
  { re: /\bprescription\s+(renewal|repeat)\b/i, flavour: 'repeat' },
  { re: /\b(can|could)\s+you\s+renew\s+(the\s+|my\s+|his\s+|her\s+|our\s+)?(prescription|script|medication)\b/i, flavour: 'repeat' },
  { re: /\bplease\s+renew\s+(the\s+|my\s+|his\s+|her\s+|our\s+)?(prescription|script|medication)\b/i, flavour: 'repeat' },
  // Generic "send / give us a script"
  { re: /\b(can|could)\s+(we|you)\s+(have|get)\s+a\s+(script|prescription)\b/i, flavour: 'repeat' },
  { re: /\b(can|could)\s+you\s+send\s+(a|the|an?)\s+(prescription|script)\b/i, flavour: 'repeat' },
  { re: /\bwe\s+need\s+more\s+(of\s+)?(her|his|the|my)?\s*medication\b/i, flavour: 'repeat' },
  // Lost script
  { re: /\b(lost|misplaced)\s+(the\s+|his\s+|her\s+|my\s+|our\s+)?(prescription|script)\b/i, flavour: 'lost' },
  // Running low / run out — these are the "implicit early" patterns,
  // matched only when a medication name is also nearby (checked at
  // application time, not at regex time).
  { re: /\b(running\s+low|run(?:ning)?\s+out)\s+(on|of)\b/i, flavour: 'early', requiresMedAnchor: true },
  // Travel-triggered — see TRAVEL_RULES below for deadline extraction.
  { re: /\b(going\s+(away|abroad|overseas)|travelling|traveling|holiday|trip|abroad|overseas)\b/i, flavour: 'early', travel: true, requiresMedAnchor: true },
  { re: /\b(we|I|they|we'?re)\s+(leave|leaving|fly|flying)\s+(on|to|for)\b/i, flavour: 'early', travel: true, requiresMedAnchor: true },
];

// ---- Deadline extraction ----------------------------------------------------
// Extracts both the day-count from `now` and a friendly label string.
// Travel patterns first (they're more specific) so "going away on
// Friday" wins over the generic "by Friday".

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function daysUntilWeekday(targetIdx: number, now: Date): number {
  const today = now.getDay();
  const diff = targetIdx - today;
  // 0 means "today"; we treat it as the same day. Negative means it
  // already passed this week → roll forward to next week.
  if (diff < 0) return diff + 7;
  return diff;
}

interface DeadlineMatch {
  days: number;
  label: string;
}

function detectDeadline(text: string, now: Date): DeadlineMatch | null {
  // Travel-specific phrases first.
  const travelPatterns: RegExp[] = [
    /\b(going\s+away|leave|leaving|flying|fly|travelling|traveling)\s+(on|next)\s+(this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(holiday|trip)\s+(starts?|begins?)\s+(on|next)?\s*(this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  ];
  for (const re of travelPatterns) {
    const m = text.match(re);
    if (m) {
      const day = m[m.length - 1].toLowerCase();
      if (day in WEEKDAYS) {
        const idx = WEEKDAYS[day];
        return { days: daysUntilWeekday(idx, now), label: WEEKDAY_NAMES[idx] };
      }
    }
  }

  // Generic "by/before <weekday>"
  const byWeekday = text.match(/\b(by|before)\s+(this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (byWeekday) {
    const day = byWeekday[3].toLowerCase();
    const idx = WEEKDAYS[day];
    let days = daysUntilWeekday(idx, now);
    if (/next\s+/i.test(byWeekday[2] ?? '')) days = days === 0 ? 7 : days + 7;
    return { days, label: WEEKDAY_NAMES[idx] };
  }

  // "by the weekend"
  if (/\b(by|before)\s+(the\s+)?weekend\b/i.test(text)) {
    return { days: daysUntilWeekday(5, now), label: 'the weekend' };
  }

  // "by next week"
  if (/\bby\s+next\s+week\b/i.test(text)) return { days: 7, label: 'next week' };

  // "by/before the 15th" — date-of-month. Pick the next occurrence:
  // if the day number is later this month, use it; else next month.
  const dom = text.match(/\b(by|before)\s+(the\s+)?(\d{1,2})(st|nd|rd|th)\b/i);
  if (dom) {
    const target = parseInt(dom[3], 10);
    if (target >= 1 && target <= 31) {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      let candidate = new Date(today.getFullYear(), today.getMonth(), target);
      if (candidate < today) {
        candidate = new Date(today.getFullYear(), today.getMonth() + 1, target);
      }
      const days = Math.round((candidate.getTime() - today.getTime()) / 86400000);
      return { days, label: `the ${target}${dom[4]}` };
    }
  }

  return null;
}

// ---- Patient name extraction ------------------------------------------------
// Conservative — only fires when there's a clear sentence-initial
// proper noun preceding action language ("X is running low",
// "X needs more"), or a "for X" / "script for X" pattern. False
// positives are worse than misses here because the clinician can
// always type the name in.

const NAME_PATTERNS: RegExp[] = [
  /(?:^|\.\s+)([A-Z][a-z]{1,20})\s+is\s+(running\s+low|going\s+away|nearly\s+out)/m,
  /(?:^|\.\s+)([A-Z][a-z]{1,20})\s+(needs|has\s+run\s+out)/m,
  /\bscript\s+for\s+([A-Z][a-z]{1,20})\b/,
  /\bprescription\s+for\s+([A-Z][a-z]{1,20})\b/,
  /\bfor\s+([A-Z][a-z]{1,20})'s\s+(next|repeat|early)\b/,
];

// Words that LOOK capitalised but aren't names — used to filter out
// false matches like "Could you send a script" → "Could".
const NAME_BLOCKLIST = new Set<string>([
  'Could', 'Would', 'Should', 'Please', 'Thanks', 'Thank', 'Hi', 'Hello',
  'Dear', 'Best', 'Regards', 'Kind', 'Many', 'The', 'This', 'That', 'We',
  'They', 'My', 'Our', 'His', 'Her', 'Ritalin', 'Concerta', 'Strattera',
  'Vyvanse', 'Aripiprazole', 'Sertraline', 'Fluoxetine', 'Risperidone',
  'Melatonin', 'Quetiapine', 'Olanzapine', 'Clonidine', 'Guanfacine',
]);

function detectPatient(text: string): string | null {
  for (const re of NAME_PATTERNS) {
    const m = text.match(re);
    if (m && !NAME_BLOCKLIST.has(m[1])) return m[1];
  }
  return null;
}

// ---- Medication + dose + quantity ------------------------------------------

function detectMedication(text: string): { name: string | null; dose: string | null; controlled: boolean } {
  const lower = text.toLowerCase();
  let earliest: { name: string; idx: number } | null = null;
  for (const med of MEDICATIONS) {
    const idx = lower.indexOf(med);
    if (idx === -1) continue;
    // Word-boundary check so "ritalin" doesn't match inside "ritalinish".
    const before = idx === 0 ? ' ' : lower[idx - 1];
    const after = lower[idx + med.length] ?? ' ';
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
    if (!earliest || idx < earliest.idx) earliest = { name: med, idx };
  }
  if (!earliest) return { name: null, dose: null, controlled: false };

  // Dose: look within ~30 chars after the medication name for `Nmg` /
  // `N mg` / `Nmcg` / `Nml`.
  const window = text.slice(earliest.idx, earliest.idx + earliest.name.length + 30);
  const doseMatch = window.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)\b/i);
  const dose = doseMatch ? `${doseMatch[1]}${doseMatch[2].toLowerCase()}` : null;

  // Capitalise medication name for display ("ritalin" → "Ritalin").
  // Use the original-cased substring from the text where possible.
  const original = text.substr(earliest.idx, earliest.name.length);
  const display = original[0].toUpperCase() + original.slice(1).toLowerCase();
  return {
    name: display,
    dose,
    controlled: CONTROLLED_DRUGS.has(earliest.name),
  };
}

function detectQuantity(text: string): string | null {
  const tablets = text.match(/\b(\d+)\s+(tablet|capsule|pill)s?\b/i);
  if (tablets) return `${tablets[1]} ${tablets[2].toLowerCase()}s`;
  const supply = text.match(/\b(one|two|three|a|next)\s+month(?:'s|s)?\s+(supply|worth)\b/i);
  if (supply) return `${supply[1].toLowerCase()} month's ${supply[2].toLowerCase()}`;
  return null;
}

function detectInternationalHint(text: string): boolean {
  return /\b(abroad|overseas|international(?:ly)?)\b/i.test(text);
}

// ---- Public entry point -----------------------------------------------------

export interface PrescriptionDetectInput {
  from: string;
  subject: string;
  body: string;
}

export function detectPrescriptionRequest(
  email: PrescriptionDetectInput,
  now: Date = new Date(),
): PrescriptionRequest | null {
  const text = `${email.subject ?? ''}\n${email.body ?? ''}`;

  let firedRule: TriggerRule | null = null;
  let evidence = '';
  for (const rule of TRIGGER_RULES) {
    const m = text.match(rule.re);
    if (m) {
      firedRule = rule;
      evidence = m[0].trim();
      break;
    }
  }
  if (!firedRule) return null;

  const med = detectMedication(text);
  // For weak triggers (running low / run out / travel patterns), we
  // require a medication anchor — otherwise we'd false-positive on
  // "we are going away on Friday" (no clinical context). Explicit
  // patterns ('repeat prescription', 'script', 'lost prescription')
  // pass through without needing a medication match.
  if (firedRule.requiresMedAnchor && !med.name) return null;

  // Travel patterns force "early" flavour even if a separate
  // "repeat" trigger also matched.
  const travelMentioned =
    !!firedRule.travel ||
    /\b(going\s+away|travelling|traveling|holiday|trip|fly(?:ing)?|leaving)\b/i.test(text);
  const flavour: PrescriptionFlavour = travelMentioned ? 'early' : firedRule.flavour;

  const deadline = detectDeadline(text, now);

  return {
    flavour,
    travelMentioned,
    internationalTravelHint: detectInternationalHint(text),
    medicationName: med.name,
    medicationDose: med.dose,
    medicationQuantity: detectQuantity(text),
    patientName: detectPatient(text),
    controlledDrug: med.controlled,
    deadlineDays: deadline?.days ?? null,
    deadlineLabel: deadline?.label ?? null,
    evidence,
  };
}

// ---- Time estimates per spec ------------------------------------------------
// Repeat prescription (standard)         3 min
// Early prescription (standard med)      5 min
// Early prescription (controlled drug)   8 min
// Lost prescription reissue              5 min
export function estimateMinutes(p: PrescriptionRequest): number {
  if (p.flavour === 'lost') return 5;
  if (p.flavour === 'early') return p.controlledDrug ? 8 : 5;
  return 3; // repeat
}

// Suggested task title — matches the spec format
//   "Write early script — Ritalin 54mg — James"
export function suggestedTaskTitle(p: PrescriptionRequest): string {
  const verb =
    p.flavour === 'lost'
      ? 'Reissue lost script'
      : p.flavour === 'early'
        ? 'Write early script'
        : 'Repeat script';
  const med = [p.medicationName, p.medicationDose].filter(Boolean).join(' ');
  const parts = [verb, med || 'prescription'];
  if (p.patientName) parts.push(p.patientName);
  return parts.join(' — ');
}

// Per spec: due date is ALWAYS one day BEFORE the family deadline
// (safety buffer). Returns null when no deadline was extracted.
// Floors at 0 — never produce a negative due-in-days.
export function taskDueDays(p: PrescriptionRequest): number | null {
  if (p.deadlineDays === null) return null;
  return Math.max(0, p.deadlineDays - 1);
}

// Drives the URGENT escalation rule:
//   ≤ 3 days → urgent + red banner
//   ≤ 7 days → urgent
//   else     → normal
export type UrgencyLevel = 'critical' | 'urgent' | 'normal';
export function urgencyFor(p: PrescriptionRequest): UrgencyLevel {
  if (p.deadlineDays === null) return 'normal';
  if (p.deadlineDays <= 3) return 'critical';
  if (p.deadlineDays <= 7) return 'urgent';
  return 'normal';
}

export function todayLabel(now: Date = new Date()): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${WEEKDAY_NAMES[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
}
