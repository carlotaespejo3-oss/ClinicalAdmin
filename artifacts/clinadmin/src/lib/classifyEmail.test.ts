import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyEmail, type RunPrompt } from './classifyEmail.ts';
import type {
  AiCategory,
  AiClassification,
  AiPriority,
  Email,
} from './types.ts';

function makeEmail(overrides: Partial<Email> & { body: string }): Email {
  return {
    id: 1,
    from: 'sender@example.com',
    subject: 'Test',
    preview: overrides.body.slice(0, 40),
    date: '2026-01-01',
    risk: 'none',
    cat: 'none',
    deadline: null,
    estMin: 0,
    ...overrides,
  };
}

// =============================================================================
// Assignment-lock tests
// =============================================================================
//
// These tests freeze the *behaviour* of the classifier for representative
// emails. They are deliberately not "stub returns the expected category" —
// that would only test JSON parsing. Instead, the stub:
//
//   1. Asserts the prompt contains the rubric snippets that drive the
//      category in question (so deleting safeguarding guidance from the
//      prompt fails the test).
//   2. Asserts the email body actually made it into the prompt (so a future
//      refactor that drops the body fails the test).
//   3. Derives the category from keyword markers found *inside the prompt*
//      — i.e. it simulates what a sensible LLM would do given the prompt it
//      received. If the prompt no longer contains the body, the simulator
//      returns UNCLEAR and the assertion fails.
//
// Combined, these mean a regression in either the prompt rubric or the
// email-body wiring causes a test failure, which is the regression the
// task is asking us to catch.
// =============================================================================

// Rubric snippets that MUST appear in the prompt for each category to be
// recoverable. Keep these short and high-signal so they catch real changes
// without being brittle to wording tweaks.
const REQUIRED_RUBRIC: Record<AiCategory, readonly string[]> = {
  SAFEGUARDING: ['SAFEGUARDING', 'self-harm'],
  URGENT_CLINICAL: ['URGENT_CLINICAL', 'crisis'],
  CLINICAL: ['CLINICAL', 'medication'],
  PROFESSIONAL: ['PROFESSIONAL', 'clinical_input', 'document_request', 'meeting'],
  ADMIN: ['ADMIN', 'bookings'],
  LEGAL: ['LEGAL', 'medico-legal'],
  NONE: ['NONE', 'newsletters'],
  CPD: ['CPD', 'conferences'],
  UNCLEAR: ['UNCLEAR'],
};

// A rule-based "fake LLM" that pattern-matches the body section of the
// prompt to decide the category. Order matters: more specific cues first.
type Decision = {
  category: AiCategory;
  priority: AiPriority;
  professionalSubType?: 'clinical_input' | 'document_request' | 'meeting';
};

function decideFromBody(bodyInPrompt: string): Decision {
  const t = bodyInPrompt;
  if (/(self-harm|end (her|his|my) life|cuts on (her|his) arm|suicidal)/i.test(t)) {
    return { category: 'SAFEGUARDING', priority: 'URGENT' };
  }
  if (/(severe meltdown|in crisis|severe behavioural escalation|severe escalation)/i.test(t)) {
    return { category: 'URGENT_CLINICAL', priority: 'URGENT' };
  }
  if (/(referral letter|write the .* report|need (a |an )?(report|letter)|please (write|provide).{0,40}(letter|report))/i.test(t)) {
    return { category: 'PROFESSIONAL', priority: 'MEDIUM', professionalSubType: 'document_request' };
  }
  if (/(clinical opinion|your input on|opinion on whether|seeking your input)/i.test(t)) {
    return { category: 'PROFESSIONAL', priority: 'MEDIUM', professionalSubType: 'clinical_input' };
  }
  if (/(joint meeting|set up a meeting|joint appointment|coordinate.*meeting)/i.test(t)) {
    return { category: 'PROFESSIONAL', priority: 'MEDIUM', professionalSubType: 'meeting' };
  }
  if (/(solicitor|court|proceedings|medico-?legal)/i.test(t)) {
    return { category: 'LEGAL', priority: 'MEDIUM' };
  }
  if (/(conference|registration|cpd)/i.test(t)) {
    return { category: 'CPD', priority: 'LOW' };
  }
  if (/(newsletter|bulletin|fyi|monthly bulletin)/i.test(t)) {
    return { category: 'NONE', priority: 'LOW' };
  }
  if (/(reschedul|move the .* appointment|room change|booking)/i.test(t)) {
    return { category: 'ADMIN', priority: 'LOW' };
  }
  if (/(dose|mg\b|prescription|medication)/i.test(t)) {
    return { category: 'CLINICAL', priority: 'MEDIUM' };
  }
  return { category: 'UNCLEAR', priority: 'UNCLEAR' };
}

