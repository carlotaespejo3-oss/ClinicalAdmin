import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectPotentialTasks } from './potentialTaskDetect.ts';

function make(body: string, subject = 'Re: Darcy', from = 'Mrs Foster <foster@example.com>') {
  return { from, subject, body };
}

describe('detectPotentialTasks — spec example scenarios', () => {
  it('Example 1: detects a phone call task', () => {
    const result = detectPotentialTasks(
      make("Hi Dr Patterson, could you give us a call when you get a chance? We have some questions about Darcy's medication."),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'phone_call');
    assert.equal(result[0].type, 'Phone call');
    assert.equal(result[0].defaultMin, 10);
    assert.match(result[0].suggestedTitle, /Call .* back/);
  });

  it('Example 2: detects an appointment task', () => {
    const result = detectPotentialTasks(
      make('Dear Dr Patterson, we would like to book an appointment to discuss the recent assessment. When would you be available?'),
    );
    assert.equal(result.length >= 1, true);
    const appt = result.find((r) => r.kind === 'appointment');
    assert.notEqual(appt, undefined);
    assert.equal(appt!.type, 'Book appointment');
    assert.equal(appt!.defaultMin, 2);
  });

  it('Example 3: detects a results review task', () => {
    const result = detectPotentialTasks(
      make("Dear Dr Patterson, Darcy's blood results are back and attached to this email for your review."),
    );
    const results = result.find((r) => r.kind === 'results_review');
    assert.notEqual(results, undefined);
    assert.equal(results!.type, 'Review results');
    assert.equal(results!.defaultMin, 5);
  });

  it('Example 4: detects nothing for a thank-you email', () => {
    const result = detectPotentialTasks(
      make('Hi, just wanted to say thank you so much for everything. Darcy is doing really well.'),
    );
    assert.deepEqual(result, []);
  });
});

describe('detectPotentialTasks — additional kinds', () => {
  it('detects a referral request', () => {
    const result = detectPotentialTasks(
      make('Could you refer us to a paediatric occupational therapist?'),
    );
    const ref = result.find((r) => r.kind === 'referral');
    assert.notEqual(ref, undefined);
    assert.equal(ref!.defaultMin, 15);
  });

  it('detects a repeat prescription request', () => {
    const result = detectPotentialTasks(
      make('We need a repeat prescription for the methylphenidate please.'),
    );
    const rx = result.find((r) => r.kind === 'prescription');
    assert.notEqual(rx, undefined);
    assert.equal(rx!.defaultMin, 3);
  });

  it('detects a follow-up', () => {
    const result = detectPotentialTasks(
      make("Just checking in — we haven't heard back about the assessment plan."),
    );
    const fu = result.find((r) => r.kind === 'follow_up');
    assert.notEqual(fu, undefined);
    assert.equal(fu!.defaultMin, 10);
  });

  it('attaches a deadline to the first detected kind', () => {
    const result = detectPotentialTasks(
      make('Could you call us back by next week? We have questions.'),
    );
    const call = result.find((r) => r.kind === 'phone_call');
    assert.notEqual(call, undefined);
    assert.equal(call!.dueDays, 7);
  });

  it('detects multiple independent kinds in one email', () => {
    const result = detectPotentialTasks(
      make('Could you give us a call and also write a referral to OT?'),
    );
    const kinds = result.map((r) => r.kind).sort();
    assert.deepEqual(kinds, ['phone_call', 'referral']);
  });

  it('surfaces a generic deadline prompt when no kind matches but a deadline exists', () => {
    const result = detectPotentialTasks(
      make('Please get back to me by next week regarding the matter we discussed.'),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'deadline');
    assert.equal(result[0].dueDays, 7);
  });

  it('does not duplicate a kind when the same phrase appears twice', () => {
    const result = detectPotentialTasks(
      make('Please call us back. Could you call me when free? Just call us back today.'),
    );
    const calls = result.filter((r) => r.kind === 'phone_call');
    assert.equal(calls.length, 1);
  });
});

describe('detectPotentialTasks — does NOT trigger on benign text', () => {
  it('"call" inside an unrelated word does not match', () => {
    const result = detectPotentialTasks(
      make('I recall the medication discussion was helpful. Thanks!'),
    );
    assert.deepEqual(result, []);
  });

  it('a passing mention of "results" without action does not match', () => {
    const result = detectPotentialTasks(
      make('We were so pleased with the results of therapy this term.'),
    );
    assert.deepEqual(result, []);
  });
});
