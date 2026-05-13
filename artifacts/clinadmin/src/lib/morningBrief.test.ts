import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildMorningBrief, type MorningBriefInput } from './morningBrief.ts';
import { CAT } from './data.ts';
import type { Email, ManualTask } from './types.ts';

function makeEmail(over: Partial<Email> = {}): Email {
  return {
    id: 1,
    from: 'someone@example.com',
    subject: 'Subject',
    preview: '',
    body: 'Body',
    date: '',
    risk: 'low',
    cat: CAT.ADMIN,
    deadline: 5,
    estMin: 10,
    ...over,
  };
}

function makeTask(over: Partial<ManualTask> = {}): ManualTask {
  return {
    id: 't1',
    title: 'Task',
    cat: 'admin',
    deadline: 5,
    risk: 'low',
    type: 'admin',
    estMin: 10,
    ...over,
  };
}

function baseInput(over: Partial<MorningBriefInput> = {}): MorningBriefInput {
  return {
    emails: [],
    manualTasks: [],
    acknowledgedEmailIds: new Set(),
    archivedEmailIds: new Set(),
    linkedDocEmailIds: new Set(),
    recommendedMin: 240,
    allocatedMin: 240,
    ...over,
  };
}

describe('buildMorningBrief — cannot-wait selection', () => {
  it('picks no items when nothing is urgent', () => {
    const brief = buildMorningBrief(
      baseInput({
        emails: [makeEmail({ id: 1, deadline: 7 }), makeEmail({ id: 2, deadline: 14 })],
      }),
    );
    assert.equal(brief.cannotWait.length, 0);
    assert.equal(brief.cannotWaitTotal, 0);
    assert.equal(brief.cannotWaitOverflow, 0);
  });

  it('caps to 2 visible items but reports total + overflow', () => {
    const brief = buildMorningBrief(
      baseInput({
        emails: [
          makeEmail({ id: 1, cat: CAT.URGENT }),
          makeEmail({ id: 2, cat: CAT.URGENT }),
          makeEmail({ id: 3, cat: CAT.URGENT }),
          makeEmail({ id: 4, cat: CAT.URGENT }),
        ],
      }),
    );
    assert.equal(brief.cannotWait.length, 2);
    assert.equal(brief.cannotWaitTotal, 4);
    assert.equal(brief.cannotWaitOverflow, 2);
  });

  it('orders SAFEGUARDING (UNSAFE) before generic urgent and overdue', () => {
    const brief = buildMorningBrief(
      baseInput({
        emails: [
          makeEmail({ id: 10, cat: CAT.URGENT }),
          makeEmail({ id: 11, cat: CAT.UNSAFE }),
          makeEmail({ id: 12, deadline: -2 }),
        ],
      }),
    );
    assert.equal(brief.cannotWait[0].id, 11);
    assert.equal(brief.cannotWait[0].reason, 'Needs clinical assessment');
    assert.equal(brief.cannotWait[1].id, 10);
  });

  it('flags overdue and due-today emails by deadline alone', () => {
    const brief = buildMorningBrief(
      baseInput({
        emails: [
          makeEmail({ id: 1, deadline: 0 }),
          makeEmail({ id: 2, deadline: -3 }),
          makeEmail({ id: 3, deadline: 5 }),
        ],
      }),
    );
    const ids = brief.cannotWait.map((i) => i.id);
    assert.deepEqual(ids, [2, 1], 'overdue ranks above due-today');
    assert.match(brief.cannotWait[0].reason, /Overdue by 3d/);
    assert.equal(brief.cannotWait[1].reason, 'Due today');
  });

  it('drops items the clinician has already acknowledged or archived', () => {
    const brief = buildMorningBrief(
      baseInput({
        emails: [
          makeEmail({ id: 1, cat: CAT.URGENT }),
          makeEmail({ id: 2, cat: CAT.URGENT }),
        ],
        acknowledgedEmailIds: new Set([1]),
        archivedEmailIds: new Set([2]),
      }),
    );
    assert.equal(brief.cannotWaitTotal, 0);
  });

  it('drops NONE-category emails (newsletters, FYI threads)', () => {
    const brief = buildMorningBrief(
      baseInput({
        emails: [makeEmail({ id: 1, cat: CAT.NONE, deadline: 0 })],
      }),
    );
    assert.equal(brief.cannotWaitTotal, 0);
  });

  it('drops linked-doc tasks whose work is already counted by the open email', () => {
    // Email 5 is open AND has its combined doc block represented by
    // the email row — counting the task too would double-count.
    // The cannot-wait list should show the email only, not the task.
    const brief = buildMorningBrief(
      baseInput({
        emails: [makeEmail({ id: 5, cat: CAT.URGENT, subject: 'Doc request' })],
        manualTasks: [makeTask({ id: 't1', deadline: 0, linkedEmailId: 5 })],
        linkedDocEmailIds: new Set([5]),
      }),
    );
    assert.equal(brief.cannotWaitTotal, 1);
    assert.equal(brief.cannotWait[0].kind, 'email');
    assert.equal(brief.cannotWait[0].id, 5);
  });

  it('includes high-risk tasks due today', () => {
    const brief = buildMorningBrief(
      baseInput({
        manualTasks: [makeTask({ id: 't9', deadline: 0, risk: 'high', title: 'Court report' })],
      }),
    );
    assert.equal(brief.cannotWaitTotal, 1);
    assert.equal(brief.cannotWait[0].title, 'Court report');
  });

  it('ignores done tasks', () => {
    const brief = buildMorningBrief(
      baseInput({
        manualTasks: [makeTask({ id: 't1', deadline: 0, done: true })],
      }),
    );
    assert.equal(brief.cannotWaitTotal, 0);
  });

  it('still surfaces an open linked-doc task when its email has been replied/archived', () => {
    // Email 5 is a linked-doc email already acknowledged — the doc
    // task remains open and must still appear in the cannot-wait list.
    const brief = buildMorningBrief(
      baseInput({
        emails: [makeEmail({ id: 5, cat: CAT.URGENT })],
        manualTasks: [
          makeTask({
            id: 't5',
            title: 'Write referral letter',
            deadline: 0,
            linkedEmailId: 5,
          }),
        ],
        acknowledgedEmailIds: new Set([5]),
        linkedDocEmailIds: new Set([5]),
      }),
    );
    assert.equal(brief.cannotWaitTotal, 1);
    assert.equal(brief.cannotWait[0].title, 'Write referral letter');
  });

  it('flags an urgent-clinical manual task even with a non-immediate deadline', () => {
    const brief = buildMorningBrief(
      baseInput({
        manualTasks: [
          makeTask({
            id: 'tU',
            cat: CAT.URGENT,
            deadline: 5,
            title: 'Crisis follow-up call',
          }),
        ],
      }),
    );
    assert.equal(brief.cannotWaitTotal, 1);
    assert.equal(brief.cannotWait[0].reason, 'Urgent clinical');
  });

  it('ranks a safeguarding (UNSAFE) task above an overdue admin task', () => {
    const brief = buildMorningBrief(
      baseInput({
        manualTasks: [
          makeTask({ id: 'admin', deadline: -2, title: 'Late expense claim' }),
          makeTask({ id: 'safe', cat: CAT.UNSAFE, deadline: 7, title: 'Safeguarding note' }),
        ],
      }),
    );
    assert.equal(brief.cannotWait[0].id, 'safe');
    assert.equal(brief.cannotWait[0].reason, 'Needs clinical assessment');
  });
});