function rubricAwareStub(expectedCategory: AiCategory, email: Email): RunPrompt {
  return async (prompt: string) => {
    // 1. Required rubric must be present.
    for (const snippet of REQUIRED_RUBRIC[expectedCategory]) {
      assert.ok(
        prompt.includes(snippet),
        `prompt is missing required rubric snippet for ${expectedCategory}: "${snippet}"`,
      );
    }
    // 2. Required JSON shape signal must be present.
    assert.ok(prompt.includes('OUTPUT JSON SHAPE'), 'prompt is missing OUTPUT JSON SHAPE block');
    // 3. Email body must be in the prompt.
    assert.ok(prompt.includes(email.body), 'prompt is missing the email body');
    assert.ok(prompt.includes(email.subject), 'prompt is missing the email subject');
    assert.ok(prompt.includes(email.from), 'prompt is missing the email from-address');

    // 4. Derive a decision from the body section of the prompt.
    const bodySection = prompt.split('---').slice(-1)[0] ?? '';
    const decision = decideFromBody(bodySection);
    return JSON.stringify({
      category: decision.category,
      priority: decision.priority,
      confidence: 0.9,
      reasoning: 'derived from prompt content',
      professionalSubType: decision.professionalSubType ?? null,
      patientName: null,
      documentRequested: null,
      eventDate: null,
      registrationDeadline: null,
      requiresDocument: false,
      documentType: null,
      documentDueDays: null,
    });
  };
}

interface CategoryCase {
  name: string;
  email: Email;
  expectedCategory: AiCategory;
  expectedPriority: AiPriority;
  expectedSubType?: AiClassification['professionalSubType'];
}

const cases: CategoryCase[] = [
  {
    name: 'SAFEGUARDING — child mentions self-harm',
    email: makeEmail({
      from: 'parent@example.com',
      subject: 'Worried about my daughter',
      body: 'My 14-year-old has been talking about wanting to end her life and I found cuts on her arm last night. Please help.',
    }),
    expectedCategory: 'SAFEGUARDING',
    expectedPriority: 'URGENT',
  },
  {
    name: 'URGENT_CLINICAL — severe escalation, no safeguarding',
    email: makeEmail({
      from: 'parent@example.com',
      subject: 'Severe meltdowns since starting new dose',
      body: 'Since the dose change Monday, my son has had severe meltdowns lasting hours. He is exhausted and refusing food.',
    }),
    expectedCategory: 'URGENT_CLINICAL',
    expectedPriority: 'URGENT',
  },
  {
    name: 'CLINICAL — routine medication question',
    email: makeEmail({
      from: 'parent@example.com',
      subject: 'Concerta dose check',
      body: 'Quick question — should we keep the 36mg dose for another week before reviewing, or step up to 54mg now?',
    }),
    expectedCategory: 'CLINICAL',
    expectedPriority: 'MEDIUM',
  },
  {
    name: 'PROFESSIONAL clinical_input — psychologist asking for opinion',
    email: makeEmail({
      from: 'psych@clinic.example',
      subject: 'Clinical opinion on shared patient',
      body: 'Could I get your input on whether the trauma symptoms warrant a medication review for our shared patient?',
    }),
    expectedCategory: 'PROFESSIONAL',
    expectedPriority: 'MEDIUM',
    expectedSubType: 'clinical_input',
  },
  {
    name: 'PROFESSIONAL document_request — GP wants a referral letter',
    email: makeEmail({
      from: 'gp@surgery.example',
      subject: 'Referral letter please',
      body: 'Could you send a referral letter for our shared patient so we can move forward with the paediatric assessment?',
    }),
    expectedCategory: 'PROFESSIONAL',
    expectedPriority: 'MEDIUM',
    expectedSubType: 'document_request',
  },
  {
    name: 'PROFESSIONAL meeting — school MH lead coordinating',
    email: makeEmail({
      from: 'mhlead@school.example',
      subject: 'Joint meeting next week?',
      body: 'Can we set up a joint meeting next Tuesday to discuss the support plan together?',
    }),
    expectedCategory: 'PROFESSIONAL',
    expectedPriority: 'MEDIUM',
    expectedSubType: 'meeting',
  },
  {
    name: 'ADMIN — appointment reschedule',
    email: makeEmail({
      from: 'reception@example.com',
      subject: 'Reschedule Thursday',
      body: 'Could we move the Thursday 3pm appointment to next week? Tuesday or Wednesday morning works for the family.',
    }),
    expectedCategory: 'ADMIN',
    expectedPriority: 'LOW',
  },
  {
    name: 'LEGAL — solicitor correspondence',
    email: makeEmail({
      from: 'solicitor@law.example',
      subject: 'Court matter — patient X',
      body: 'We are writing in connection with ongoing proceedings and require correspondence regarding the assessment on record.',
    }),
    expectedCategory: 'LEGAL',
    expectedPriority: 'MEDIUM',
  },
  {
    name: 'NONE — newsletter / FYI',
    email: makeEmail({
      from: 'news@society.example',
      subject: 'Monthly bulletin',
      body: 'Here is your monthly newsletter with updates from the society. No action required.',
    }),
    expectedCategory: 'NONE',
    expectedPriority: 'LOW',
  },
  {
    name: 'CPD — conference registration',
    email: makeEmail({
      from: 'events@cpd.example',
      subject: 'Annual CAP conference — registration open',
      body: 'Registration for the annual CPD conference is now open. Please register by 30 June to secure the early rate.',
    }),
    expectedCategory: 'CPD',
    expectedPriority: 'LOW',
  },
  {
    name: 'UNCLEAR — vague single-line message',
    email: makeEmail({
      from: 'someone@example.com',
      subject: 'Hi',
      body: 'Just wanted to touch base.',
    }),
    expectedCategory: 'UNCLEAR',
    expectedPriority: 'UNCLEAR',
  },
];

