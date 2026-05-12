import type { Email, AiClassification, AiCategory, AiPriority } from './types';

const VALID_CATEGORIES: readonly AiCategory[] = [
  'SAFEGUARDING',
  'URGENT_CLINICAL',
  'CLINICAL',
  'PROFESSIONAL',
  'ADMIN',
  'LEGAL',
  'NONE',
  'CPD',
  'UNCLEAR',
];

const VALID_PRIORITIES: readonly AiPriority[] = ['URGENT', 'MEDIUM', 'LOW', 'UNCLEAR'];

const VALID_PROF_SUBTYPES = ['clinical_input', 'document_request', 'meeting'] as const;

export type RunPrompt = (prompt: string) => Promise<string>;

const buildPrompt = (email: Email) => `You are an email triage assistant for Dr. A. Patterson, an Australian child & adolescent psychiatrist.

Classify ONE incoming email into the categories and priorities below. Return ONLY a single valid JSON object — no preamble, no markdown fences, no commentary.

CATEGORIES (pick exactly one):
- SAFEGUARDING — any mention of self-harm, suicidal ideation, abuse, neglect, risk to a child or vulnerable person, or a family expressing acute distress about safety. If there is ANY doubt about safety, choose SAFEGUARDING.
- URGENT_CLINICAL — severe symptoms, severe behavioural escalation, family in crisis, but NO safeguarding concern.
- CLINICAL — clinical questions about symptoms, medication doses, script renewals, dose checks, simple clinical advice, routine clinical decisions.
- PROFESSIONAL — emails from colleagues (psychology, GP, school MH lead, allied health, other doctors) who are waiting on the clinician. Detect sub-type:
    * clinical_input — they want a clinical opinion or input
    * document_request — they want a report, letter, or referral document
    * meeting — coordinating a meeting/joint appointment
- ADMIN — bookings, room changes, rota changes, forms, scheduling.
- LEGAL — medico-legal correspondence, complaints with legal implications, court-related.
- NONE — no action required: newsletters, bulletins, FYI cc'd threads, marketing.
- CPD — meetings, conferences, courses, or other continuing professional development. Extract any registration deadline.
- UNCLEAR — does not clearly fit any of the above. Use this if you are unsure.

PRIORITIES (pick exactly one):
- URGENT — medication side effect query, mental health/safety concern, behavioural escalation, physical symptoms, any safeguarding concern.
- MEDIUM — medication dose adjustment request, blood test/result query, complaint/dissatisfaction, communication from allied health/GP/school/other doctors, legal correspondence.
- LOW — prescription request, lost or misplaced medication, school letter request, NDIS/report/form request, appointment request, billing/admin question, triage requests, general admin.
- UNCLEAR — does not fit any priority above.

OUTPUT JSON SHAPE (exact keys, no extras):
{
  "category": "<one of the 9 categories>",
  "priority": "<one of the 4 priorities>",
  "confidence": <number from 0.0 to 1.0>,
  "reasoning": "<one short sentence explaining the choice>",
  "professionalSubType": "clinical_input" | "document_request" | "meeting" | null,
  "patientName": "<patient name if detectable in the email, else null>",
  "documentRequested": "<short description of document if PROFESSIONAL+document_request, else null>",
  "eventDate": "<event/meeting date if CPD and detectable, else null>",
  "registrationDeadline": "<registration deadline if CPD and detectable, else null>"
}

EMAIL TO CLASSIFY:
From: ${email.from}
Subject: ${email.subject}
---
${email.body}`;

function tryParseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // Strip common markdown fences
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    /* try to extract first {...} block */
  }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export async function classifyEmail(email: Email, runPrompt: RunPrompt): Promise<AiClassification> {
  const text = await runPrompt(buildPrompt(email));
  const parsed = tryParseJson(text);

  const rawCategory = asString(parsed?.category as unknown);
  const category: AiCategory =
    rawCategory && (VALID_CATEGORIES as readonly string[]).includes(rawCategory) ? (rawCategory as AiCategory) : 'UNCLEAR';

  const rawPriority = asString(parsed?.priority as unknown);
  const priority: AiPriority =
    rawPriority && (VALID_PRIORITIES as readonly string[]).includes(rawPriority) ? (rawPriority as AiPriority) : 'UNCLEAR';

  const rawConfidence = parsed?.confidence;
  const confidence = typeof rawConfidence === 'number' && isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0;

  const rawSubType = asString(parsed?.professionalSubType as unknown);
  const professionalSubType =
    rawSubType && (VALID_PROF_SUBTYPES as readonly string[]).includes(rawSubType)
      ? (rawSubType as AiClassification['professionalSubType'])
      : null;

  return {
    emailId: email.id,
    category,
    priority,
    confidence,
    reasoning: asString(parsed?.reasoning as unknown) ?? '',
    classifiedAt: Date.now(),
    professionalSubType,
    patientName: asString(parsed?.patientName as unknown),
    documentRequested: asString(parsed?.documentRequested as unknown),
    eventDate: asString(parsed?.eventDate as unknown),
    registrationDeadline: asString(parsed?.registrationDeadline as unknown),
  };
}

// Run a small concurrent worker pool over a list of emails. Each result is
// reported via onResult as soon as it lands so the UI can update incrementally.
export async function classifyQueue(
  emails: Email[],
  runPrompt: RunPrompt,
  onResult: (c: AiClassification) => void,
  opts: { concurrency?: number; signal?: AbortSignal; onError?: (id: number, err: unknown) => void } = {},
): Promise<void> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const queue = [...emails];
  const worker = async () => {
    while (queue.length > 0 && !opts.signal?.aborted) {
      const email = queue.shift();
      if (!email) return;
      try {
        const c = await classifyEmail(email, runPrompt);
        if (!opts.signal?.aborted) onResult(c);
      } catch (err) {
        opts.onError?.(email.id, err);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
