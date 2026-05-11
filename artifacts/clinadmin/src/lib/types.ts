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
}

export interface HomePlanItem {
  id: number;
  title: string;
  why: string;
  time: string;
  done: boolean;
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
