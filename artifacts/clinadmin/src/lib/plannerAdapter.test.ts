import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlannerInput, resolveEmailCategory } from './plannerAdapter.ts';
import { CAT } from './data.ts';
import type { Email, ManualTask, AiClassification } from './types.ts';
import type { LinkedDocTask } from './linkedDocTasksStore.ts';
import type { WeekSetup } from '../pages/ClinAdmin.tsx';

const MONDAY = new Date(2026, 4, 11);

function makeEmail(over: Partial<Email> = {}): Email {
  return {
    id: 1,
    from: 'p@example.com',
    subject: 'Subject',
    preview: 'preview',
    body: 'body',
    date: 'Mon 11 May',
    risk: 'low',
    cat: CAT.ADMIN,
    deadline: 7,
    estMin: 10,
    ...over,
  };
}

function makeClassification(over: Partial<AiClassification> = {}): AiClassification {
  return {
    emailId: 1,
    category: 'CLINICAL',
    priority: 'MEDIUM',
    confidence: 0.9,
    reasoning: '',
    classifiedAt: 0,
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
    complexity: null,
    complexityReasons: [],
    ...over,
  };
}

function makeWeekSetup(over: Partial<WeekSetup> = {}): WeekSetup {
  return {
    hours: 4.5,
    days: ['Tue', 'Wed', 'Thu'],
    plan: null,
    sessionLengthMin: 30,
    minutesByDay: { Tue: 90, Wed: 90, Thu: 90 },
    ...over,
  };
}

describe('resolveEmailCategory', () => {
  it('prefers AI classification over legacy cat', () => {
    const e = makeEmail({ cat: CAT.ADMIN });
    const c = makeClassification({ category: 'SAFEGUARDING' });
    assert.equal(resolveEmailCategory(e, c), 'SAFEGUARDING');
  });

  it('falls back to legacy cat mapping when no classification exists', () => {
    assert.equal(resolveEmailCategory(makeEmail({ cat: CAT.URGENT }), undefined), 'URGENT_CLINICAL');
    assert.equal(resolveEmailCategory(makeEmail({ cat: CAT.LEGAL }), undefined), 'LEGAL');
    assert.equal(resolveEmailCategory(makeEmail({ cat: CAT.PROF }), undefined), 'PROFESSIONAL');
    assert.equal(resolveEmailCategory(makeEmail({ cat: CAT.ADMIN }), undefined), 'ADMIN');
  });
});

