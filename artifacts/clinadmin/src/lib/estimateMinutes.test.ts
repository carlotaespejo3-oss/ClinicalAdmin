import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PENDING_CLASSIFICATION_MIN,
  estimateMinutes,
  hasMultipleQuestionsOrConcerns,
  isComplex,
} from './estimateMinutes.ts';
import type {
  AiCategory,
  AiClassification,
  AiPriority,
  Email,
} from './types.ts';

function makeEmail(body: string = 'Hello.'): Email {
  return {
    id: 1,
    from: 'patient@example.com',
    subject: 'Test',
    preview: body.slice(0, 40),
    body,
    date: '2026-01-01',
    risk: 'none',
    cat: 'none',
    deadline: null,
    estMin: 0,
  };
}

function makeClassification(
  category: AiCategory,
  priority: AiPriority,
  overrides: Partial<AiClassification> = {},
): AiClassification {
  return {
    emailId: 1,
    category,
    priority,
    confidence: 0.9,
    reasoning: '',
    classifiedAt: 0,
    professionalSubType: null,
    patientName: null,
    documentRequested: null,
    eventDate: null,
    registrationDeadline: null,
    ...overrides,
  };
}

const longBody = ('word '.repeat(151)).trim(); // 151 words → > 150

describe('PENDING_CLASSIFICATION_MIN fallback', () => {
  it('returns 10 when classification is undefined', () => {
    assert.equal(estimateMinutes(makeEmail(), undefined), PENDING_CLASSIFICATION_MIN);
    assert.equal(PENDING_CLASSIFICATION_MIN, 10);
  });

  it('returns 10 when classification is null', () => {
    assert.equal(estimateMinutes(makeEmail(), null), PENDING_CLASSIFICATION_MIN);
  });
});

describe('category base bands (simple email, natural priority)', () => {
  const cases: Array<[AiCategory, AiPriority, number]> = [
    ['SAFEGUARDING', 'URGENT', 20],
    ['LEGAL', 'MEDIUM', 30],
    ['URGENT_CLINICAL', 'URGENT', 15],
    ['CLINICAL', 'MEDIUM', 10],
    ['PROFESSIONAL', 'MEDIUM', 5],
    ['ADMIN', 'LOW', 2],
    ['NONE', 'LOW', 1],
    ['CPD', 'LOW', 2],
    ['UNCLEAR', 'UNCLEAR', 5],
  ];
  for (const [category, priority, expected] of cases) {
    it(`${category} (simple, ${priority}) → ${expected}`, () => {
      const minutes = estimateMinutes(makeEmail('Hi.'), makeClassification(category, priority));
      assert.equal(minutes, expected);
    });
  }
});

describe('category upper bands', () => {
  it('URGENT_CLINICAL complex (long body) → 20', () => {
    const minutes = estimateMinutes(
      makeEmail(longBody),
      makeClassification('URGENT_CLINICAL', 'URGENT'),
    );
    assert.equal(minutes, 20);
  });

  it('CLINICAL complex (long body) → 15', () => {
    const minutes = estimateMinutes(
      makeEmail(longBody),
      makeClassification('CLINICAL', 'MEDIUM'),
    );
    assert.equal(minutes, 15);
  });

  it('PROFESSIONAL clinical_input → 10', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('PROFESSIONAL', 'MEDIUM', { professionalSubType: 'clinical_input' }),
    );
    assert.equal(minutes, 10);
  });

  it('PROFESSIONAL document_request → 10', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('PROFESSIONAL', 'MEDIUM', { professionalSubType: 'document_request' }),
    );
    assert.equal(minutes, 10);
  });

  it('PROFESSIONAL meeting sub-type does NOT bump to upper', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('PROFESSIONAL', 'MEDIUM', { professionalSubType: 'meeting' }),
    );
    assert.equal(minutes, 5);
  });
});

