import type { Email, AiClassification } from './types';
import { detectRecipientType, getSignatureForRecipient } from './signatures';
import { getStyleGuidanceForRecipient } from './styleProfile';

// Default sign-off for Dr. Patterson (AU child & adolescent psychiatrist).
// Used only when the user has not configured a per-recipient signature in
// Settings. Matches the AU context for Step 3 of the email triage redesign.
const DEFAULT_AU_SIGNATURE =
  'Dr. A. Patterson | Consultant Child & Adolescent Psychiatrist';

function signOffFor(email: Email): string {
  const sig = getSignatureForRecipient(detectRecipientType(email));
  return sig && sig.trim() ? sig : DEFAULT_AU_SIGNATURE;
}

function styleBlockFor(email: Email): string {
  const guidance = getStyleGuidanceForRecipient(detectRecipientType(email));
  return guidance
    ? `\n\nSTYLE GUIDANCE (match the clinician's learned voice for this recipient type — mirror greeting, tone and key phrasing):\n${guidance}`
    : '';
}

const COMMON_HEADER =
  'Dr. A. Patterson is an Australian Consultant Child & Adolescent Psychiatrist. Use Australian English (no Britishisms, no NHS, no CAMHS, no "A&E", no "999", no "Samaritans").';

// AU crisis numbers — used in SAFEGUARDING family drafts.
const AU_CRISIS_BLOCK = `If there is immediate risk to life, call 000 (Australian emergency services) or attend the nearest hospital Emergency Department.
For 24/7 mental health crisis support: Lifeline 13 11 14.
For young people: Kids Helpline 1800 55 1800 (free, 24/7, ages 5–25).`;

function emailBodyBlock(email: Email): string {
  return `Incoming email:\nFrom: ${email.from}\nSubject: ${email.subject}\n---\n${email.body}`;
}

function returnOnlyBody(): string {
  return 'Return ONLY the email body (greeting, paragraphs, sign-off). No preamble, no headings, no commentary.';
}

