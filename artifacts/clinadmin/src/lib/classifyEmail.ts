import type { Email, AiClassification, AiCategory, AiPriority } from './types';
import { detectDocumentRequest } from './documentDetect';
import { detectPrescriptionRequest, urgencyFor } from './prescriptionDetect';
import { getAppSettings } from './clinicianSettingsStore';
import { getProfile } from './userProfileStore';

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

const buildPrompt = (email: Email) => {
  const { profile } = getAppSettings();
  return `You are an email triage assistant for ${profile.fullName}, an Australian ${profile.role}.

Classify ONE incoming email into the categories and priorities below. Return ONLY a single valid JSON object — no preamble, no markdown fences, no commentary.

CATEGORIES (pick exactly one):
- SAFEGUARDING — any mention of self-harm, suicidal ideation, abuse, neglect, risk to a child or vulnerable person, or a family expressing acute distress about safety. If there is ANY doubt about safety, choose SAFEGUARDING.
- URGENT_CLINICAL — severe symptoms, severe behavioural escalation, family in crisis, but NO safeguarding concern.
- CLINICAL — clinical questions about symptoms, medication doses, script renewals, dose checks, simple clinical advice, routine clinical decisions. Do NOT use for incoming referral requests — those are ADMIN.
- PROFESSIONAL — emails from colleagues (psychology, GP, school MH lead, allied health, other doctors) who are waiting on the clinician. Detect sub-type:
    * clinical_input — they want a clinical opinion or input
    * document_request — they want a report, letter, or referral document
    * meeting — coordinating a meeting/joint appointment
- ADMIN — bookings, room changes, rota changes, forms, scheduling, and ALL incoming referral requests (new patients being referred to you, requests to accept/review a referral, NP referrals, GP referrals, MSFM referrals — any email asking the clinician to take on or process a new patient). Referrals are always ADMIN even when they contain clinical details about the patient.
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
  "documentDirection": "<one of 'outgoing' | 'incoming' | 'unclear' | null. CRITICAL distinction. The DEFAULT when in doubt is 'incoming' — the clinician receives many FYI reports from colleagues that sit on the file until the next appointment and DO NOT need a reply or a task. Setting 'outgoing' incorrectly creates phantom tasks the clinician has to dismiss, which is worse than under-flagging.
      - 'outgoing'  → the sender is asking the CLINICIAN to PRODUCE a NEW document. The email must contain an EXPLICIT request directed at the clinician personally. Cues: 'please complete', 'please provide [a letter/report]', 'we need [a letter/report] from you', 'could you write', 'requesting a [letter/report]', 'we would be grateful if you could provide', 'please fill in', 'can you send us a [letter/report]', 'please draft', 'kindly forward us'. Examples: NDIS asking for a report, school asking for an EHCP letter, solicitor requesting a court report, GP asking for a referral letter, parent asking for a medical certificate.
      - 'incoming'  → the sender is sending the CLINICIAN a document FOR INFORMATION. This is the default for any email where the sender attached or shared a document and is not explicitly asking for something to be written. Cues: 'please find attached', 'I am sending you', 'attached is', 'enclosed', 'for your information', 'for your records', 'I wanted to share', 'I hope this is helpful', 'thought you might want to see', 'sharing this for context'. Examples: another psychiatrist sharing their assessment, GP sharing a discharge summary, school sharing a behaviour report, pathology sharing results, allied health sharing a progress note.
      - 'unclear'   → a document is mentioned but you genuinely cannot tell direction with confidence.
      - null        → no document is involved at all.
      RULES:
      1. Mentioning, attaching, or sharing a document does NOT make it 'outgoing'. Only an explicit request to PRODUCE something does.
      2. If the email both shares a document AND mentions something the clinician 'could' or 'might' do, that is 'incoming' unless there is a clear, direct request for a NEW document.
      3. Polite closings like 'let me know if you need anything else' do NOT count as a request — that is 'incoming'.
      4. If the document already exists (it was attached, shared, sent, enclosed) and no NEW document is being asked for, it is 'incoming'.>",
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

ALWAYS-URGENT TOPICS (clinician-defined, highest priority):
${(() => {
  const topics = getProfile().criticalKeywords;
  if (topics.length === 0) return '(none configured by this clinician)';
  return `The following clinical concerns must ALWAYS be classified as URGENT_CLINICAL (minimum) with priority URGENT, even if the rest of the email seems routine. These are CONCEPTS, not exact words — look for the meaning. Someone might describe the same concern in many different ways (e.g. "not feeling herself", "really struggling", "things have got a lot worse" can all indicate clinical deterioration):
${topics.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}
If the email content matches or strongly implies any of these topics, override your category/priority assessment and flag as URGENT_CLINICAL + URGENT.`;
})()}

EMAIL TO CLASSIFY:
From: ${email.from}
Subject: ${email.subject}
---
${email.body}`;
};

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
  //   - 'outgoing' ONLY when the agreeing source says outgoing AND the
  //     other source does NOT say incoming. (Pure outgoing or
  //     outgoing+unclear → outgoing. Outgoing+incoming → unclear.)
  //   - 'incoming' when either source says incoming AND no source says
  //     outgoing. (FYI documents are the common case for this clinic;
  //     the cost of missing an FYI badge is far smaller than the cost
  //     of an auto-created phantom task.)
  //   - 'unclear' when sources disagree, when only the AI's bare
  //     `requiresDocument` flag fires without an explicit direction,
  //     or when no directional signal is present.
  // requiresDocument is then set ONLY when direction is 'outgoing', so
  // the linked task and combined time block don't fire for FYI emails.
  // The "Was this a request?" banner asks the clinician to confirm any
  // 'unclear' case before a task is created.
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
    const aiOut = aiDirection === 'outgoing';
    const aiIn = aiDirection === 'incoming';
    const heurOut = heuristic.direction === 'outgoing';
    const heurIn = heuristic.direction === 'incoming';
    if ((aiOut || heurOut) && (aiIn || heurIn)) {
      // Direct disagreement — defer to the clinician via the unclear
      // banner rather than auto-creating a task on a likely FYI.
      documentDirection = 'unclear';
    } else if (aiOut || heurOut) {
      documentDirection = 'outgoing';
    } else if (aiIn || heurIn) {
      // FYI route — the common case. Bare `requiresDocument:true` from
      // the AI is intentionally NOT honoured here because it has been
      // the dominant source of phantom tasks on incoming reports.
      documentDirection = 'incoming';
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

  // Critical-topic safety-net override (clinician-defined, highest precedence).
  // The AI prompt already instructs semantic matching for these topics, so the
  // primary detection path is the AI itself. This deterministic pass is a
  // safety net for cases where the topic description contains a very specific
  // term that appeared literally in the email (e.g. "dialysis" → "dialysis").
  // It splits each topic description into individual words and checks for any
  // word of 6+ characters (to avoid false positives from short common words
  // like "not", "and", "she"). Semantic/paraphrase detection relies on the AI.
  const criticalTopics = getProfile().criticalKeywords;
  if (criticalTopics.length > 0 && finalCategory !== 'SAFEGUARDING' && finalCategory !== 'URGENT_CLINICAL') {
    const haystack = `${email.subject} ${email.body}`.toLowerCase();
    const hit = criticalTopics.some((topic) =>
      topic.toLowerCase().split(/\W+/).filter((w) => w.length >= 6).some((word) => haystack.includes(word))
    );
    if (hit) {
      finalCategory = 'URGENT_CLINICAL';
      finalPriority = 'URGENT';
    }
  }

  // Referral override (deterministic rule, always wins).
  // Incoming referrals are always ADMIN regardless of what the AI returns.
  // Logic: subject or body mentions "referral" AND the email is NOT asking
  // the clinician to *write* a document (requiresDocument handles that path)
  // AND it's not a safeguarding/urgent-clinical concern (don't downgrade safety).
  const REFERRAL_RE = /\breferral\b/i;
  const isReferral =
    !requiresDocument &&
    finalCategory !== 'SAFEGUARDING' &&
    finalCategory !== 'URGENT_CLINICAL' &&
    (REFERRAL_RE.test(email.subject) || REFERRAL_RE.test(email.body));
  if (isReferral) {
    finalCategory = 'ADMIN';
    // Referrals are LOW priority by default — they go in the admin queue,
    // not the urgent clinical one. Don't override an URGENT signal though
    // (a referral with a very urgent safety concern should stay URGENT).
    if (finalPriority === 'UNCLEAR' || finalPriority === 'MEDIUM') {
      finalPriority = 'LOW';
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