describe('buildMorningBrief — week trajectory', () => {
  it('ON_TRACK when allocated >= recommended', () => {
    const brief = buildMorningBrief(baseInput({ recommendedMin: 200, allocatedMin: 240 }));
    assert.equal(brief.trajectory.state, 'ON_TRACK');
    assert.equal(brief.trajectory.shortfallMin, 0);
  });

  it('DRIFTING in the 70–100% band', () => {
    const brief = buildMorningBrief(baseInput({ recommendedMin: 200, allocatedMin: 160 }));
    assert.equal(brief.trajectory.state, 'DRIFTING');
    assert.equal(brief.trajectory.shortfallMin, 40);
    assert.match(brief.trajectory.detail, /short this week/);
  });

  it('OVERLOADED below 70%', () => {
    const brief = buildMorningBrief(baseInput({ recommendedMin: 300, allocatedMin: 120 }));
    assert.equal(brief.trajectory.state, 'OVERLOADED');
    assert.equal(brief.trajectory.shortfallMin, 180);
    assert.match(brief.trajectory.headline, /Building up/);
  });

  it('handles zero recommended workload defensively', () => {
    const brief = buildMorningBrief(baseInput({ recommendedMin: 0, allocatedMin: 0 }));
    assert.equal(brief.trajectory.state, 'ON_TRACK');
    assert.equal(brief.trajectory.shortfallMin, 0);
  });

  it('formats hours+minutes nicely in the detail line', () => {
    const brief = buildMorningBrief(baseInput({ recommendedMin: 360, allocatedMin: 270 }));
    // 90 min shortfall → "1h 30min"
    assert.match(brief.trajectory.detail, /1h 30min/);
  });
});
