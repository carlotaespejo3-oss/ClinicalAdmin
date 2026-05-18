import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchPrompt,
  parseMatchResponse,
  matchQueue,
} from './matchEvidence';
import type { RegistryItem, ServerCitation } from './evidenceStore';
import type { Email, AiClassification } from './types';

const REGISTRY: RegistryItem[] = [
  {
    id: 101,
    tier: 2,
    sourceName: 'RCH Melbourne',
    title: 'ADHD: stimulant monitoring',
    year: 2023,
    isAustralian: true,
    specialty: 'paediatrics',
  },
  {
    id: 102,
    tier: 4,
    sourceName: 'NICE (UK)',
    title: 'NG87 — ADHD diagnosis and management',
    year: 2019,
    isAustralian: false,
    specialty: 'psychiatry',
  },
];

const REGISTRY_IDS = new Set(REGISTRY.map((r) => r.id));

const EMAIL: Email = {
  id: 5,
  from: 'parent@example.com',
  subject: 'Methylphenidate dose',
  body: 'Hi, can we increase the methylphenidate dose for our son?',
  receivedAt: new Date('2026-05-01T09:00:00Z').toISOString(),
  // Fields we don't care about for these tests — types may add more
  // later; cast through unknown to keep the suite resilient.
} as unknown as Email;

const CLASSIFICATION: AiClassification = {
  emailId: 5,
  category: 'CLINICAL',
  priority: 'MEDIUM',
  confidence: 0.9,
  reasoning: 'Routine clinical question.',
  classifiedAt: Date.now(),
  professionalSubType: null,
  patientName: null,
  documentRequested: null,
  eventDate: null,
  registrationDeadline: null,
  documentDirection: null,
  requiresDocument: false,
  documentType: null,
  documentDueDays: null,
  prescriptionRequest: null,
  complexity: 'simple',
  complexityReasons: [],
};

describe('buildMatchPrompt', () => {
  it('embeds every registry id in the prompt body', () => {
    const prompt = buildMatchPrompt(EMAIL, CLASSIFICATION, REGISTRY);
    for (const r of REGISTRY) {
      assert.ok(
        prompt.includes(`"id":${r.id}`),
        `registry id ${r.id} should appear in prompt`,
      );
      assert.ok(prompt.includes(r.sourceName));
    }
  });

  it('includes the never-invent clause and UK English directive', () => {
    const prompt = buildMatchPrompt(EMAIL, CLASSIFICATION, REGISTRY);
    assert.ok(/NEVER invent a source/i.test(prompt));
    assert.ok(/UK English/i.test(prompt));
  });

  it('includes the email subject + body + classification summary', () => {
    const prompt = buildMatchPrompt(EMAIL, CLASSIFICATION, REGISTRY);
    assert.ok(prompt.includes(EMAIL.subject));
    assert.ok(prompt.includes('methylphenidate dose'));
    assert.ok(prompt.includes('category=CLINICAL'));
  });

  it('still produces a prompt when classification is undefined', () => {
    const prompt = buildMatchPrompt(EMAIL, undefined, REGISTRY);
    assert.ok(prompt.includes('unclassified'));
  });
});

