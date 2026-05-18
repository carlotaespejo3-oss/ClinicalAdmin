import type { AiCategory, AiClassification } from './types';
import { EVIDENCE_SEED } from './evidenceSeed';

export type EvidenceTier = 1 | 2 | 3 | 4 | 5;

export type EvidenceFlag = 'A' | 'B' | 'C' | 'D' | 'tier5' | null;

export interface Citation {
  tier: EvidenceTier;
  sourceName: string;
  title: string;
  year: number;
  url?: string;
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

export function getEvidenceBlock(emailId: number): EvidenceBlock | undefined {
  return EVIDENCE_SEED[emailId];
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
