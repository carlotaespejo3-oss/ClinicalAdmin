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
  // Document/form detection (Step 4): true when the email asks the
  // clinician to write a document (report, letter, certificate, form). When
  // true, estimateMinutes returns a single combined block (20 min, or 30
  // for LEGAL) — the email reply and document write are ONE piece of work.
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
