import type { AiCategory, AiPriority } from './types';

export const CATEGORY_LABEL: Record<AiCategory, string> = {
  SAFEGUARDING: 'Safeguarding',
  URGENT_CLINICAL: 'Urgent clinical',
  CLINICAL: 'Clinical',
  PROFESSIONAL: 'Professional',
  ADMIN: 'Admin',
  LEGAL: 'Legal',
  NONE: 'No action',
  CPD: 'CPD',
  UNCLEAR: 'Unclear',
};

export const CATEGORY_BADGE: Record<AiCategory, string> = {
  SAFEGUARDING: 'bg-red-100 text-red-800 border-red-200',
  URGENT_CLINICAL: 'bg-orange-100 text-orange-800 border-orange-200',
  CLINICAL: 'bg-blue-100 text-blue-800 border-blue-200',
  PROFESSIONAL: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  ADMIN: 'bg-slate-100 text-slate-700 border-slate-200',
  LEGAL: 'bg-purple-100 text-purple-800 border-purple-200',
  NONE: 'bg-gray-50 text-gray-600 border-gray-200',
  CPD: 'bg-teal-100 text-teal-800 border-teal-200',
  UNCLEAR: 'bg-yellow-100 text-yellow-800 border-yellow-300',
};

export const PRIORITY_LABEL: Record<AiPriority, string> = {
  URGENT: 'Urgent',
  MEDIUM: 'Medium',
  LOW: 'Low',
  UNCLEAR: 'Unclear',
};

export const PRIORITY_BADGE: Record<AiPriority, string> = {
  URGENT: 'text-red-700 bg-red-50 border-red-200',
  MEDIUM: 'text-amber-700 bg-amber-50 border-amber-200',
  LOW: 'text-slate-600 bg-slate-50 border-slate-200',
  UNCLEAR: 'text-yellow-800 bg-yellow-50 border-yellow-300',
};

export const PRIORITY_RANK: Record<AiPriority, number> = {
  URGENT: 0,
  MEDIUM: 1,
  LOW: 2,
  UNCLEAR: 3, // sort to bottom — needs review but unknown urgency
};
