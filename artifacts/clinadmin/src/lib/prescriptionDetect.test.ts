import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectPrescriptionRequest,
  estimateMinutes,
  suggestedTaskTitle,
  taskDueDays,
  urgencyFor,
} from './prescriptionDetect.ts';

// Pin "today" so weekday-based deadlines are deterministic.
// 2026-05-12 is a Tuesday — Friday is 3 days away (critical).
const TUESDAY = new Date('2026-05-12T09:00:00Z');
// 2026-05-04 is a Monday — Friday is 4 days away (urgent, not critical).
const MONDAY = new Date('2026-05-04T09:00:00Z');

function make(body: string, opts: { from?: string; subject?: string } = {}) {
  return {
    from: opts.from ?? 'Mrs Foster <foster@example.com>',
    subject: opts.subject ?? 'James',
    body,
  };
}

describe('detectPrescriptionRequest — spec test case', () => {
  const SPEC_BODY =
    'James is running low on his Ritalin 54mg and we are going away on Friday. Could we please have an early script for his next month\'s supply?';

  it('detects the prescription request', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY);
    assert.notEqual(r, null);
  });

  it('classifies as early script (not repeat)', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(r.flavour, 'early');
  });

  it('extracts the medication name and dose', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(r.medicationName, 'Ritalin');
    assert.equal(r.medicationDose, '54mg');
  });

  it('extracts the quantity', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.match(r.medicationQuantity ?? '', /month/);
  });

  it('extracts the patient name', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(r.patientName, 'James');
  });

  it('flags Ritalin as a controlled drug', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(r.controlledDrug, true);
  });

  it('flags travel mentioned', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(r.travelMentioned, true);
  });

  it('detects the Friday deadline', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(r.deadlineLabel, 'Friday');
    assert.equal(r.deadlineDays, 3); // Tue → Fri
  });

  it('triggers CRITICAL urgency (≤3 days)', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(urgencyFor(r), 'critical');
  });

  it('estimates 8 minutes for an early controlled-drug script', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(estimateMinutes(r), 8);
  });

  it('builds the spec-format task title', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(suggestedTaskTitle(r), 'Write early script — Ritalin 54mg — James');
  });

  it('sets task due date to one day BEFORE the family deadline (Thursday, not Friday)', () => {
    const r = detectPrescriptionRequest(make(SPEC_BODY), TUESDAY)!;
    assert.equal(taskDueDays(r), 2); // 3 - 1 (Friday minus one)
  });
});

describe('detectPrescriptionRequest — urgency tiers', () => {
  it('Friday from Monday → urgent (4 days), not critical', () => {
    const r = detectPrescriptionRequest(
      make('Running low on Ritalin and we leave on Friday'),
      MONDAY,
    )!;
    assert.equal(r.deadlineDays, 4);
    assert.equal(urgencyFor(r), 'urgent');
  });

  it('no deadline → normal urgency', () => {
    const r = detectPrescriptionRequest(make('Repeat prescription for Concerta please'))!;
    assert.equal(r.deadlineDays, null);
    assert.equal(urgencyFor(r), 'normal');
  });
});

describe('detectPrescriptionRequest — flavours', () => {
  it('detects a plain repeat prescription', () => {
    const r = detectPrescriptionRequest(make('Could we have a repeat prescription for the Sertraline?'))!;
    assert.equal(r.flavour, 'repeat');
    assert.equal(r.controlledDrug, false);
    assert.equal(estimateMinutes(r), 3);
  });

  it('detects a lost prescription as the lost flavour', () => {
    const r = detectPrescriptionRequest(make('We have lost the prescription for Concerta'))!;
    assert.equal(r.flavour, 'lost');
    assert.equal(estimateMinutes(r), 5);
  });

  it('travel + medication → early script even when "early" is not said', () => {
    const r = detectPrescriptionRequest(
      make('Lily takes Vyvanse and we are going away on holiday'),
      MONDAY,
    )!;
    assert.equal(r.flavour, 'early');
    assert.equal(r.travelMentioned, true);
  });

  it('international travel hint surfaced separately', () => {
    const r = detectPrescriptionRequest(
      make('We are going abroad next month and Sam needs more Strattera'),
    )!;
    assert.equal(r.internationalTravelHint, true);
  });
});

describe('detectPrescriptionRequest — false positives', () => {
  it('travel without medication does NOT match', () => {
    const r = detectPrescriptionRequest(make('We are going away on Friday for a school trip'));
    assert.equal(r, null);
  });

  it('"running low" without medication does NOT match', () => {
    const r = detectPrescriptionRequest(make('We are running low on patience with this referral process'));
    assert.equal(r, null);
  });

  it('a thank-you note does NOT match', () => {
    const r = detectPrescriptionRequest(make('Thanks for the appointment last week — Sam is doing well'));
    assert.equal(r, null);
  });
});

describe('helpers', () => {
  it('estimateMinutes: early non-controlled → 5', () => {
    const r = detectPrescriptionRequest(make('Could we have an early script for Sertraline'))!;
    assert.equal(estimateMinutes(r), 5);
  });

  it('taskDueDays floors at 0', () => {
    const r = detectPrescriptionRequest(
      make('Running out of Ritalin and we leave on Tuesday'),
      TUESDAY, // same day → 0
    )!;
    assert.equal(r.deadlineDays, 0);
    assert.equal(taskDueDays(r), 0);
  });
});
