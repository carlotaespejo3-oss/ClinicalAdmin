import type { Email, AiClassification } from './types';
import { detectRecipientType, getSignatureForRecipient } from './signatures';
import { getStyleGuidanceForRecipient } from './styleProfile';
import {
  getAppSettings,
  getDefaultSignatureFromProfile,
} from './clinicianSettingsStore';
import { getProfile } from './userProfileStore';

// Every prompt builder reads the clinician's profile + signature
// settings live, so changing the name/role in Settings flows through
// to the next draft generated. No hardcoded clinician name lives in
// this file — the AI is always instructed to write in the first
// person as whoever is currently signed in.

function signOffFor(email: Email): string {
  const sig = getSignatureForRecipient(detectRecipientType(email));
  if (sig && sig.trim()) return sig;
  return getDefaultSignatureFromProfile(getAppSettings().profile);
}

function styleBlockFor(email: Email): string {
  const guidance = getStyleGuidanceForRecipient(detectRecipientType(email));
  return guidance
    ? `\n\nSTYLE GUIDANCE (match the clinician's learned voice for this recipient type — mirror greeting, tone and key phrasing):\n${guidance}`
    : '';
}

const TONE_INSTRUCTION: Record<string, string> = {
  'formal':      'Write in a formal, professional tone — traditional, structured, full sentences.',
  'semi-formal': 'Write in a warm but professional tone — friendly yet businesslike, approachable without being casual.',
  'informal':    'Write in a relaxed, conversational tone — friendly and direct, as you would with a trusted colleague.',
};

function commonHeader(): string {
  const { profile } = getAppSettings();
  const tone = getProfile().defaultReplyTone;
  const toneInstruction = TONE_INSTRUCTION[tone] ?? TONE_INSTRUCTION['semi-formal'];
  return `You are ${profile.fullName}, ${profile.role}. You are an Australian clinician — use Australian English (no Britishisms, no NHS, no CAMHS, no "A&E", no "999", no "Samaritans"). Write the reply in the FIRST PERSON, as yourself — never refer to yourself in the third person. ${toneInstruction}`;
}

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
  return `${commonHeader()}

Draft a compassionate INTERIM ACKNOWLEDGEMENT to the family. This is a SAFEGUARDING situation — the family deserves a warm, prompt reply, but the email cannot safely contain specific clinical advice.

The reply MUST:
- Acknowledge the parent's distress and thank them for letting you know.
- Make clear that what they have described needs proper clinical assessment by phone or face-to-face, and that you are arranging this urgently.
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
  return `${commonHeader()}

Draft a SHORT internal email to the practice admin / booking team asking them to book ${patient} in URGENTLY for a clinical review (telephone or face-to-face) — this is a SAFEGUARDING flag raised by the family today.

Rules:
- Address the admin team (e.g. "Hi team,").
- Reference ${patient}. Write in the first person — this is from you, the treating clinician.
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
  return `${commonHeader()}

Draft a prompt, warm INTERIM REPLY to the family. This is an URGENT CLINICAL situation (severe symptoms or escalation) but NOT a safeguarding concern.

The reply MUST:
- Acknowledge the family's concern and thank them for getting in touch.
- Explain that what they have described needs a phone or face-to-face clinical review, and that you are arranging this within the next working day.
- Avoid prescribing specific medication changes by email — defer to the review.
- Be warm and plain in tone.
- End with EXACTLY this sign-off:
${signOffFor(email)}${styleBlockFor(email)}${patient}

${returnOnlyBody()}

${emailBodyBlock(email)}`;
}

export function buildUrgentClinicalAdminPrompt(email: Email, c?: AiClassification): string {
  const patient = c?.patientName ? c.patientName : 'the patient';
  return `${commonHeader()}

Draft a SHORT internal email to the admin / booking team asking them to book ${patient} for an URGENT clinical review within the next working day. This is NOT a safeguarding flag — a clinical escalation only.

Rules:
- Address the admin team.
- Reference ${patient}. Write in the first person — this is from you, the treating clinician.
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
  return `${commonHeader()}

Draft a clinical reply in the first person as yourself.

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

// ---- CLINICAL from clinician-supplied ideas ----
// Fallback path when no verified evidence source could be matched to the
// email. The "never invent" rule blocks the normal evidence-backed
// clinical draft, so instead we ask the clinician for the main points
// they want to make and have the AI wordsmith them into a polite reply.
// The clinical content is the clinician's; the AI's job is phrasing,
// structure, and tone — NOT clinical decision-making.
export function buildClinicalFromIdeasPrompt(email: Email, ideas: string): string {
  return `${COMMON_HEADER}

The clinician (Dr. A. Patterson) has reviewed this email and provided the main points for the reply themselves, because no verified clinical guideline was available to ground an AI-generated answer.

Your job is ONLY to wordsmith the clinician's points into a polite, plain-language reply. You MUST NOT:
- Add clinical content, advice, dosing, diagnoses, or recommendations that the clinician did not provide.
- Second-guess, soften or re-interpret the clinical substance of what the clinician wrote.
- Insert filler reassurance ("rest assured…") or qualifications the clinician did not include.

You MAY:
- Add greeting and sign-off.
- Restructure the points into clear sentences and paragraphs.
- Match the recipient's register (warm for families, collegial for professionals).

End with EXACTLY this sign-off:
${signOffFor(email)}${styleBlockFor(email)}

${returnOnlyBody()}

Clinician's main points for the reply (use these — do not invent additional clinical content):
---
${ideas.trim()}
---

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
    intent = `The colleague has requested a clinical document${doc}. Acknowledge the request, confirm a realistic turnaround, and say it will be added to your documents-to-write task list.`;
  } else if (sub === 'meeting') {
    intent = 'The colleague is coordinating a meeting / joint appointment. Reply collegially with availability or propose two concrete options.';
  }
  return `${commonHeader()}

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
  return `${commonHeader()}

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
  return `${commonHeader()}

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
  return `${commonHeader()}

Draft a warm, practical reply confirming the prescription request will be handled.

Rules:
- Thank them for letting you know.
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
  return `${commonHeader()}

You want an ADDITIONAL draft for the email below, based on this specific instruction:

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
  // Registry IDs the server's tool-use loop actually FETCHED for this
  // turn — i.e. sources the model read live from the registered URL.
  // The server is the source of truth; the client never invents this.
  sourcesChecked?: number[];
  // Registry IDs the model TRIED to fetch but couldn't (URL unreachable,
  // non-OK status, timeout, restricted content). Distinct from "no
  // sources used" — an attempted-and-failed fetch should be surfaced
  // so the clinician knows the reply isn't grounded in what they expected.
  sourcesFailedToFetch?: number[];
};

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

// Chat prompt for the tool-use endpoint. The model decides what to look
// up via search_registered_sources / fetch_source — we no longer list
// the registry inline or ask the model to self-report "sources_checked"
// (that was unverifiable; now the server records what was actually
// fetched). The system prompt on the server already covers the tool
// contract and JSON envelope, so this prompt is just the email + thread
// context plus the latest clinician message.
export function buildChatPrompt(
  email: Email,
  history: ChatTurn[],
  userMessage: string,
): string {
  return `${commonHeader()}

Drafts (if you are writing one) MUST end with EXACTLY this sign-off (do not modify):
${signOffFor(email)}${styleBlockFor(email)}

${emailBodyBlock(email)}

Conversation so far:
${renderHistory(history)}

Most recent clinician message:
${userMessage.trim()}

Use the tools to consult the clinician's registered evidence sources for any clinical question. Respond with the JSON envelope only when you have finished.`;
}