// ---- SAFEGUARDING ----
// Dual draft: a compassionate holding reply to the family AND an urgent
// internal note to the admin/booking team. NO specific clinical advice in the
// family reply — only the AU crisis numbers and an arrangement to be seen.
export function buildSafeguardingFamilyPrompt(email: Email, c?: AiClassification): string {
  const patient = c?.patientName ? `\nPatient name (use as it appears): ${c.patientName}` : '';
  return `${COMMON_HEADER}

Draft a compassionate INTERIM ACKNOWLEDGEMENT to the family. This is a SAFEGUARDING situation — the family deserves a warm, prompt reply, but the email cannot safely contain specific clinical advice.

The reply MUST:
- Acknowledge the parent's distress and thank them for letting us know.
- Make clear that what they have described needs proper clinical assessment by phone or face-to-face, and that we are arranging this urgently.
- Do NOT give specific clinical advice about the patient.
- Include general interim safety guidance:
  • Remove or secure sharps and any items that could be used for self-harm.
  • Lock medications away.
- Include the following Australian crisis numbers EXACTLY (do not substitute UK or US equivalents):
${AU_CRISIS_BLOCK}
- Be warm, plain, and unhurried in tone — not clinical jargon.
- End with EXACTLY this sign-off (do not modify):
${signOffFor(email)}${styleBlockFor(email)}${patient}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

export function buildSafeguardingAdminPrompt(email: Email, c?: AiClassification): string {
  const patient = c?.patientName ? c.patientName : 'the patient referenced in the email';
  return `${COMMON_HEADER}

Draft a SHORT internal email to the practice admin / booking team asking them to book ${patient} in URGENTLY for a clinical review (telephone or face-to-face) — this is a SAFEGUARDING flag raised by the family today.

Rules:
- Address the admin team (e.g. "Hi team,").
- Reference ${patient} and the requesting clinician (Dr. A. Patterson).
- Keep it to a few sentences. No clinical detail beyond what is needed to prioritise the booking (e.g. "raised today by parent, safeguarding concern, needs urgent review").
- Do NOT quote the parent's wording.
- Ask them to confirm once booked and to flag back if no slot is available within 24 hours.
- End with EXACTLY this sign-off:
${signOffFor(email)}

${returnOnlyBody()}

Context:
From: ${email.from}
Subject: ${email.subject}`;
}

// ---- URGENT_CLINICAL (severe but no safeguarding) ----
// Dual draft: holding reply to the family + urgent admin booking. The family
// reply is allowed to be slightly more specific than the SAFEGUARDING one, but
// still routes to phone/face-to-face review.
export function buildUrgentClinicalFamilyPrompt(email: Email, c?: AiClassification): string {
  const patient = c?.patientName ? `\nPatient name: ${c.patientName}` : '';
  return `${COMMON_HEADER}

Draft a prompt, warm INTERIM REPLY to the family. This is an URGENT CLINICAL situation (severe symptoms or escalation) but NOT a safeguarding concern.

The reply MUST:
- Acknowledge the family's concern and thank them for getting in touch.
- Explain that what they have described needs a phone or face-to-face clinical review, and that we are arranging this within the next working day.
- Avoid prescribing specific medication changes by email — defer to the review.
- Be warm and plain in tone.
- End with EXACTLY this sign-off:
${signOffFor(email)}${styleBlockFor(email)}${patient}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

export function buildUrgentClinicalAdminPrompt(email: Email, c?: AiClassification): string {
  const patient = c?.patientName ? c.patientName : 'the patient';
  return `${COMMON_HEADER}

Draft a SHORT internal email to the admin / booking team asking them to book ${patient} for an URGENT clinical review within the next working day. This is NOT a safeguarding flag — a clinical escalation only.

Rules:
- Address the admin team.
- Reference ${patient} and Dr. A. Patterson.
- Keep it to a few sentences. No detailed clinical information.
- End with EXACTLY this sign-off:
${signOffFor(email)}

${returnOnlyBody()}

Context:
From: ${email.from}
Subject: ${email.subject}`;
}

// ---- CLINICAL (routine clinical question / script / dose check) ----
export function buildClinicalPrompt(email: Email): string {
  return `${COMMON_HEADER}

Draft a clinical reply on behalf of Dr. A. Patterson.

Rules:
- This is a routine clinical question (not a safeguarding or urgent escalation).
- Be clear, concise and professional. Plain language for families; collegial for professionals.
- For controlled drugs: acknowledge the request and confirm next step (e.g. issue script, ask for a review) — do NOT include dosing in the reply unless explicitly safe to do so.
- For dose checks / script renewals: confirm the plan briefly.
- End with EXACTLY this sign-off:
${signOffFor(email)}${styleBlockFor(email)}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

// ---- PROFESSIONAL (colleagues — sub-type aware) ----
export function buildProfessionalPrompt(email: Email, c?: AiClassification): string {
  const sub = c?.professionalSubType;
  let intent = 'Reply collegially to the colleague — direct, brief, and decisive about next steps.';
  if (sub === 'clinical_input') {
    intent = 'The colleague is asking for clinical input. Provide a focused clinical opinion if straightforward, or propose a short call/MDT slot if the case needs discussion.';
  } else if (sub === 'document_request') {
    const doc = c?.documentRequested ? `: "${c.documentRequested}"` : '';
    intent = `The colleague has requested a clinical document${doc}. Acknowledge the request, confirm a realistic turnaround, and say it will be added to the documents-to-write task list.`;
  } else if (sub === 'meeting') {
    intent = 'The colleague is coordinating a meeting / joint appointment. Reply collegially with availability or propose two concrete options.';
  }
  return `${COMMON_HEADER}

Draft a reply to a fellow professional (GP, psychologist, allied health, school MH lead, paediatrician, etc).

Rules:
- ${intent}
- Collegial, direct, no preamble.
- End with EXACTLY this sign-off:
${signOffFor(email)}${styleBlockFor(email)}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

// ---- ADMIN ----
export function buildAdminPrompt(email: Email): string {
  return `${COMMON_HEADER}

Draft a brief, decisive admin reply (booking, room change, rota, scheduling, form).

Rules:
- Keep it short and matter-of-fact.
- End with EXACTLY this sign-off:
${signOffFor(email)}${styleBlockFor(email)}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

// ---- NONE / CPD on-demand acknowledgement ----
// Only generated if the clinician explicitly asks for one (button click).
export function buildAcknowledgementPrompt(email: Email): string {
  return `${COMMON_HEADER}

Draft a one or two sentence polite acknowledgement reply. The email does not need a substantive answer — this is just a courtesy reply.

End with EXACTLY this sign-off:
${signOffFor(email)}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

// ---- Prescription / script request ----
// Used INSTEAD of buildClinicalPrompt when a prescription request was
// detected deterministically. Bakes in:
//   - confirmation that the script will be arranged
//   - an expected-by date one day before the family's deadline
//   - controlled-drug acknowledgement (no dosing in the reply)
//   - international travel note when the email hints at travel abroad
export function buildPrescriptionPrompt(email: Email, c?: AiClassification): string {
  const p = c?.prescriptionRequest;
  const med = p
    ? [p.medicationName, p.medicationDose].filter(Boolean).join(' ')
    : 'the requested medication';
  const patient = p?.patientName ?? c?.patientName ?? null;
  const flavour = p?.flavour ?? 'repeat';
  const verb = flavour === 'lost' ? 'reissue' : flavour === 'early' ? 'arrange an early' : 'arrange a repeat';
  const deadlineLine = p?.deadlineLabel
    ? `\n- Confirm they will receive the script BEFORE ${p.deadlineLabel} (i.e. one day earlier where possible, as a safety buffer).`
    : '\n- Give a realistic expected timeframe (within the next working day or two).';
  const controlledLine = p?.controlledDrug
    ? '\n- This is a controlled drug — do NOT include any dosing information in the reply. Acknowledge the request and confirm the script will be reviewed and issued.'
    : '';
  const travelLine = p?.travelMentioned
    ? '\n- Add a short note: "If you are travelling internationally, please let us know — some medications have additional requirements for travel."'
    : '';
  const patientLine = patient ? `\nPatient name (use as it appears): ${patient}` : '';
  return `${COMMON_HEADER}

Draft a warm, practical reply confirming the prescription request will be handled.

Rules:
- Thank them for letting us know.
- Confirm that you will ${verb} script for ${med}${patient ? ` for ${patient}` : ''}.${deadlineLine}${controlledLine}${travelLine}
- Keep it to a few short sentences — warm and reassuring, not clinical.
- Invite them to contact the practice if the script has not arrived by the expected date.
- End with EXACTLY this sign-off:
${signOffFor(email)}${styleBlockFor(email)}${patientLine}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

// ---- Mini chat box: ad-hoc additional draft from clinician's own instruction ----
export function buildExtraDraftPrompt(email: Email, instruction: string): string {
  return `${COMMON_HEADER}

The clinician wants an ADDITIONAL draft for the email below, based on this specific instruction:

"${instruction.trim()}"

Rules:
- Follow the instruction precisely.
- End with EXACTLY this sign-off:
${signOffFor(email)}${styleBlockFor(email)}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

// ---- Mini chat: freeform conversation about the open email ----
//
// The chat box supports two intents in a single thread:
//   1. Writing or revising a reply draft ("decline politely", "make it warmer")
//   2. Answering a clinical / literature / practical question
//      ("what's the evidence for X in adolescents?", "is Y safe with Z?")
//
// The AI replies with a small JSON envelope so the client knows which kind it
// is — drafts get a copy-to-clipboard button, answers render as prose.
// Anything that fails to parse falls back to a plain answer.
//
// `sourcesChecked` (assistant turns only) lists the IDs of registered
// evidence sources the AI drew on for this turn. Resolved to names + URLs
// at render time from the live sources Map — IDs only on the turn keeps
// the thread small and ensures the link target is always the current
// registered URL, not a stale copy.
export type ChatTurn = {
  role: 'clinician' | 'assistant';
  kind: 'draft' | 'answer';
  content: string;
  sourcesChecked?: number[];
  // True if the model returned source IDs that didn't exist in the
  // registry — the pill surfaces this as a warning so an "empty"
  // sources list isn't mistaken for "answered from general knowledge".
  hadInvalidSources?: boolean;
};

// Minimal shape buildChatPrompt needs from the registry — id + name +
// title + year. Matches RegistryItem in evidenceStore so the call site
// can pass `getRegistrySnapshot()` straight in.
export interface ChatPromptSource {
  id: number;
  tier: number;
  sourceName: string;
  title: string;
  year: number;
}

function renderHistory(history: ChatTurn[]): string {
  if (history.length === 0) return '(no prior turns)';
  return history
    .map((t) => {
      if (t.role === 'clinician') return `[clinician]: ${t.content}`;
      const label = t.kind === 'draft' ? '[assistant draft]' : '[assistant answer]';
      return `${label}: ${t.content}`;
    })
    .join('\n\n');
}

function renderRegistry(registry: ChatPromptSource[]): string {
  if (registry.length === 0) return '(no registered sources available — answer from general clinical knowledge only)';
  // Sorted by tier then year (newest first) so the highest-quality
  // guidelines lead. Ordering is informational only; the AI picks
  // whichever entries are relevant.
  const sorted = [...registry].sort((a, b) => a.tier - b.tier || b.year - a.year);
  return sorted
    .map((s) => `  [${s.id}] tier ${s.tier} — ${s.sourceName} (${s.year}): ${s.title}`)
    .join('\n');
}

export function buildChatPrompt(
  email: Email,
  history: ChatTurn[],
  userMessage: string,
  registry: ChatPromptSource[] = [],
): string {
  return `${COMMON_HEADER}

You are a clinical assistant for the consultant. They are looking at the email below and chatting with you about it. You can do two things:

1) WRITE OR REVISE A DRAFT REPLY when they ask for one ("draft a polite decline", "rewrite as a one-liner", "make it warmer").
2) ANSWER A CLINICAL / LITERATURE / PRACTICAL QUESTION concisely ("what's the evidence for X in adolescents?", "is Y safe with Z?", "what does the RANZCP guidance say about Z?"). Cite specific guidelines or papers by name where you can. The clinician knows the field — be brief and practical, not introductory.

REGISTERED EVIDENCE SOURCES AVAILABLE TO YOU (cite by id when you draw on them):
${renderRegistry(registry)}

Reply as a SINGLE JSON object only — no markdown fences, no preamble, no commentary outside the JSON:

{ "kind": "draft", "body": "...", "sources_checked": [<ids>] }     ← use when writing or revising a reply
{ "kind": "answer", "text": "...", "sources_checked": [<ids>] }    ← use for everything else

"sources_checked" MUST be an array of source IDs from the list above that you actually consulted for this turn. Use [] (empty array) if you answered from general clinical knowledge only — do NOT invent IDs. For pure draft-writing turns that don't need clinical evidence (e.g. "make it warmer", "shorten it"), [] is correct.

Use "draft" ONLY when the clinician has clearly asked for a reply to be written or revised. If you are unsure, use "answer".

Drafts MUST end with EXACTLY this sign-off (do not modify):
${signOffFor(email)}${styleBlockFor(email)}

${emailBodyBlock(email)}

Conversation so far:
${renderHistory(history)}

Most recent clinician message:
${userMessage.trim()}

Respond now with the JSON envelope only.`;
}
