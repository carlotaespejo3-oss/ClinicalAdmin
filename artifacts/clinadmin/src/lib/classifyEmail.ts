import type { Email, AiClassification, AiCategory, AiPriority } from './types';
import { detectDocumentRequest } from './documentDetect';

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
  "registrationDeadline": "<registration deadline if CPD and detectable, else null>",
  "documentDirection": "<one of 'outgoing' | 'incoming' | 'unclear' | null. CRITICAL distinction:
      - 'outgoing'  → the sender is asking the CLINICIAN to PRODUCE a document (NDIS report request, EHCP letter request, court report, school support letter request, insurance certificate request, medical certificate request, referral letter request). Cues: 'please complete', 'please provide', 'we need a letter/report', 'could you write', 'requesting a letter/report', 'we would be grateful if you could provide', 'please fill in', 'can you send us'.
      - 'incoming'  → the sender is sending the CLINICIAN a document FOR INFORMATION (a colleague sharing their psych assessment, a GP sharing a discharge summary, allied health sharing a progress note, school sharing a report, pathology sharing results). Cues: 'please find attached', 'I am sending you', 'attached is', 'enclosed', 'for your information', 'for your records', 'I wanted to share', 'I hope this is helpful'.
      - 'unclear'   → a document is mentioned but you cannot tell direction with confidence.
      - null        → no document is involved at all.
      Never set 'outgoing' just because the email mentions a document — ONLY when the sender is asking the clinician to write/produce one.>",
  "requiresDocument": <true ONLY if documentDirection is 'outgoing'. false for 'incoming', 'unclear', or null. This drives task creation and time estimates, so only set true when you are confident the clinician must produce something.>,
  "documentType": "<short label like 'NDIS report', 'EHCP letter', 'Medical certificate', 'Court report', 'Insurance form', 'Psychological assessment', 'Discharge summary' if a document is involved (any direction); else null>",
  "documentDueDays": <integer days from today the document is due if requiresDocument and a deadline is mentioned; else null>
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

  // Document detection — direction-aware. Combine the AI's
  // documentDirection with the regex heuristic. Either source can flag a
  // document; once a document is detected, direction is decided as:
  //   - if either source says 'outgoing' → 'outgoing' (action wins,
  //     because an unmade task is worse than an extra "received" badge)
  //   - else if either source says 'incoming' → 'incoming'
  //   - else 'unclear'
  // requiresDocument is then set ONLY when direction is 'outgoing', so
  // the linked task and combined time block don't fire for FYI emails.
  const aiDocDir = asString(parsed?.documentDirection as unknown);
  const aiDirection: 'incoming' | 'outgoing' | 'unclear' | null =
    aiDocDir === 'outgoing' || aiDocDir === 'incoming' || aiDocDir === 'unclear'
      ? aiDocDir
      : null;
  const aiRequiresDoc = parsed?.requiresDocument === true;
  const aiDocType = asString(parsed?.documentType as unknown);
  const aiDocDueRaw = parsed?.documentDueDays;
  const aiDocDue =
    typeof aiDocDueRaw === 'number' && Number.isFinite(aiDocDueRaw) && aiDocDueRaw >= 0
      ? Math.round(aiDocDueRaw)
      : null;
  const heuristic = detectDocumentRequest(email);

  const hasDocument = heuristic.hasDocument || aiDirection !== null || aiRequiresDoc;
  let documentDirection: 'incoming' | 'outgoing' | 'unclear' | null = null;
  if (hasDocument) {
    // Direction requires explicit directional evidence — never derive
    // 'outgoing' from a bare requiresDocument flag, because a stale or
    // contradictory AI payload (e.g. direction='incoming' AND
    // requiresDocument=true) would otherwise spawn a false-positive task.
    // We only honour requiresDocument when no source contradicts it
    // (i.e. it acts as a tiebreaker that nudges 'unclear' → 'outgoing').
    if (aiDirection === 'outgoing' || heuristic.direction === 'outgoing') {
      documentDirection = 'outgoing';
    } else if (aiDirection === 'incoming' || heuristic.direction === 'incoming') {
      documentDirection = 'incoming';
    } else if (aiRequiresDoc) {
      documentDirection = 'outgoing';
    } else {
      documentDirection = 'unclear';
    }
  }
  const requiresDocument = documentDirection === 'outgoing';
  const documentType = hasDocument
    ? (aiDocType ?? heuristic.documentType ?? asString(parsed?.documentRequested as unknown))
    : null;
  const documentDueDays = requiresDocument ? (aiDocDue ?? heuristic.documentDueDays) : null;

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
    documentDirection,
    requiresDocument,
    documentType,
    documentDueDays,
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
