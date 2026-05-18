import type { EvidenceBlock } from './evidence';

const TIER_1_WARNING =
  'Tier 1 prescribing sources (eTG, AMH, MIMS) have not been integrated. Verify any dose, interaction, or contraindication directly in eTG or AMH before replying.';

export const EVIDENCE_SEED: Record<number, EvidenceBlock> = {
  // Email 5 — "Ritalin 54mg early script"
  // Real Flag C: AU vs UK NICE on methylphenidate dose ceiling in adolescents.
  // RANZCP/RACGP AU practice typically caps OROS-methylphenidate around
  // 54 mg/day in adolescents; NICE (NG87) permits titration up to 108 mg/day
  // under specialist supervision. Genuine, well-documented tension.
  5: {
    prescribingWarning: TIER_1_WARNING,
    citations: [
      {
        tier: 2,
        sourceName: 'RANZCP',
        title: 'Professional Practice Guideline 10 — ADHD: clinical practice points',
        year: 2024,
        url: 'https://www.ranzcp.org/clinical-guidelines-publications',
        flag: null,
      },
      {
        tier: 4,
        sourceName: 'NICE (UK)',
        title:
          'NG87 — ADHD: diagnosis and management — methylphenidate dose titration in children and young people',
        year: 2019,
        url: 'https://www.nice.org.uk/guidance/ng87',
        flag: 'C',
        flagText:
          'AU practice (RANZCP / RACGP) typically titrates OROS-methylphenidate to a maximum of ~54 mg/day in adolescents. NICE NG87 permits titration to 108 mg/day under specialist supervision. Defer to Australian dosing unless you have a specific clinical rationale and have documented the deviation.',
      },
    ],
  },

  // Email 21 — "Prescription request — Teresa W."
  // Flag B example: RACGP + NICE concordance on repeat prescribing governance.
  21: {
    prescribingWarning: TIER_1_WARNING,
    citations: [
      {
        tier: 2,
        sourceName: 'RACGP',
        title: 'Standards for general practices (5th ed.) — Criterion QI 1.2: Prescribing safety',
        year: 2023,
        url: 'https://www.racgp.org.au/running-a-practice/practice-standards',
        flag: null,
      },
      {
        tier: 4,
        sourceName: 'NICE (UK)',
        title: 'NG5 — Medicines optimisation: repeat prescribing',
        year: 2015,
        url: 'https://www.nice.org.uk/guidance/ng5',
        flag: 'B',
        flagText:
          'Broadly concordant with RACGP standards. Minor wording differences on review interval (NICE: at least annually; RACGP: as clinically indicated). No action required.',
      },
    ],
  },

  // Email 61 — "Ezra G. (medication update)" — stimulant monitoring.
  // Tier 2 only, no flag — both AU sources, well-aligned guidance.
  61: {
    prescribingWarning: TIER_1_WARNING,
    citations: [
      {
        tier: 2,
        sourceName: 'RCH Melbourne',
        title: 'Clinical Practice Guideline — ADHD: stimulant monitoring (weight, height, BP, HR)',
        year: 2023,
        url: 'https://www.rch.org.au/clinicalguide/guideline_index/ADHD/',
        flag: null,
      },
      {
        tier: 2,
        sourceName: 'RANZCP',
        title: 'Faculty of Child and Adolescent Psychiatry — stimulant prescribing monitoring schedule',
        year: 2024,
        url: 'https://www.ranzcp.org/clinical-guidelines-publications',
        flag: null,
      },
    ],
  },
};
