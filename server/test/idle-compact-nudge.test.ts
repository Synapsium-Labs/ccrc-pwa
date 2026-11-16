import { describe, it, expect } from 'vitest';
import { TASKS_STALE_MS } from '../../shared/api.js';
import {
  decideIdleCompactNudge, idleNudgeDisabled, idleNudgeFeedBody, IDLE_NUDGE_HOLDS, IDLE_NUDGE_SETTLE_MS,
  isIdleCompaction, readCompactionTail, type IdleNudgeFacts, type IdleNudgeHold,
} from '../src/idlenudge.js';
import { IDLE_TAIL, IDLE_TAIL_NO_NOTICE, MID_TURN_TAIL, ROW, T_BOUNDARY, T_NOTICE, jsonl } from './idleNudgeFixtures.js';

// D-5373 `idle-compact-nudge`: the L1 decision. Fixtures are the measured shapes (a Stop, ~3,300 s idle, the
// compaction rows, the notice row); content is neutral.

describe('readCompactionTail: the newest compaction and the facts around it (D-5373)', () => {
  it('the measured idle compaction: notice, finished turn before, nothing after', () => {
    const c = readCompactionTail(jsonl(IDLE_TAIL));
    expect(c).toEqual({
      kind: 'compaction', key: 'b1', at: T_BOUNDARY, trigger: 'auto',
      notice: true, finishedBefore: true, turnAfter: false, userAfter: false,
    });
    expect(isIdleCompaction(c)).toBe(true);
  });
  it('with no notice row, trigger auto after a finished turn is still idle', () => {
    const c = readCompactionTail(jsonl(IDLE_TAIL_NO_NOTICE));
    expect(c).toMatchObject({ kind: 'compaction', notice: false, finishedBefore: true });
    expect(isIdleCompaction(c)).toBe(true);
  });
  it('a compaction in the middle of a turn is not idle, and the turn after it is seen', () => {
    const c = readCompactionTail(jsonl(MID_TURN_TAIL));
    expect(c).toMatchObject({ kind: 'compaction', notice: false, finishedBefore: false, turnAfter: true });
    expect(isIdleCompaction(c)).toBe(false);
  });
  it('end_turn with no stop_hook_summary/turn_duration after it is not a finished turn', () => {
    const rows = IDLE_TAIL_NO_NOTICE.filter((r) => r !== ROW.stopHook && r !== ROW.turnDuration);
    expect(readCompactionTail(jsonl(rows))).toMatchObject({ finishedBefore: false });
  });
  it('a prompt between the end_turn and the boundary means the turn was not finished', () => {
    const rows = [ROW.endTurn, ROW.stopHook, ROW.prompt, ROW.boundary, ROW.summary];
    expect(readCompactionTail(jsonl(rows))).toMatchObject({ finishedBefore: false });
  });
  it('a manual compaction after a finished turn is not idle without the notice', () => {
    const manual = { ...ROW.boundary, compactMetadata: { ...ROW.boundary.compactMetadata, trigger: 'manual' } };
    const c = readCompactionTail(jsonl([ROW.endTurn, ROW.stopHook, manual, ROW.summary]));
    expect(isIdleCompaction(c)).toBe(false);
  });
  it('the operator typing, the nudge itself, or a queued command after the boundary is a user entry', () => {
    expect(readCompactionTail(jsonl([...IDLE_TAIL, ROW.operator]))).toMatchObject({ userAfter: true });
    expect(readCompactionTail(jsonl([...IDLE_TAIL, ROW.nudge]))).toMatchObject({ userAfter: true });
    const queued = { type: 'attachment', uuid: 'q1', attachment: { type: 'queued_command', prompt: 'x', commandMode: 'prompt' } };
    expect(readCompactionTail(jsonl([...IDLE_TAIL, queued]))).toMatchObject({ userAfter: true });
  });
  it('the summary, a harness isMeta row and a sidechain row after the boundary are not user entries', () => {
    const meta = { type: 'user', uuid: 'm1', isMeta: true, message: { role: 'user', content: 'harness text' } };
    const side = { ...ROW.operator, isSidechain: true };
    const sideTurn = { ...ROW.resumed, isSidechain: true };
    expect(readCompactionTail(jsonl([...IDLE_TAIL, meta, side, sideTurn]))).toMatchObject({ userAfter: false, turnAfter: false });
  });
  it('only the NEWEST boundary counts: an older idle compaction followed by work and a mid-turn one is not idle', () => {
    const c = readCompactionTail(jsonl([...IDLE_TAIL, ROW.operator, ...MID_TURN_TAIL]));
    expect(isIdleCompaction(c)).toBe(false);
  });
  it('no boundary in the window, a cut first line and junk lines answer none without throwing', () => {
    expect(readCompactionTail('{"type":"assi\nnot json\n' + jsonl([ROW.endTurn, ROW.stopHook]))).toEqual({ kind: 'none' });
    expect(readCompactionTail('')).toEqual({ kind: 'none' });
  });
  it('a boundary with no uuid is keyed by its timestamp', () => {
    const { uuid: _u, ...noUuid } = ROW.boundary;
    expect(readCompactionTail(jsonl([ROW.endTurn, ROW.stopHook, noUuid, ROW.notice]))).toMatchObject({ key: ROW.boundary.timestamp });
  });
});