describe('parseMatchResponse', () => {
  it('parses a clean response and returns the citations', () => {
    const res = parseMatchResponse(
      '{"citations":[{"sourceId":101,"flag":"A"},{"sourceId":102,"flag":"C"}]}',
      REGISTRY_IDS,
    );
    assert.deepEqual(res, [
      { sourceId: 101, flag: 'A', flagText: null },
      { sourceId: 102, flag: 'C', flagText: null },
    ]);
  });

  it('drops orphan source IDs not in the registry', () => {
    const res = parseMatchResponse(
      '{"citations":[{"sourceId":101,"flag":"A"},{"sourceId":999,"flag":"A"}]}',
      REGISTRY_IDS,
    );
    assert.deepEqual(res, [{ sourceId: 101, flag: 'A', flagText: null }]);
  });

  it('coerces an invalid flag to null', () => {
    const res = parseMatchResponse(
      '{"citations":[{"sourceId":101,"flag":"Z"}]}',
      REGISTRY_IDS,
    );
    assert.deepEqual(res, [{ sourceId: 101, flag: null, flagText: null }]);
  });

  it('forces flagText to null even when the AI sends a string', () => {
    const res = parseMatchResponse(
      '{"citations":[{"sourceId":101,"flag":"A","flagText":"some AI rationale"}]}',
      REGISTRY_IDS,
    );
    assert.deepEqual(res, [{ sourceId: 101, flag: 'A', flagText: null }]);
  });

  it('strips markdown code fences', () => {
    const res = parseMatchResponse(
      '```json\n{"citations":[{"sourceId":102,"flag":null}]}\n```',
      REGISTRY_IDS,
    );
    assert.deepEqual(res, [{ sourceId: 102, flag: null, flagText: null }]);
  });

  it('returns an empty array when the AI honestly finds no match', () => {
    const res = parseMatchResponse('{"citations":[]}', REGISTRY_IDS);
    assert.deepEqual(res, []);
  });

  it('returns null on malformed JSON', () => {
    const res = parseMatchResponse('not json at all', REGISTRY_IDS);
    assert.equal(res, null);
  });

  it('returns null when citations field is missing', () => {
    const res = parseMatchResponse('{"foo": 1}', REGISTRY_IDS);
    assert.equal(res, null);
  });

  it('returns null when citations is not an array', () => {
    const res = parseMatchResponse('{"citations": "no"}', REGISTRY_IDS);
    assert.equal(res, null);
  });

  it('dedupes repeated sourceIds keeping the first occurrence', () => {
    const res = parseMatchResponse(
      '{"citations":[{"sourceId":101,"flag":"A"},{"sourceId":101,"flag":"D"}]}',
      REGISTRY_IDS,
    );
    assert.deepEqual(res, [{ sourceId: 101, flag: 'A', flagText: null }]);
  });

  it('extracts JSON from preamble + braces fallback', () => {
    const res = parseMatchResponse(
      'Here is my answer: {"citations":[{"sourceId":101,"flag":null}]} thanks',
      REGISTRY_IDS,
    );
    assert.deepEqual(res, [{ sourceId: 101, flag: null, flagText: null }]);
  });
});

describe('matchQueue', () => {
  it('runs one match per email and reports each result', async () => {
    const e1 = { ...EMAIL, id: 5 } as Email;
    const e2 = { ...EMAIL, id: 6 } as Email;
    const classifications = new Map<number, AiClassification>([
      [5, CLASSIFICATION],
      [6, CLASSIFICATION],
    ]);
    const responses = new Map<number, string>([
      [5, '{"citations":[{"sourceId":101,"flag":"A"}]}'],
      [6, '{"citations":[]}'],
    ]);
    const runPrompt = async (prompt: string): Promise<string> => {
      // Determine which email this prompt is for by subject lookup.
      // Both test emails share a subject so use body identity instead.
      const id = prompt.includes('email-6-marker') ? 6 : 5;
      return responses.get(id) ?? '{}';
    };
    // Tag e2 so the test runPrompt can tell them apart.
    (e2 as { body: string }).body = 'email-6-marker';
    const results: Array<[number, ServerCitation[]]> = [];
    await matchQueue(
      [e1, e2],
      classifications,
      REGISTRY,
      runPrompt,
      (id, citations) => results.push([id, citations]),
      { concurrency: 2 },
    );
    results.sort((a, b) => a[0] - b[0]);
    assert.deepEqual(results, [
      [5, [{ sourceId: 101, flag: 'A', flagText: null }]],
      [6, []],
    ]);
  });

  it('routes malformed responses through onError, not onResult', async () => {
    const classifications = new Map<number, AiClassification>([[5, CLASSIFICATION]]);
    const runPrompt = async (): Promise<string> => 'not json';
    const results: number[] = [];
    const errors: number[] = [];
    await matchQueue(
      [EMAIL],
      classifications,
      REGISTRY,
      runPrompt,
      (id) => results.push(id),
      { onError: (id) => errors.push(id) },
    );
    assert.deepEqual(results, []);
    assert.deepEqual(errors, [5]);
  });

  it('routes runPrompt rejections through onError', async () => {
    const classifications = new Map<number, AiClassification>([[5, CLASSIFICATION]]);
    const runPrompt = async (): Promise<string> => {
      throw new Error('AI service down');
    };
    const results: number[] = [];
    const errors: Array<[number, unknown]> = [];
    await matchQueue(
      [EMAIL],
      classifications,
      REGISTRY,
      runPrompt,
      (id) => results.push(id),
      { onError: (id, err) => errors.push([id, err]) },
    );
    assert.deepEqual(results, []);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], 5);
  });

  it('does no work when given an empty target list', async () => {
    let called = 0;
    await matchQueue(
      [],
      new Map(),
      REGISTRY,
      async () => {
        called += 1;
        return '{}';
      },
      () => {
        throw new Error('onResult should not fire');
      },
    );
    assert.equal(called, 0);
  });
});
