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

export type TabType = 'Home' | 'Today' | 'Inbox' | 'High Risk' | 'Timeline' | 'Weekly Plan' | 'My Style' | 'Catch-up';

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
