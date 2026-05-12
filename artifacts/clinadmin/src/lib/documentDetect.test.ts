import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectDocumentRequest } from './documentDetect.ts';

describe('detectDocumentRequest — direction-aware', () => {
  describe('Situation A — incoming (FYI documents sent TO the clinician)', () => {
    it('Example 1: Dr Osei sends a psychological assessment FYI', () => {
      const result = detectDocumentRequest({
        subject: 'Lucas Thompson — psychological assessment',
        body:
          'Dear Dr Patterson, please find attached the psychological ' +
          'assessment for Lucas Thompson. I hope this is helpful for ' +
          'your ongoing care. Kind regards, Dr Osei',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'incoming');
      assert.equal(result.documentDueDays, null,
        'incoming FYI documents must not carry a deadline');
    });

    it('detects "please find attached" as incoming', () => {
      const result = detectDocumentRequest({
        subject: 'Discharge summary',
        body: 'Please find attached the discharge summary for our shared patient.',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'incoming');
    });

    it('detects "for your information" as incoming', () => {
      const result = detectDocumentRequest({
        subject: 'Pathology results',
        body: 'Pathology results enclosed for your information and records.',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'incoming');
    });

    it('detects "I am sending you" as incoming', () => {
      const result = detectDocumentRequest({
        subject: 'Progress note',
        body:
          'I am sending you the latest progress note from our last session. ' +
          'No action needed, just sharing for your records.',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'incoming');
    });
  });

  describe('Situation B — outgoing (documents REQUESTED from the clinician)', () => {
    it('Example 2: Mrs Davies requests an EHCP clinical summary letter', () => {
      const result = detectDocumentRequest({
        subject: 'EHCP review — Lucas Thompson',
        body:
          "Dear Dr Patterson, we are completing Lucas Thompson's EHCP " +
          'review and would be grateful if you could provide a brief ' +
          'clinical summary letter. We need this by 20th May. Many ' +
          'thanks, Mrs Davies',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'outgoing');
      assert.notEqual(result.documentType, null);
    });

    it('detects "please complete the form" as outgoing', () => {
      const result = detectDocumentRequest({
        subject: 'NDIS report',
        body: 'Please complete the attached NDIS report form by next week.',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'outgoing');
      assert.equal(result.documentDueDays, 7);
    });

    it('detects "we need a letter" as outgoing', () => {
      const result = detectDocumentRequest({
        subject: 'Insurance certificate',
        body: 'We need a medical certificate within 5 days for the insurance claim.',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'outgoing');
      assert.equal(result.documentDueDays, 5);
    });

    it('detects "could you write a referral letter" as outgoing', () => {
      const result = detectDocumentRequest({
        subject: 'Referral request',
        body: 'Could you write a referral letter for our shared patient?',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'outgoing');
    });

    it('outgoing wins when both incoming and outgoing cues are present', () => {
      // Sometimes a colleague attaches a partial form and asks for the
      // rest to be completed. Action language must win — the unmade
      // task is worse than the extra "received" badge.
      const result = detectDocumentRequest({
        subject: 'NDIS report — section 2',
        body:
          'Please find attached the partial NDIS report. Could you ' +
          'please complete section 2 of the form by next week?',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'outgoing');
    });
  });

  describe('Situation C — unclear (document mentioned, direction ambiguous)', () => {
    it('returns unclear when a document noun is present without clear cues', () => {
      const result = detectDocumentRequest({
        subject: 'EHCP letter',
        body: 'Re: the EHCP letter we discussed last week.',
      });
      assert.equal(result.hasDocument, true);
      assert.equal(result.direction, 'unclear');
      assert.equal(result.documentDueDays, null,
        'unclear documents must not carry a deadline (clinician confirms first)');
    });
  });

  describe('No document detected', () => {
    it('returns hasDocument=false for ordinary clinical questions', () => {
      const result = detectDocumentRequest({
        subject: 'Med query',
        body: "My son's been a bit jittery on the new dose — should we lower it?",
      });
      assert.equal(result.hasDocument, false);
      assert.equal(result.direction, null);
      assert.equal(result.documentType, null);
    });

    it('does not flag a CPD invitation that mentions "feedback form"', () => {
      const result = detectDocumentRequest({
        subject: 'CPD conference',
        body: 'Register for the May CPD day at the link below.',
      });
      assert.equal(result.hasDocument, false);
    });
  });
});