/** The happy path: every hold clear, 40 s after the notice. */
const NOW = T_NOTICE + 40_000;
const happy = (over: Partial<IdleNudgeFacts> = {}): IdleNudgeFacts => ({
  disabled: false, durable: true, unmeasured: false, lifecycle: 'running', archived: false, status: 'idle',
  dialogPending: false, askSummary: null, ask: null,
  now: NOW,
  live: { ok: true, word: 'idle', since: T_NOTICE },
  mark: { ok: true, state: 'done', bg: 0 },
  tasks: { ok: true, open: 2, touchedAt: NOW - 10 * 60_000 },
  compaction: readCompactionTail(jsonl(IDLE_TAIL)),
  alreadyNudged: () => false,
  ...over,
});

describe('decideIdleCompactNudge: fires only when every hold is clear (D-5373)', () => {
  it('HAPPY PATH: an idle compaction, idle and settled, done with bg 0, a fresh open task list → nudge, keyed by the boundary', () => {
    expect(decideIdleCompactNudge(happy())).toEqual({ act: 'nudge', key: 'b1' });
  });
  it('without the notice row, trigger auto after a finished turn still nudges', () => {
    expect(decideIdleCompactNudge(happy({ compaction: readCompactionTail(jsonl(IDLE_TAIL_NO_NOTICE)) }))).toEqual({ act: 'nudge', key: 'b1' });
  });

  const cases: [IdleNudgeHold, Partial<IdleNudgeFacts>][] = [
    ['disabled', { disabled: true }],
    ['no-store', { durable: false }],
    ['unmeasured', { unmeasured: true }],
    ['not-running', { lifecycle: 'stopped' }],
    ['not-running', { lifecycle: null }],
    ['archived', { archived: true }],
    ['not-idle', { status: 'busy' }],
    ['dialog', { dialogPending: true }],
    ['ask', { askSummary: 'Which option?' }],
    ['ask', { ask: 'held' }],
    ['ask', { ask: 'unknown' }],
    ['unmeasured', { live: { ok: false } }],
    ['not-idle', { live: { ok: true, word: 'busy', since: T_NOTICE } }],
    ['not-idle', { live: { ok: true, word: 'shell', since: T_NOTICE } }],
    ['no-marker', { mark: { ok: false } }],
    ['turn-open', { mark: { ok: true, state: 'working', bg: 0 } }],
    ['background', { mark: { ok: true, state: 'done', bg: 1 } }],
    ['background', { mark: { ok: true, state: 'done', bg: -1 } }],
    ['tasks-unread', { tasks: { ok: false } }],
    ['no-open-tasks', { tasks: { ok: true, open: 0, touchedAt: null } }],
    ['tasks-stale', { tasks: { ok: true, open: 4, touchedAt: NOW - 3 * 24 * 3_600_000 } }],
    ['tasks-stale', { tasks: { ok: true, open: 4, touchedAt: NOW - TASKS_STALE_MS - 1 } }],
    ['tasks-stale', { tasks: { ok: true, open: 4, touchedAt: null } }],
    ['no-compaction', { compaction: { kind: 'none' } }],
    ['not-idle-compaction', { compaction: readCompactionTail(jsonl(MID_TURN_TAIL.filter((r) => r !== ROW.resumed))) }],
    ['turn-after', { compaction: readCompactionTail(jsonl([...IDLE_TAIL, ROW.resumed])) }],
    ['operator-typed', { compaction: readCompactionTail(jsonl([...IDLE_TAIL, ROW.operator])) }],
    ['operator-typed', { compaction: readCompactionTail(jsonl([...IDLE_TAIL, ROW.nudge])) }],
    ['settling', { now: T_BOUNDARY + IDLE_NUDGE_SETTLE_MS - 1, live: { ok: true, word: 'idle', since: T_BOUNDARY } }],
    ['settling', { live: { ok: true, word: 'idle', since: NOW - IDLE_NUDGE_SETTLE_MS + 1 } }],
    ['already-nudged', { alreadyNudged: (k) => k === 'b1' }],
  ];
  it.each(cases)('HOLD %s', (reason, over) => {
    expect(decideIdleCompactNudge(happy(over))).toEqual({ act: 'hold', reason });
  });
  it('the settle edge: exactly IDLE_NUDGE_SETTLE_MS after the later of the boundary and the idle status nudges', () => {
    expect(decideIdleCompactNudge(happy({ live: { ok: true, word: 'idle', since: NOW - IDLE_NUDGE_SETTLE_MS } })).act).toBe('nudge');
  });
  it('the freshness edge: touched exactly TASKS_STALE_MS ago is still fresh', () => {
    expect(decideIdleCompactNudge(happy({ tasks: { ok: true, open: 1, touchedAt: NOW - TASKS_STALE_MS } })).act).toBe('nudge');
  });
  it('every hold the vocabulary names is exercised above', () => {
    expect(new Set(cases.map(([r]) => r))).toEqual(new Set(IDLE_NUDGE_HOLDS));
  });
});

describe('the kill switch and the durable key (D-5373)', () => {
  it('the marker is a whole file name in the registry listing', () => {
    expect(idleNudgeDisabled(['a.hold', 'idle-compact-nudge-disabled'])).toBe(true);
    expect(idleNudgeDisabled(['idle-compact-nudge-disabled.bak', 'x'])).toBe(false);
  });
  it('the feed body is derived from the compaction key alone, so it is the same across restarts', () => {
    expect(idleNudgeFeedBody('b1')).toBe(idleNudgeFeedBody('b1'));
    expect(idleNudgeFeedBody('b1')).not.toBe(idleNudgeFeedBody('b2'));
    expect(idleNudgeFeedBody('b1')).toContain('b1');
  });
});