describe('classifyEmail — assignment lock for representative emails', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const result = await classifyEmail(
        c.email,
        rubricAwareStub(c.expectedCategory, c.email),
      );
      assert.equal(result.category, c.expectedCategory, 'category mismatch');
      assert.equal(result.priority, c.expectedPriority, 'priority mismatch');
      if (c.expectedCategory === 'PROFESSIONAL') {
        assert.equal(
          result.professionalSubType,
          c.expectedSubType ?? null,
          'professionalSubType mismatch',
        );
      }
      assert.equal(result.emailId, c.email.id);
    });
  }
});

describe('classifyEmail — negative sentinels (do-not-regress cases)', () => {
  // Exact failure mode called out in the task brief: a safeguarding email
  // must NOT silently come back as CLINICAL. We use the same rule-based
  // stub the assignment-lock tests use, then assert the negative.
  it('safeguarding email is never classified as CLINICAL', async () => {
    const email = makeEmail({
      from: 'parent@example.com',
      subject: 'Worried about my son',
      body: 'He has been talking about wanting to end his life and I found cuts on his arm. I am terrified.',
    });
    const result = await classifyEmail(email, rubricAwareStub('SAFEGUARDING', email));
    assert.notEqual(result.category, 'CLINICAL');
    assert.equal(result.category, 'SAFEGUARDING');
    assert.equal(result.priority, 'URGENT');
  });

  it('safeguarding email is never classified as URGENT_CLINICAL or NONE', async () => {
    const email = makeEmail({
      from: 'parent@example.com',
      subject: 'Help',
      body: 'My daughter said she wants to end her life. We are at A&E.',
    });
    const result = await classifyEmail(email, rubricAwareStub('SAFEGUARDING', email));
    assert.notEqual(result.category, 'URGENT_CLINICAL');
    assert.notEqual(result.category, 'NONE');
    assert.equal(result.category, 'SAFEGUARDING');
  });

  it('CPD conference invite is never classified as CLINICAL or PROFESSIONAL', async () => {
    const email = makeEmail({
      from: 'events@cpd.example',
      subject: 'CPD conference',
      body: 'Registration for the autumn CPD conference is now open.',
    });
    const result = await classifyEmail(email, rubricAwareStub('CPD', email));
    assert.notEqual(result.category, 'CLINICAL');
    assert.notEqual(result.category, 'PROFESSIONAL');
    assert.equal(result.category, 'CPD');
  });
});

// =============================================================================
// Robustness tests — output parsing / validation safeguards. Kept separate
// from the assignment-lock tests above so intent is explicit: these only
// guard the JSON-handling layer, not the classification rules.
// =============================================================================

interface StubResponse {
  category: AiCategory | string;
  priority: AiPriority | string;
  confidence?: number;
  professionalSubType?: 'clinical_input' | 'document_request' | 'meeting' | string | null;
  requiresDocument?: boolean;
  documentType?: string | null;
  documentDueDays?: number | null;
}

function fixedStub(response: StubResponse, opts: { wrapInFence?: boolean; preamble?: string } = {}): RunPrompt {
  return async () => {
    const json = JSON.stringify({
      category: response.category,
      priority: response.priority,
      confidence: response.confidence ?? 0.9,
      reasoning: 'fixed',
      professionalSubType: response.professionalSubType ?? null,
      patientName: null,
      documentRequested: null,
      eventDate: null,
      registrationDeadline: null,
      requiresDocument: response.requiresDocument ?? false,
      documentType: response.documentType ?? null,
      documentDueDays: response.documentDueDays ?? null,
    });
    let out = json;
    if (opts.wrapInFence) out = '```json\n' + out + '\n```';
    if (opts.preamble) out = opts.preamble + out;
    return out;
  };
}

