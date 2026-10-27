// W3 Task Q3c (D-7027; ARCH-56 (#791), second PR): the question sweep's pure deciders, every arm as a table row. Each
// row is today's branch in `FleetWatcher#askPass` or `FleetWatcher#sweepApprovals`, mapped to the word the decider
// answers; the PR body tabulates the same rows against today's code.
import { describe, it, expect } from 'vitest';
import {
  APPROVAL_LAPSE_ANSWERS, ASK_LAPSE_ANSWERS, DEFERRED_APPROVAL_PUSH_ANSWERS,
  decideApprovalLapse, decideAskLapse, decideDeferredApprovalPush,
  type AskLapse, type AskLapseRead, type ApprovalLapse, type DeferredApprovalPush, type DeferredApprovalRows,
} from '../src/coord/questionPolicy.js';
import { ASK_ANSWERING_MAX_MS } from '../src/askwindow.js';
import { APPROVAL_HOOK_WAIT_S } from '../../shared/api.js';

const NOW = 1_786_000_000_000;
const due = { until: NOW, answeringSince: null };
const row = (state: string): AskLapseRead => ({ kind: 'row', row: { state: state as never } });

describe('decideAskLapse: every arm of the ask half (askPass)', () => {
  const rows: ReadonlyArray<readonly [string, { until: number; answeringSince: number | null }, AskLapseRead, AskLapse]> = [
    ['the window still open waits', { until: NOW + 1, answeringSince: null }, { kind: 'window' }, 'wait'],
    ['once the release was tried, the window is not read again', { until: NOW + 1, answeringSince: null }, { kind: 'release-won' }, 'push-and-drop'],
    ['due, nothing tried yet: the hold stays and the release is tried', due, { kind: 'window' }, 'keep'],
    ['the release threw keeps the hold', due, { kind: 'release-threw' }, 'keep'],
    ['the released CAS won pushes and drops', due, { kind: 'release-won' }, 'push-and-drop'],
    ['a refused read keeps the hold', due, { kind: 'row-refused' }, 'keep'],
    ['a thrown read keeps the hold', due, { kind: 'row-threw' }, 'keep'],
    ['the row gone pushes and drops', due, { kind: 'row', row: null }, 'push-and-drop'],
    ['answering, first sighting, keeps', due, row('answering'), 'keep'],
    ['answering under the bound keeps', { until: NOW, answeringSince: NOW - ASK_ANSWERING_MAX_MS + 1 }, row('answering'), 'keep'],
    ['answering at the bound pushes and drops', { until: NOW, answeringSince: NOW - ASK_ANSWERING_MAX_MS }, row('answering'), 'push-and-drop'],
    ['answering past the bound pushes and drops', { until: NOW, answeringSince: NOW - ASK_ANSWERING_MAX_MS - 1 }, row('answering'), 'push-and-drop'],
    ['answered drops', due, row('answered'), 'drop'],
    ['released drops', due, row('released'), 'drop'],
    ['declined drops', due, row('declined'), 'drop'],
    ['stale drops', due, row('stale'), 'drop'],
    ['held (the CAS lost a race) keeps and resets', { until: NOW, answeringSince: NOW - 5 }, row('held'), 'keep-reset'],
    ['an unknown state pushes', due, row('unknown'), 'push-and-drop'],
    ['a state outside the vocabulary pushes', due, row('from-the-future'), 'push-and-drop'],
  ];
  it.each(rows)('%s', (_name, carrier, read, want) => {
    expect(decideAskLapse(carrier, read, NOW)).toBe(want);
  });
  it('every answer is some row\'s answer', () => {
    expect(new Set(rows.map((r) => r[3]))).toEqual(new Set(Object.keys(ASK_LAPSE_ANSWERS)));
  });
});