describe('>150-word complexity rule', () => {
  it('exactly 150 words is NOT complex', () => {
    const body = ('word '.repeat(150)).trim();
    assert.equal(isComplex(makeEmail(body)), false);
  });

  it('151 words IS complex', () => {
    assert.equal(isComplex(makeEmail(longBody)), true);
  });

  it('does not bump bands for non-CLINICAL categories even when complex', () => {
    const minutes = estimateMinutes(
      makeEmail(longBody),
      makeClassification('ADMIN', 'LOW'),
    );
    assert.equal(minutes, 2);
  });
});

describe('multiple questions / concerns heuristic', () => {
  it('two question marks → multiple questions', () => {
    assert.equal(hasMultipleQuestionsOrConcerns('Can you help? And also this?'), true);
  });

  it('one question mark alone → not multiple', () => {
    assert.equal(hasMultipleQuestionsOrConcerns('Can you help with this single thing?'), false);
  });

  it('one question mark + connector cue ("also") → multiple', () => {
    assert.equal(hasMultipleQuestionsOrConcerns('Can you help? Also, please send the form.'), true);
  });

  it('one question mark + connector cue ("in addition") → multiple', () => {
    assert.equal(
      hasMultipleQuestionsOrConcerns('What time is the appointment? In addition, please send notes.'),
      true,
    );
  });

  it('connector cue without any question mark → not multiple', () => {
    assert.equal(hasMultipleQuestionsOrConcerns('Also please send the form.'), false);
  });

  it('empty body → not multiple', () => {
    assert.equal(hasMultipleQuestionsOrConcerns(''), false);
  });

  it('CLINICAL with multiple questions → upper band (15)', () => {
    const minutes = estimateMinutes(
      makeEmail('Can you help? Also, what should I do next?'),
      makeClassification('CLINICAL', 'MEDIUM'),
    );
    assert.equal(minutes, 15);
  });

  it('URGENT_CLINICAL with multiple questions → upper band (20)', () => {
    const minutes = estimateMinutes(
      makeEmail('Is this safe? Should I stop?'),
      makeClassification('URGENT_CLINICAL', 'URGENT'),
    );
    assert.equal(minutes, 20);
  });
});

describe('+5 escalation when AI priority outranks the category natural priority', () => {
  it('CLINICAL bumped to URGENT → +5 on base (10 + 5 = 15)', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('CLINICAL', 'URGENT'),
    );
    assert.equal(minutes, 15);
  });

  it('CLINICAL bumped to URGENT and complex → upper + 5 (15 + 5 = 20)', () => {
    const minutes = estimateMinutes(
      makeEmail(longBody),
      makeClassification('CLINICAL', 'URGENT'),
    );
    assert.equal(minutes, 20);
  });

  it('ADMIN bumped to MEDIUM → +5 (2 + 5 = 7)', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('ADMIN', 'MEDIUM'),
    );
    assert.equal(minutes, 7);
  });

  it('ADMIN bumped to URGENT → +5 (2 + 5 = 7)', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('ADMIN', 'URGENT'),
    );
    assert.equal(minutes, 7);
  });

  it('PROFESSIONAL bumped to URGENT with clinical_input → upper + 5 (10 + 5 = 15)', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('PROFESSIONAL', 'URGENT', { professionalSubType: 'clinical_input' }),
    );
    assert.equal(minutes, 15);
  });

  it('SAFEGUARDING already URGENT (natural) → no bump', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('SAFEGUARDING', 'URGENT'),
    );
    assert.equal(minutes, 20);
  });

  it('CLINICAL at MEDIUM (natural) → no bump', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('CLINICAL', 'MEDIUM'),
    );
    assert.equal(minutes, 10);
  });

  it('UNCLEAR priority does NOT escalate (rank -1 < LOW)', () => {
    const minutes = estimateMinutes(
      makeEmail('Short.'),
      makeClassification('ADMIN', 'UNCLEAR'),
    );
    assert.equal(minutes, 2);
  });
});
