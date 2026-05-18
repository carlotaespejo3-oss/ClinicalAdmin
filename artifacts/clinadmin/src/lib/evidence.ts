import type { AiCategory, AiClassification } from './types';

export type EvidenceTier = 1 | 2 | 3 | 4 | 5;

export type EvidenceFlag = 'A' | 'B' | 'C' | 'D' | 'tier5' | null;

export interface Citation {
  tier: EvidenceTier;
  sourceName: string;
  title: string;
  year: number;
  url?: string;
  // False when the underlying guideline document sits behind a paywall,
  // login wall, or is not machine-readable. The view renders a "refer
  // to source directly" hint instead of a clickable link, and Stage 3
  // will fall back to a metadata-only citation.
  publiclyAccessible?: boolean;
  flag: EvidenceFlag;
  flagText?: string;
}

export interface EvidenceBlock {
  prescribingWarning?: string;
  citations: Citation[];
}

export function isClinicalEmail(cls: AiClassification | undefined): boolean {
  if (!cls) return false;
  const cat: AiCategory = cls.category;
  if (cat === 'SAFEGUARDING' || cat === 'URGENT_CLINICAL' || cat === 'CLINICAL') {
    return true;
  }
  if (cat === 'PROFESSIONAL' && cls.professionalSubType === 'clinical_input') {
    return true;
  }
  return false;
}

export const FLAG_LABEL: Record<Exclude<EvidenceFlag, null>, string> = {
  A: 'Concordant',
  B: 'Minor variation',
  C: 'Note: international guidance differs',
  D: 'Conflict — defer to Australian guidance',
  tier5: 'Primary literature — interpret with care',
};

export const FLAG_ICON: Record<Exclude<EvidenceFlag, null>, string> = {
  A: '✅',
  B: '💛',
  C: '🔴',
  D: '🔴',
  tier5: '📄',
};