describe('decideApprovalLapse: the approval half\'s row clock (sweepApprovals)', () => {
  const ceiling = APPROVAL_HOOK_WAIT_S * 1000;
  const r = (state: string, askAt: number, notifyAt: number) => ({ state: state as never, askAt, notifyAt });
  const rows: ReadonlyArray<readonly [string, ReturnType<typeof r>, ApprovalLapse]> = [
    ['held inside its window: none', r('held', NOW - 1_000, NOW + 1), 'none'],
    ['held at notifyAt: lapse', r('held', NOW - 1_000, NOW), 'lapse'],
    ['held past notifyAt: lapse', r('held', NOW - 1_000, NOW - 1), 'lapse'],
    ['held past notifyAt and the ceiling: lapse first', r('held', NOW - ceiling, NOW - 1), 'lapse'],
    ['held inside its window but past the ceiling: stale', r('held', NOW - ceiling, NOW + 1), 'stale'],
    ['released before the ceiling: none', r('released', NOW - ceiling + 1, NOW - 1), 'none'],
    ['released at the ceiling: stale', r('released', NOW - ceiling, NOW - 1), 'stale'],
    ['allowed past both: none', r('allowed', NOW - ceiling, NOW - 1), 'none'],
    ['operator past both: none', r('operator', NOW - ceiling, NOW - 1), 'none'],
  ];
  it.each(rows)('%s', (_name, input, want) => {
    expect(decideApprovalLapse(input, NOW)).toBe(want);
  });
  it('a held row due for both is stale once it is the released row it lapses to', () => {
    expect(decideApprovalLapse({ state: 'released', askAt: NOW - ceiling, notifyAt: NOW - 1 }, NOW)).toBe('stale');
  });
  it('every answer is some row\'s answer', () => {
    expect(new Set(rows.map((x) => x[2]))).toEqual(new Set(Object.keys(APPROVAL_LAPSE_ANSWERS)));
  });
});

describe('decideDeferredApprovalPush: the deferred push (sweepApprovals)', () => {
  const GRACE = 10_000;
  const a = (id: number, state: string, notifyAt: number, ruledAt: number | null) => ({ id, state: state as never, notifyAt, ruledAt });
  const ok = (...rs: ReturnType<typeof a>[]): DeferredApprovalRows => ({ ok: true, rows: rs });
  const rows: ReadonlyArray<readonly [string, number[], DeferredApprovalRows, boolean, DeferredApprovalPush]> = [
    ['an unreadable read waits', [1], { ok: false }, true, 'wait'],
    ['a covered row held in its window waits', [1], ok(a(1, 'held', NOW + 1, null)), true, 'wait'],
    ['a covered row held past its window (the lapse lost) does not wait', [1], ok(a(1, 'held', NOW, null)), true, 'push'],
    ['ruled within the grace defers', [1], ok(a(1, 'allowed', NOW - 1, NOW - GRACE + 1)), true, 'wait'],
    ['ruled at the grace\'s end pushes', [1], ok(a(1, 'allowed', NOW - 1, NOW - GRACE)), true, 'push'],
    ['every covered row ruled within the grace defers', [1, 2], ok(a(1, 'allowed', NOW, NOW - 1), a(2, 'denied', NOW, NOW - 2)), true, 'wait'],
    ['one covered row not ruled: pushes', [1, 2], ok(a(1, 'allowed', NOW, NOW - 1)), true, 'push'],
    ['a covered row ruled but with no ruledAt: pushes', [1], ok(a(1, 'denied', NOW, null)), true, 'push'],
    ['no covered row read: pushes', [1], ok(a(9, 'held', NOW + 1, null)), true, 'push'],
    ['an entry covering nothing: pushes', [], ok(), true, 'push'],
    ['not held and not ruled, still painted: pushes', [1], ok(), true, 'push'],
    ['not held and not ruled, no longer painted: drops', [1], ok(), false, 'drop'],
  ];
  it.each(rows)('%s', (_name, rowIds, read, painted, want) => {
    expect(decideDeferredApprovalPush({ rowIds }, read, NOW, painted, GRACE)).toBe(want);
  });
  it('the grace is measured from ruledAt, not from askAt or notifyAt', () => {
    // Ruled 5 s ago, minted and windowed long before: within the grace from `ruledAt` alone.
    expect(decideDeferredApprovalPush({ rowIds: [1] }, ok(a(1, 'allowed', NOW - 60_000, NOW - 5_000)), NOW, true, GRACE)).toBe('wait');
  });
  it('every answer is some row\'s answer', () => {
    expect(new Set(rows.map((x) => x[4]))).toEqual(new Set(Object.keys(DEFERRED_APPROVAL_PUSH_ANSWERS)));
  });
});
