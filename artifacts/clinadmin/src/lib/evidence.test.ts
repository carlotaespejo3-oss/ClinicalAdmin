import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isClinicalEmail } from './evidence.ts';
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
