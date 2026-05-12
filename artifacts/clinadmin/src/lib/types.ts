export type EmailKind = 'clinical' | 'triage' | 'script' | 'complex' | 'admin' | 'meeting' | 'professional' | 'none';

export interface Email {
  id: number;
  from: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  risk: 'high' | 'medium' | 'low' | 'none';
  cat: string;
  deadline: number | null;
  estMin: number;
  kind?: EmailKind;
  linkedTaskId?: string;
  isProfessional?: boolean;
  isMeeting?: boolean;
}

export interface SentEmail {
  to: string;
  toLabel: string;
  toName: string;
  subject: string;
  body: string;
}

export interface ManualTask {
  id: string;
  title: string;
  cat: string;
  deadline: number;
  risk: 'high' | 'medium' | 'low' | 'none';
  type: string;
  estMin: number;
  linkedEmailId?: number;
  autoCompleteOnReply?: boolean;
  done?: boolean;
  // Set when the clinician archives the linked email but explicitly chooses
  // to keep this task open (e.g. "Document still needed — email already
  // replied to"). Surfaced in the Tasks tab so the orphaned task makes sense.
  noteAfterEmailDone?: string;
}

export interface SidebarTask {
  id: string;
  title: string;
  estMin: number;
  priority: 'high' | 'normal';
  done: boolean;
}

export interface HomePlanItem {
  id: number;
  title: string;
  why: string;
  time: string;
  done: boolean;
  emailId?: number;
  draftReply?: string;
  draftSubject?: string;
  draftTo?: string;
  badge?: 'professional' | 'meeting' | 'manual';
}

export interface WeekDataItem {
  day: string;
  planned: number;
  recommended: number;
  addExtra?: number;
}

export interface WeekHistoryItem {
  week: string;
  high: number;
  medium: number;
  low: number;
  admin: number;
}

export type TabType =
  | 'Home'
  | 'Detailed View'
  | 'Emails'
  | 'Archive'
  | 'High-Risk Patients'
  | 'Tasks'
  | 'Backlog Recovery'
  | 'Forecast'
  | 'Templates'
  | 'Settings'
  | 'Weekly Plan';

// ---- AI classification (new in Step 2 of the email triage redesign) ----
//
// The AI reads each email body and assigns one category + one priority. The
// hand-coded `risk` and `cat` fields on Email remain as a dev-only fallback
// while classifications stream in.
export type AiCategory =
  | 'SAFEGUARDING'
  | 'URGENT_CLINICAL'
  | 'CLINICAL'
  | 'PROFESSIONAL'
  | 'ADMIN'
  | 'LEGAL'
  | 'NONE'
  | 'CPD'
  | 'UNCLEAR';

export type AiPriority = 'URGENT' | 'MEDIUM' | 'LOW' | 'UNCLEAR';

export interface AiClassification {
  emailId: number;
  category: AiCategory;
  priority: AiPriority;
  confidence: number; // 0.0–1.0
  reasoning: string;
  classifiedAt: number; // epoch ms
  // PROFESSIONAL sub-type — only meaningful when category === 'PROFESSIONAL'
  professionalSubType: 'clinical_input' | 'document_request' | 'meeting' | null;
  // Optional fields the AI extracts to drive downstream behaviour
  patientName: string | null;
  documentRequested: string | null;
  eventDate: string | null;
  registrationDeadline: string | null;
  // Document/form detection. There are two completely different cases:
  //   - Someone is sending the clinician a document for their information
  //     (psych report, GP discharge, school report, pathology results) →
  //     direction = 'incoming'. No task created, no extra time, just a
  //     "Document received" badge.
  //   - Someone is asking the clinician to PRODUCE a document (NDIS
  //     report, EHCP letter, court report, school support letter) →
  //     direction = 'outgoing'. requiresDocument = true, a linked task
  //     is auto-created, and estimateMinutes returns the combined block.
  //   - direction = 'unclear' means a document is mentioned but we can't
  //     tell which way; the UI prompts the clinician to confirm.
  //   - direction = null means no document was detected at all.
  //
  // requiresDocument is the canonical "create the task / use the
  // combined time block" flag — it is only true when direction is
  // 'outgoing' (either auto-detected or clinician-confirmed).
  documentDirection: 'incoming' | 'outgoing' | 'unclear' | null;
  requiresDocument: boolean;
  documentType: string | null;       // e.g. "NDIS report", "EHCP letter"
  documentDueDays: number | null;    // days from now if the email mentions a deadline
}

export type PlanBlockCategory = 'urgent' | 'clinical' | 'admin' | 'meeting' | 'professional' | 'legal' | 'task';

export interface PlanBlock {
  task: string;
  min: number;
  category: PlanBlockCategory;
  reason: string;
}

export interface PlanDay {
  day: string;
  totalMin: number;
  blocks: PlanBlock[];
}

export interface GeneratedPlan {
  days: PlanDay[];
  deferredItems: string[];
  safetyNote: string;
  // Documents / forms to write across the week. Surfaced as a separate
  // summary line in the Weekly Plan UI: "Includes X documents or forms
  // to complete — estimated X minutes additional".
  docSummary?: { count: number; mins: number };
  // Total minutes reserved across the week as a buffer for unexpected
  // urgent emails. The packer fills each day to 80% of its capacity and
  // leaves the remaining 20% as buffer.
  bufferMin?: number;
}

export interface StyleProfile {
  overall: string;
  sections: {
    title: string;
    greeting: string;
    tone: string;
    signOff: string;
    keyPhrases: string;
  }[];
}