describe('buildPlannerInput', () => {
  it('skips NONE / DONE emails so they do not crowd the plan', () => {
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [
        makeEmail({ id: 1, cat: CAT.URGENT }),
        makeEmail({ id: 2, cat: CAT.NONE }),
        makeEmail({ id: 3, cat: CAT.DONE }),
      ],
      classifications: new Map(),
      manualTasks: [],
      linkedDocTasks: new Map(),
      weekSetup: makeWeekSetup(),
    });
    assert.equal(input.emails.length, 1);
    assert.equal(input.emails[0].id, 1);
  });

  it('AI classification is authoritative: a seeded-NONE email reclassified as URGENT_CLINICAL is INCLUDED', () => {
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [makeEmail({ id: 5, cat: CAT.NONE })],
      classifications: new Map([[5, makeClassification({ category: 'URGENT_CLINICAL' })]]),
      manualTasks: [],
      linkedDocTasks: new Map(),
      weekSetup: makeWeekSetup(),
    });
    assert.equal(input.emails.length, 1);
    assert.equal(input.emails[0].category, 'URGENT_CLINICAL');
  });

  it('AI classification is authoritative: a seeded-ADMIN email reclassified as NONE is EXCLUDED', () => {
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [makeEmail({ id: 6, cat: CAT.ADMIN })],
      classifications: new Map([[6, makeClassification({ category: 'NONE' })]]),
      manualTasks: [],
      linkedDocTasks: new Map(),
      weekSetup: makeWeekSetup(),
    });
    assert.equal(input.emails.length, 0);
  });

  it('marks an email unclear when AI returns UNCLEAR category or priority', () => {
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [makeEmail({ id: 9 })],
      classifications: new Map([[9, makeClassification({ category: 'UNCLEAR', priority: 'UNCLEAR' })]]),
      manualTasks: [],
      linkedDocTasks: new Map(),
      weekSetup: makeWeekSetup(),
    });
    assert.equal(input.emails[0].unclear, true);
  });

  it('expands WeekSetup days into 14 calendar days with the same weekly pattern', () => {
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [],
      classifications: new Map(),
      manualTasks: [],
      linkedDocTasks: new Map(),
      weekSetup: makeWeekSetup(), // Tue 90, Wed 90, Thu 90
    });
    assert.equal(input.availability.length, 14);
    // Mon (today) → 0; Tue → 90; Wed → 90; Thu → 90; Fri/Sat/Sun → 0
    assert.equal(input.availability[0].minutesAvailable, 0);
    assert.equal(input.availability[1].minutesAvailable, 90);
    assert.equal(input.availability[2].minutesAvailable, 90);
    assert.equal(input.availability[3].minutesAvailable, 90);
    assert.equal(input.availability[4].minutesAvailable, 0);
    // Pattern repeats in week 2.
    assert.equal(input.availability[8].minutesAvailable, 90);
  });

  it('prefers a linked doc task over a manual task pointing at the same email', () => {
    const linked: LinkedDocTask = {
      id: 'doc-7',
      title: 'Write NDIS report',
      estMin: 30,
      deadline: 5,
      linkedEmailId: 7,
      cat: 'Document',
      risk: 'medium',
      type: 'document',
      source: 'document-detection',
      createdAt: 0,
    };
    const manual: ManualTask = {
      id: 'manual-7',
      title: 'Some other follow-up',
      cat: 'Admin',
      deadline: 5,
      risk: 'low',
      type: 'admin',
      estMin: 15,
      linkedEmailId: 7,
    };
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [],
      classifications: new Map(),
      manualTasks: [manual],
      linkedDocTasks: new Map([[7, linked]]),
      weekSetup: makeWeekSetup(),
    });
    assert.equal(input.tasks.length, 1);
    assert.equal(input.tasks[0].id, 'doc-7');
  });

  it('skips done linked doc tasks AND lets the manual fallback through', () => {
    const doneDoc: LinkedDocTask = {
      id: 'doc-7',
      title: 'Old NDIS report',
      estMin: 30,
      deadline: 5,
      linkedEmailId: 7,
      cat: 'Document',
      risk: 'medium',
      type: 'document',
      source: 'document-detection',
      createdAt: 0,
      done: true,
    };
    const fallback: ManualTask = {
      id: 'manual-7',
      title: 'Follow-up after the report',
      cat: CAT.ADMIN,
      deadline: 5,
      risk: 'low',
      type: 'admin',
      estMin: 15,
      linkedEmailId: 7,
    };
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [],
      classifications: new Map(),
      manualTasks: [fallback],
      linkedDocTasks: new Map([[7, doneDoc]]),
      weekSetup: makeWeekSetup(),
    });
    assert.deepEqual(input.tasks.map((t) => t.id), ['manual-7']);
  });

  it('maps a LEGAL-cat manual task to LEGAL even when risk is medium', () => {
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [],
      classifications: new Map(),
      manualTasks: [
        { id: 't1', title: 'Court report', cat: CAT.LEGAL, deadline: 7, risk: 'medium', type: 'legal', estMin: 60 },
      ],
      linkedDocTasks: new Map(),
      weekSetup: makeWeekSetup(),
    });
    assert.equal(input.tasks[0].category, 'LEGAL');
  });

  it('maps a high-risk ADMIN-cat manual task to URGENT_CLINICAL (risk wins on generic cats)', () => {
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [],
      classifications: new Map(),
      manualTasks: [
        { id: 't1', title: 'Urgent admin', cat: CAT.ADMIN, deadline: 1, risk: 'high', type: 'admin', estMin: 15 },
      ],
      linkedDocTasks: new Map(),
      weekSetup: makeWeekSetup(),
    });
    assert.equal(input.tasks[0].category, 'URGENT_CLINICAL');
  });

  it('drops done manual tasks and respects the excludeTaskId predicate', () => {
    const tasks: ManualTask[] = [
      { id: 'a', title: 'Open task', cat: 'Admin', deadline: 7, risk: 'low', type: 'admin', estMin: 10 },
      { id: 'b', title: 'Done task', cat: 'Admin', deadline: 7, risk: 'low', type: 'admin', estMin: 10, done: true },
      { id: 'c', title: 'Excluded task', cat: 'Admin', deadline: 7, risk: 'low', type: 'admin', estMin: 10 },
    ];
    const input = buildPlannerInput({
      today: MONDAY,
      emails: [],
      classifications: new Map(),
      manualTasks: tasks,
      linkedDocTasks: new Map(),
      weekSetup: makeWeekSetup(),
      excludeTaskId: (id) => id === 'c',
    });
    assert.deepEqual(input.tasks.map((t) => t.id), ['a']);
  });
});
