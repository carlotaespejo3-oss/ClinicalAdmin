import type { Email, AiClassification, AiCategory, AiPriority } from './types';
import { detectDocumentRequest } from './documentDetect';
import { detectPrescriptionRequest, urgencyFor } from './prescriptionDetect';

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
  "documentDueDays": <integer days from today the document is due if requiresDocument and a deadline is mentioned; else null>,
  "complexity": "<'simple' or 'complex'. Judge based on CONTENT, not length. A short email can be complex; a long email can be simple. Choose 'complex' when the reply is likely to take meaningfully longer than a routine email of the same category because of any of the COMPLEXITY SIGNALS below.>",
  "complexityReasons": ["<short, user-facing phrases — at most 3 — naming the specific signals you used. Use the canonical labels from the list below verbatim. Empty array when complexity='simple'.>"]
}

COMPLEXITY SIGNALS (use these exact labels in complexityReasons):
- "Multiple distinct issues" — the sender raises two or more separate clinical/admin matters that each need addressing.
- "Emotionally charged" — distressed parent, complaint, frustration, grief, sensitive disclosure, or anything requiring careful tone.
- "Ambiguous symptoms" — symptoms or situation are described in a way that needs clarification before a decision can be made.
- "Records review needed" — replying well requires looking up the patient's history, prior letters, dosing history, or test results.
- "Multi-party coordination" — requires checking with or copying in a school, GP, allied health, family, or service.
- "Clinical risk / uncertainty" — diagnostic uncertainty, medication risk, or a decision with non-trivial downside if wrong.
- "Long detailed history" — body contains a substantial chronological/clinical history the clinician must read carefully (use this rather than just "long email").
Do NOT invent new labels. If none of these apply, set complexity='simple' and complexityReasons=[].

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
  // Complexity assessment — content-driven, judged by the AI alongside
  // category/priority. We accept the value if it's one of the two
  // canonical strings; anything else (older payloads, hallucinated
  // values, parse failures) collapses to null and the downstream
  // heuristic in estimateMinutes still applies as a safety net.
  const rawComplexity = asString(parsed?.complexity as unknown);
  const complexity: 'simple' | 'complex' | null =
    rawComplexity === 'complex' || rawComplexity === 'simple' ? rawComplexity : null;
  const complexityReasonsRaw = parsed?.complexityReasons;
  const complexityReasons: string[] = Array.isArray(complexityReasonsRaw)
    ? complexityReasonsRaw
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => r.trim())
        .slice(0, 3)
    : [];

  const requiresDocument = documentDirection === 'outgoing';
  const documentType = hasDocument
    ? (aiDocType ?? heuristic.documentType ?? asString(parsed?.documentRequested as unknown))
    : null;
  const documentDueDays = requiresDocument ? (aiDocDue ?? heuristic.documentDueDays) : null;

  // Prescription / script request override (deterministic, per spec).
  // When the rich detector fires, force category=CLINICAL and choose
  // priority based on the deadline distance. We do NOT override when a
  // document is being produced (documentDirection='outgoing') because
  // those flows have their own task-creation path that takes priority.
  const prescriptionRequest = requiresDocument ? null : detectPrescriptionRequest(email);
  let finalCategory = category;
  let finalPriority = priority;
  if (prescriptionRequest) {
    finalCategory = 'CLINICAL';
    const urgency = urgencyFor(prescriptionRequest);
    if (urgency === 'critical' || urgency === 'urgent') {
      finalPriority = 'URGENT';
    } else if (priority === 'UNCLEAR' || priority === 'LOW') {
      // Spec: default priority MEDIUM when no urgent deadline. Don't
      // downgrade an AI-determined URGENT — only nudge LOW/UNCLEAR up.
      finalPriority = 'MEDIUM';
    }
  }

  return {
    emailId: email.id,
    category: finalCategory,
    priority: finalPriority,
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
    prescriptionRequest,
    complexity,
    complexityReasons: complexity === 'complex' ? complexityReasons : [],
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