describe('classifyEmail — output validation safeguards (parsing layer only)', () => {
  it('unknown category falls back to UNCLEAR', async () => {
    const result = await classifyEmail(
      makeEmail({ body: 'anything' }),
      fixedStub({ category: 'NONSENSE', priority: 'MEDIUM' }),
    );
    assert.equal(result.category, 'UNCLEAR');
    assert.equal(result.priority, 'MEDIUM');
  });

  it('unknown priority falls back to UNCLEAR', async () => {
    const result = await classifyEmail(
      makeEmail({ body: 'anything' }),
      fixedStub({ category: 'CLINICAL', priority: 'SOON' }),
    );
    assert.equal(result.category, 'CLINICAL');
    assert.equal(result.priority, 'UNCLEAR');
  });

  it('unknown professionalSubType falls back to null', async () => {
    const result = await classifyEmail(
      makeEmail({ body: 'anything' }),
      fixedStub({
        category: 'PROFESSIONAL',
        priority: 'MEDIUM',
        professionalSubType: 'banter',
      }),
    );
    assert.equal(result.category, 'PROFESSIONAL');
    assert.equal(result.professionalSubType, null);
  });

  it('unparseable model output → UNCLEAR/UNCLEAR with confidence 0', async () => {
    const result = await classifyEmail(
      makeEmail({ body: 'anything' }),
      async () => 'sorry, I cannot help with that',
    );
    assert.equal(result.category, 'UNCLEAR');
    assert.equal(result.priority, 'UNCLEAR');
    assert.equal(result.confidence, 0);
  });

  it('strips ```json ... ``` markdown fences', async () => {
    const result = await classifyEmail(
      makeEmail({ body: 'anything' }),
      fixedStub({ category: 'ADMIN', priority: 'LOW' }, { wrapInFence: true }),
    );
    assert.equal(result.category, 'ADMIN');
    assert.equal(result.priority, 'LOW');
  });

  it('extracts JSON when preamble text is present', async () => {
    const result = await classifyEmail(
      makeEmail({ body: 'anything' }),
      fixedStub(
        { category: 'CLINICAL', priority: 'MEDIUM' },
        { preamble: 'Here is the classification: ' },
      ),
    );
    assert.equal(result.category, 'CLINICAL');
    assert.equal(result.priority, 'MEDIUM');
  });

  it('clamps confidence into [0, 1]', async () => {
    const tooHigh = await classifyEmail(
      makeEmail({ body: 'x' }),
      fixedStub({ category: 'NONE', priority: 'LOW', confidence: 4.2 }),
    );
    assert.equal(tooHigh.confidence, 1);

    const tooLow = await classifyEmail(
      makeEmail({ body: 'x' }),
      fixedStub({ category: 'NONE', priority: 'LOW', confidence: -0.5 }),
    );
    assert.equal(tooLow.confidence, 0);
  });
});

describe('classifyEmail — document detection wiring', () => {
  it('AI requiresDocument=true is preserved with documentType', async () => {
    const result = await classifyEmail(
      makeEmail({ body: 'Please write something for the school file.' }),
      fixedStub({
        category: 'PROFESSIONAL',
        priority: 'MEDIUM',
        professionalSubType: 'document_request',
        requiresDocument: true,
        documentType: 'School support letter',
        documentDueDays: 7,
      }),
    );
    assert.equal(result.requiresDocument, true);
    assert.equal(result.documentType, 'School support letter');
    assert.equal(result.documentDueDays, 7);
  });

  it('regex heuristic catches NDIS report request even when AI says false', async () => {
    const result = await classifyEmail(
      makeEmail({
        body: 'Could you write the NDIS report for our shared patient before the next planning meeting?',
      }),
      fixedStub({
        category: 'PROFESSIONAL',
        priority: 'MEDIUM',
        professionalSubType: 'document_request',
        requiresDocument: false,
      }),
    );
    assert.equal(result.requiresDocument, true);
    assert.equal(result.documentType, 'NDIS report');
  });

  it('non-document email leaves requiresDocument false', async () => {
    const result = await classifyEmail(
      makeEmail({ body: 'Quick clinical question about timing of the dose.' }),
      fixedStub({ category: 'CLINICAL', priority: 'MEDIUM', requiresDocument: false }),
    );
    assert.equal(result.requiresDocument, false);
    assert.equal(result.documentType, null);
    assert.equal(result.documentDueDays, null);
  });
});
