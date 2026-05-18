import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isClinicalEmail, getEvidenceBlock } from './evidence.ts';
import type { AiClassification } from './types.ts';

function cls(partial: Partial<AiClassification>): AiClassification {
  return {
    category: 'NONE',
    priority: 'normal',
    reasoning: '',
    ...partial,
  } as AiClassification;
}

describe('isClinicalEmail', () => {
  it('returns true for SAFEGUARDING / URGENT_CLINICAL / CLINICAL', () => {
    assert.equal(isClinicalEmail(cls({ category: 'SAFEGUARDING' })), true);
    assert.equal(isClinicalEmail(cls({ category: 'URGENT_CLINICAL' })), true);
    assert.equal(isClinicalEmail(cls({ category: 'CLINICAL' })), true);
  });

  it('returns true for PROFESSIONAL only when subType is clinical_input', () => {
    assert.equal(
      isClinicalEmail(cls({ category: 'PROFESSIONAL', professionalSubType: 'clinical_input' })),
      true,
    );
    assert.equal(
      isClinicalEmail(cls({ category: 'PROFESSIONAL', professionalSubType: 'meeting' })),
      false,
    );
    assert.equal(isClinicalEmail(cls({ category: 'PROFESSIONAL' })), false);
  });

  it('returns false for ADMIN / NONE / LEGAL / UNCLEAR / CPD', () => {
    for (const category of ['ADMIN', 'NONE', 'LEGAL', 'UNCLEAR', 'CPD'] as const) {
      assert.equal(isClinicalEmail(cls({ category })), false, `expected false for ${category}`);
    }
  });

  it('returns false when classification is undefined', () => {
    assert.equal(isClinicalEmail(undefined), false);
  });
});

describe('getEvidenceBlock seed', () => {
  it('returns a block with a Tier 1 prescribing warning for email 5', () => {
    const block = getEvidenceBlock(5);
    assert.ok(block, 'expected a seeded evidence block for email 5');
    assert.ok(block!.prescribingWarning, 'expected a prescribing warning on email 5');
    assert.equal(block!.citations.length >= 2, true);
  });

  it('email 5 demonstrates a genuine Flag C tension (AU vs international)', () => {
    const block = getEvidenceBlock(5)!;
    const flagC = block.citations.find((c) => c.flag === 'C');
    assert.ok(flagC, 'expected a Flag C citation on email 5');
    assert.match(flagC!.flagText ?? '', /Australian|RANZCP|RACGP/i);
  });

  it('email 62 (asthma) has a Flag B (minor variation) citation', () => {
    const block = getEvidenceBlock(62)!;
    assert.ok(block.citations.some((c) => c.flag === 'B'));
    const flagB = block.citations.find((c) => c.flag === 'B')!;
    assert.match(flagB.sourceName, /GINA/i);
  });

  it('email 61 has only Tier 2 AU sources, no flags', () => {
    const block = getEvidenceBlock(61)!;
    assert.equal(block.citations.every((c) => c.tier === 2 && c.flag === null), true);
  });

  it('returns undefined for emails without seeded evidence', () => {
    assert.equal(getEvidenceBlock(9999), undefined);
  });
});
