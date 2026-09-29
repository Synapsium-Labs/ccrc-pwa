// Task 5 of the worker stall watch, wave 1 (spec 2026-09-29 §4.2, §10): the pure verdict and its facts.
// Every input is built by the small factories below, and every clock is an argument. The golden fixtures
// use the spec's measured UTC times (§1: S1–S4, run 129, run 31). A value the spec does not measure (a
// dispatch time, a mail id or time the census does not give) is marked `chosen` where it is defined.
import { describe, it, expect } from 'vitest';
import {
  stallVerdict, stallFacts, stallSubjects, isStallKebab,
  STALL_QUIET_MS, STALL_ESCALATE_MS, STALL_OPERATOR_MS, LIMIT_HOLD_CAP_MS, AUTO_CONTINUE_RECENT_MS,
  COORD_BALL_CAP_MS, ASK_DIALOG_SLACK_MS,
  STALL_CHECK_PREFIX, STALL_REPLY_PREFIX, STALL_REPLY_WAITING_PREFIX, STALL_REPORT_PREFIX, STALL_WAIT_PREFIX,
} from '../src/coord/stall.js';
import type {
  CoordinatorState, LiveWordRead, StallArm, StallArming, StallHold, StallInput, StallMailRow, StallMode,
  StallNotice, StallR3Cause, StallRunRow, StallSubject, StallVerdict, StallWorker,
} from '../src/coord/stall.js';
import { REVIEW_DONE_SUBJECT, WAVE_DONE_SUBJECT } from '../../shared/api.js';

const H = 3_600_000;
const MIN = 60_000;
const t = (iso: string): number => Date.parse(iso);

const WORKER = 'demo-worker';
const COORD = 'demo-calm-mesa';
const PEER = 'demo-soft-basin';
/** chosen: run 67's wave 9/9 was open before S1 began; the spec does not give its dispatch time. */
const RUN67_DISPATCHED = t('2026-09-15T12:00:00Z');
const NOW = t('2026-09-29T12:00:00Z');

const ARMED: StallArming = { disabled: false, live: true, escalate: true };
const LIVE_ONLY: StallArming = { disabled: false, live: true, escalate: false };
const SHADOW: StallArming = { disabled: false, live: false, escalate: false };

type PresentWorker = Extract<StallWorker, { present: true }>;

function runRow(over: Partial<StallRunRow> = {}): StallRunRow {
  return {
    id: 67, kind: 'work', state: 'working', sessionId: WORKER, claimedBy: COORD,
    dispatchedAt: RUN67_DISPATCHED, program: 'demo-program', wave: 9, waveOf: 9,
    project: 'demo', workspace: 'demo-ws', ...over,
  };
}

/** A present, fully measured worker whose word has read idle for 3 h: the base input fires r1 at NOW. */
function workerAt(over: Partial<PresentWorker> = {}): PresentWorker {
  return {
    present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 },
    dialogPending: false, stranded: false, swapBlocked: false,
    live: { ok: true, word: 'idle', since: NOW - 3 * H },
    hookAsk: { kind: 'none' }, askRow: { kind: 'none' }, autoContinueHeldAt: null, ...over,
  };
}

function liveWord(word: string, since: number | null): LiveWordRead {
  return { ok: true, word, since };
}

function mailRow(id: number, at: number, fromId: string, toId: string, kind = 'status', subject = 'progress', runId = 67): StallMailRow {
  return { id, at, runId, fromId, toId, kind, subject };
}

function notice(mode: StallMode, arm: StallArm, rung: 1 | 2 | 3, key: number, at: number): StallNotice {
  return { mode, arm, rung, key, at };
}

interface Over {
  primary?: Partial<StallRunRow>; runs?: readonly StallRunRow[]; subject?: StallSubject; worker?: StallWorker;
  mail?: readonly StallMailRow[]; notices?: readonly StallNotice[]; arming?: StallArming;
  coordinationPaused?: boolean; coordinator?: CoordinatorState | null;
}
function stallInput(over: Over = {}): StallInput {
  const primary = runRow(over.primary);
  return {
    subject: over.subject ?? { primary, runs: over.runs ?? [primary] },
    worker: over.worker ?? workerAt(),
    mail: over.mail ?? [],
    notices: over.notices ?? [],
    arming: over.arming ?? ARMED,
    coordinationPaused: over.coordinationPaused ?? false,
    coordinator: over.coordinator ?? null,
  };
}

const NONE: StallVerdict = { act: 'none' };
const hold = (why: StallHold): StallVerdict => ({ act: 'hold', why });
const r1 = (key: number): StallVerdict => ({ act: 'notify', arm: 'quiet', rung: 1, key, to: 'worker' });
const r2 = (key: number, coordinatorId = COORD): StallVerdict =>
  ({ act: 'notify', arm: 'quiet', rung: 2, key, to: 'coordinator', coordinatorId });
const r3 = (key: number, because: StallR3Cause): StallVerdict =>
  ({ act: 'notify', arm: 'quiet', rung: 3, key, to: 'operator', because });
const capOf = (arm: 'limit-cap' | 'dialog-cap' | 'coord-ball', key: number): StallVerdict =>
  ({ act: 'notify', arm, rung: 1, key, to: 'operator' });

describe('the wave-1 constants (spec §10)', () => {
  it('carry the spec values', () => {
    expect({ STALL_QUIET_MS, STALL_ESCALATE_MS, STALL_OPERATOR_MS, LIMIT_HOLD_CAP_MS, AUTO_CONTINUE_RECENT_MS, COORD_BALL_CAP_MS, ASK_DIALOG_SLACK_MS })
      .toEqual({
        STALL_QUIET_MS: 2 * H, STALL_ESCALATE_MS: H, STALL_OPERATOR_MS: H, LIMIT_HOLD_CAP_MS: 12.5 * H,
        AUTO_CONTINUE_RECENT_MS: 10 * MIN, COORD_BALL_CAP_MS: 30 * H, ASK_DIALOG_SLACK_MS: MIN,
      });
  });
});

describe('stallVerdict order: first match wins (spec §10, wave-1 subset)', () => {
  const QUESTION = [mailRow(4001, NOW - 4 * H, WORKER, 'coordinator', 'question', 'which base?')];
  const v = (over: Over = {}): StallVerdict => stallVerdict(stallInput(over), NOW);

  it('the base input fires r1, so every row below changes exactly one thing', () => {
    expect(v()).toEqual(r1(RUN67_DISPATCHED));
  });

  it.each([
    ['a run in unknown', { state: 'unknown' }],
    ['a state this build cannot name', { state: 'parked-by-a-newer-build' }],
    ['a run kind of unknown', { kind: 'unknown' }],
    ['a run kind this build cannot name', { kind: 'audit' }],
  ] as Array<[string, Partial<StallRunRow>]>)('1: %s holds run-unnamed', (_label, primary) => {
    expect(v({ primary })).toEqual(hold('run-unnamed'));
  });

  it('1 before 2: an unnamed run holds run-unnamed even when its worker is absent', () => {
    expect(v({ primary: { state: 'unknown' }, worker: { present: false } })).toEqual(hold('run-unnamed'));
  });

  it('2: a worker missing from this tick holds absent', () => {
    expect(v({ worker: { present: false } })).toEqual(hold('absent'));
  });

  it.each(['restarting', 'stopped', 'orphan', 'never-started'])('3: lifecycle %s holds lifecycle', (lifecycle) => {
    expect(v({ worker: workerAt({ lifecycle }) })).toEqual(hold('lifecycle'));
  });

  it.each(['unsupervised', 'unclaimed'])('3: lifecycle %s is an alive pane, judged as running', (lifecycle) => {
    expect(v({ worker: workerAt({ lifecycle }) })).toEqual(r1(RUN67_DISPATCHED));
  });

  it('3 before 4: a stopped worker with a held ask holds lifecycle', () => {
    const worker = workerAt({ lifecycle: 'stopped', live: liveWord('waiting', NOW - H), askRow: { kind: 'row', state: 'held', at: NOW - H } });
    expect(v({ worker })).toEqual(hold('lifecycle'));
  });

  it('4 before 5: an open dialog on a limit-locked worker holds dialog', () => {
    const worker = workerAt({ live: liveWord('waiting', NOW - 30 * MIN), limits: { five: 100, seven: 10 } });
    expect(v({ worker })).toEqual(hold('dialog'));
  });

  it.each([
    ['the 5 h window at 100', { limits: { five: 100, seven: 10 } }],
    ['the 7 d window at 100', { limits: { five: 3, seven: 100 } }],
    ['the 7 d window over 100', { limits: { five: 3, seven: 100.5 } }],
    ['a stranded worker', { stranded: true }],
    ['a swap-blocked worker', { swapBlocked: true }],
    ['an auto-continue hold begun inside AUTO_CONTINUE_RECENT_MS', { autoContinueHeldAt: NOW - AUTO_CONTINUE_RECENT_MS + 1 }],
  ] as Array<[string, Partial<PresentWorker>]>)('5: %s holds limit', (_label, over) => {
    expect(v({ worker: workerAt(over) })).toEqual(hold('limit'));
  });

  it('5: the limit boundaries: 99.9 is under the ceiling, and a hold begun exactly AUTO_CONTINUE_RECENT_MS ago is not recent', () => {
    expect(v({ worker: workerAt({ limits: { five: 99.9, seven: 99.9 } }) })).toEqual(r1(RUN67_DISPATCHED));
    expect(v({ worker: workerAt({ autoContinueHeldAt: NOW - AUTO_CONTINUE_RECENT_MS }) })).toEqual(r1(RUN67_DISPATCHED));
  });

  it('5 before 6: a limit-locked worker holds limit under the coordinator ball', () => {
    expect(v({ mail: QUESTION, worker: workerAt({ limits: { five: 100, seven: 10 } }) })).toEqual(hold('limit'));
  });

  it('6 before 7: the coordinator ball answers none while the worker reads busy', () => {
    expect(v({ mail: QUESTION, worker: workerAt({ live: liveWord('busy', NOW - H) }) })).toEqual(NONE);
  });

  it('6: under the coordinator ball below the cap the verdict is none, not a hold', () => {
    expect(v({ mail: QUESTION })).toEqual(NONE);
  });

  it('7: busy holds busy', () => {
    expect(v({ worker: workerAt({ live: liveWord('busy', NOW - 5 * H) }) })).toEqual(hold('busy'));
  });

  it.each(['', 'thinking'])('7: the word %j holds unmeasured', (word) => {
    expect(v({ worker: workerAt({ live: liveWord(word, NOW - 5 * H) }) })).toEqual(hold('unmeasured'));
  });

  it('7: below STALL_QUIET_MS the verdict is none; at it, r1', () => {
    expect(v({ worker: workerAt({ live: liveWord('idle', NOW - STALL_QUIET_MS + 1) }) })).toEqual(NONE);
    expect(v({ worker: workerAt({ live: liveWord('idle', NOW - STALL_QUIET_MS) }) })).toEqual(r1(RUN67_DISPATCHED));
  });
});

// Spec §10's property test. Each slot is set alone over two bases. Over the first base a later step would
// fire r1. Over the second, the coordinator's ball would answer none. The slot must turn both into
// `hold unmeasured`: a guard that only a later step happens to backstop reds on the second base. The
// slots exclude `limits` (the row after the loop). A failed store read is the lane's slot (Task 8), not
// the verdict's.
const WAITING: Partial<PresentWorker> = { live: { ok: true, word: 'waiting', since: NOW - 3 * H } };
const MENU: Partial<PresentWorker> = { dialogPending: true };
const SLOTS: ReadonlyArray<{ slot: string; base: Partial<PresentWorker>; set: Partial<PresentWorker>; run?: Partial<StallRunRow> }> = [
  { slot: 'FleetSession.unmeasured, where statusUnmeasured folds', base: {}, set: { unmeasured: true } },
  { slot: 'a null pane pid', base: {}, set: { live: { ok: false, reason: 'no-pane' } } },
  { slot: 'a null config dir', base: {}, set: { live: { ok: false, reason: 'no-config-dir' } } },
  { slot: 'the live read no-state', base: {}, set: { live: { ok: false, reason: 'no-state' } } },
  { slot: 'the live read unmeasured', base: {}, set: { live: { ok: false, reason: 'unmeasured' } } },
  { slot: 'lifecycle null', base: {}, set: { lifecycle: null } },
  { slot: 'lifecycle unmeasurable', base: {}, set: { lifecycle: 'unmeasurable' } },
  { slot: 'a lifecycle word this build cannot name', base: {}, set: { lifecycle: 'hibernating' } },
  { slot: 'a null dispatchedAt', base: {}, set: {}, run: { dispatchedAt: null } },
  { slot: 'idle with a null statusUpdatedAt', base: {}, set: { live: { ok: true, word: 'idle', since: null } } },
  { slot: 'shell with a null statusUpdatedAt', base: { live: { ok: true, word: 'shell', since: NOW - 3 * H } }, set: { live: { ok: true, word: 'shell', since: null } } },
  { slot: 'waiting with a null statusUpdatedAt', base: WAITING, set: { live: { ok: true, word: 'waiting', since: null } } },
  { slot: 'busy with a null statusUpdatedAt', base: { live: { ok: true, word: 'busy', since: NOW - 3 * H } }, set: { live: { ok: true, word: 'busy', since: null } } },
  { slot: 'waiting with the hook ask unmeasured', base: WAITING, set: { ...WAITING, hookAsk: { kind: 'unmeasured' } } },
  { slot: 'waiting with the asks row unmeasured', base: WAITING, set: { ...WAITING, askRow: { kind: 'unmeasured' } } },
  { slot: 'a pane menu with the hook ask unmeasured', base: MENU, set: { ...MENU, hookAsk: { kind: 'unmeasured' } } },
  { slot: 'a pane menu with the asks row unmeasured', base: MENU, set: { ...MENU, askRow: { kind: 'unmeasured' } } },
];
const BASES: ReadonlyArray<{ name: string; mail: StallMailRow[] }> = [
  { name: 'a firing r1', mail: [] },
  { name: 'the coordinator ball', mail: [mailRow(4001, NOW - 4 * H, WORKER, 'coordinator', 'question', 'which base?')] },
];
describe.each(BASES)('the unmeasured slots, over $name', ({ mail }) => {
  it.each(SLOTS)('$slot', ({ base, set, run }) => {
    const control = stallVerdict(stallInput({ worker: workerAt(base), mail }), NOW);
    expect(control, 'control: without the slot the verdict is something else').not.toEqual(hold('unmeasured'));
    expect(stallVerdict(stallInput({ worker: workerAt({ ...base, ...set }), primary: run, mail }), NOW)).toEqual(hold('unmeasured'));
  });
});

describe('limits is not an unmeasured slot', () => {
  it('a null limits, or a null window, fires exactly as a measured 0', () => {
    const measured0 = stallVerdict(stallInput({ worker: workerAt({ limits: { five: 0, seven: 0 } }) }), NOW);
    expect(measured0).toEqual(r1(RUN67_DISPATCHED));
    expect(stallVerdict(stallInput({ worker: workerAt({ limits: null }) }), NOW)).toEqual(measured0);
    expect(stallVerdict(stallInput({ worker: workerAt({ limits: { five: null, seven: null } }) }), NOW)).toEqual(measured0);
  });
});

describe('holds 2a and 2b: a question holds uncapped, a dialog with no ask is capped once', () => {
  const A = t('2026-09-20T08:00:00Z'); // chosen: the dialog's live stamp
  const primary: Partial<StallRunRow> = { dispatchedAt: A - 5 * H };
  const K = A - 5 * H;
  const v = (worker: StallWorker, at: number, notices: StallNotice[] = []) =>
    stallVerdict(stallInput({ primary, worker, notices }), at);

  it('a 6.6 h AskUserQuestion holds ask: the hook ask aged past 30 min but correlated with the dialog, the asks row released', () => {
    const worker = workerAt({
      live: liveWord('waiting', A), hookAsk: { kind: 'ask', at: A - 2_000 },
      askRow: { kind: 'row', state: 'released', at: A - 2_000 },
    });
    expect(v(worker, A + 6.6 * H)).toEqual(hold('ask'));
  });

  it.each(['held', 'answering'])('an asks row %s holds ask with no hook ask', (state) => {
    const worker = workerAt({ live: liveWord('waiting', A), askRow: { kind: 'row', state, at: A } });
    expect(v(worker, A + 3 * H)).toEqual(hold('ask'));
  });

  it('the correlation boundary: an ask stamped ASK_DIALOG_SLACK_MS before the dialog holds, one ms older does not', () => {
    const at = (hookAt: number) => workerAt({ live: liveWord('waiting', A), hookAsk: { kind: 'ask', at: hookAt } });
    expect(v(at(A - ASK_DIALOG_SLACK_MS), A + H)).toEqual(hold('ask'));
    expect(v(at(A - ASK_DIALOG_SLACK_MS - 1), A + H)).toEqual(hold('dialog'));
  });

  it('a Fable-consent menu with no ask draws exactly one dialog-cap push at 2 h', () => {
    const worker = workerAt({ live: liveWord('waiting', A) });
    expect(v(worker, A + STALL_QUIET_MS - 1)).toEqual(hold('dialog'));
    expect(v(worker, A + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', K));
    expect(v(worker, A + 5 * H, [notice('live', 'dialog-cap', 1, K, A + STALL_QUIET_MS + 20_000)])).toEqual(hold('dialog'));
  });

  it('a pane menu under an idle word is hold 2b even with a fresh hook ask: 2a needs the live word waiting', () => {
    const worker = workerAt({ live: liveWord('idle', A), dialogPending: true, hookAsk: { kind: 'ask', at: A } });
    expect(v(worker, A + H)).toEqual(hold('dialog'));
  });
});

describe('stallFacts: the ball, the episode key and the quiet clock', () => {
  const D = t('2026-09-10T08:00:00Z');
  const primary: Partial<StallRunRow> = { id: 31, dispatchedAt: D };
  const facts = (mail: StallMailRow[], worker: StallWorker = workerAt({ live: liveWord('idle', D + 5 * H) })) =>
    stallFacts(stallInput({ primary, mail, worker }));

  it('with no mail the worker has the ball, and dispatchedAt keys the episode', () => {
    expect(facts([])).toEqual({
      ball: 'worker', episodeKeyMs: D, quietSince: D + 5 * H, workerLast: null, inboundLast: null, lastExchangeAt: null,
    });
  });

  it.each([
    { label: 'a question', kind: 'question', subject: 'which base?', ball: 'coordinator' },
    { label: 'a wave-done status', kind: 'status', subject: WAVE_DONE_SUBJECT, ball: 'coordinator' },
    { label: 'a review-done status', kind: 'status', subject: REVIEW_DONE_SUBJECT, ball: 'coordinator' },
    { label: 'a stall-check reply declaring a wait', kind: 'status', subject: `${STALL_REPLY_WAITING_PREFIX} on the F3 ruling`, ball: 'coordinator' },
    { label: 'a stall-check reply still working', kind: 'status', subject: `${STALL_REPLY_PREFIX} working on Task 4`, ball: 'worker' },
    { label: 'an ordinary status', kind: 'status', subject: 'Task 2 pushed', ball: 'worker' },
    { label: 'a wave-done subject with a suffix', kind: 'status', subject: `${WAVE_DONE_SUBJECT} (draft)`, ball: 'worker' },
    { label: 'a wave-done subject on a finding', kind: 'finding', subject: WAVE_DONE_SUBJECT, ball: 'worker' },
  ])('the worker own mail, $label, gives the ball to the $ball', ({ kind, subject, ball }) => {
    const own = mailRow(3001, D + H, WORKER, 'coordinator', kind, subject, 31);
    expect(facts([own])).toMatchObject({ ball, workerLast: own, episodeKeyMs: D + H, lastExchangeAt: D + H });
  });

  it.each([
    { label: 'the coordinator role sending wait:', fromId: 'coordinator', subject: `${STALL_WAIT_PREFIX} CI on #201`, ball: 'coordinator', key: D + 2 * H },
    { label: 'the claimant sending wait:', fromId: COORD, subject: `${STALL_WAIT_PREFIX} CI on #201`, ball: 'coordinator', key: D + 2 * H },
    { label: 'a peer that is no coordinator sending wait:', fromId: PEER, subject: `${STALL_WAIT_PREFIX} CI on #201`, ball: 'worker', key: D },
    { label: 'the coordinator sending a subject equal to wave-done', fromId: 'coordinator', subject: WAVE_DONE_SUBJECT, ball: 'worker', key: D },
    { label: 'the server rejecting a wave-done', fromId: 'coordinator', subject: 'wave-done-rejected', ball: 'worker', key: D },
    { label: 'the claimant sending an ordinary answer', fromId: COORD, subject: 'use base B', ball: 'worker', key: D },
  ])('mail TO the worker from $label gives the ball to the $ball', ({ fromId, subject, ball, key }) => {
    const inbound = mailRow(3002, D + 2 * H, fromId, WORKER, 'status', subject, 31);
    expect(facts([inbound])).toMatchObject({ ball, inboundLast: inbound, episodeKeyMs: key, workerLast: null, lastExchangeAt: D + 2 * H });
  });

  it('the watch own notices are not mail on the run: a stall-check and a stall report move neither the ball, the key nor the clock', () => {
    const own = mailRow(3001, D + H, WORKER, 'coordinator', 'status', 'Task 2 pushed', 31);
    const check = mailRow(3003, D + 4 * H, 'operator', WORKER, 'status', `${STALL_CHECK_PREFIX} run 31 — quiet 2h 0m, owed: next report`, 31);
    const report = mailRow(3004, D + 5 * H, 'operator', COORD, 'status', `${STALL_REPORT_PREFIX} run 31 worker silent`, 31);
    expect(facts([own, check, report], workerAt({ live: liveWord('idle', D + 2 * H) }))).toEqual({
      ball: 'worker', episodeKeyMs: D + H, quietSince: D + 2 * H, workerLast: own, inboundLast: null, lastExchangeAt: D + H,
    });
  });

  it('a reply to the stall-check is the worker mail: it moves the key and the clock', () => {
    const check = mailRow(3003, D + 4 * H, 'operator', WORKER, 'status', `${STALL_CHECK_PREFIX} run 31 — quiet 2h 0m, owed: first report`, 31);
    const reply = mailRow(3005, D + 4 * H + 10 * MIN, WORKER, 'coordinator', 'status', `${STALL_REPLY_PREFIX} working on Task 4`, 31);
    expect(facts([check, reply], workerAt({ live: liveWord('idle', D + 4 * H + 12 * MIN) }))).toEqual({
      ball: 'worker', episodeKeyMs: reply.at, quietSince: D + 4 * H + 12 * MIN, workerLast: reply, inboundLast: null, lastExchangeAt: reply.at,
    });
  });

  it('the episode key moves on the worker mail and on a coordinator wait:, never on an ordinary coordinator mail', () => {
    const own = mailRow(3001, D + H, WORKER, 'coordinator', 'status', 'Task 2 pushed', 31);
    const answer = mailRow(3002, D + 2 * H, COORD, WORKER, 'answer', 'use base B', 31);
    const wait = mailRow(3006, D + 3 * H, COORD, WORKER, 'status', `${STALL_WAIT_PREFIX} CI on #201`, 31);
    expect(facts([own, answer]).episodeKeyMs).toBe(D + H);
    expect(facts([own, answer, wait]).episodeKeyMs).toBe(D + 3 * H);
  });

  it('quietSince is the newest of the live stamp, the worker last mail, the newest inbound mail and dispatchedAt; null off idle and shell', () => {
    const own = mailRow(3001, D + H, WORKER, 'coordinator', 'status', 'Task 2 pushed', 31);
    const answer = mailRow(3002, D + 2 * H, COORD, WORKER, 'answer', 'use base B', 31);
    expect(facts([own, answer], workerAt({ live: liveWord('idle', D + H + 5 * MIN) })).quietSince).toBe(D + 2 * H);
    expect(facts([own, answer], workerAt({ live: liveWord('shell', D + 3 * H) })).quietSince).toBe(D + 3 * H);
    expect(facts([own, answer], workerAt({ live: liveWord('busy', D + 3 * H) })).quietSince).toBeNull();
  });
});

describe('golden fixtures (spec §1 measured times)', () => {
  const S1 = t('2026-09-16T20:00:04Z');
  const S4_MAIL = [
    mailRow(2509, t('2026-09-28T21:17:43Z'), WORKER, 'coordinator', 'status', 'progress'),
    mailRow(2510, t('2026-09-28T21:19:17Z'), COORD, WORKER, 'answer', 'go ahead'),
  ];

  it.each([
    { s: 'S1', since: '2026-09-16T20:00:04Z', word: 'idle', mail: [] as StallMailRow[], key: RUN67_DISPATCHED, due: '2026-09-16T22:00:04Z' },
    // S2: the worker's mail about an hour before the Stop (§1: "one hour after the worker mailed"), time chosen.
    { s: 'S2', since: '2026-09-19T21:13:35Z', word: 'idle', mail: [mailRow(2301, t('2026-09-19T20:13:00Z'), WORKER, 'coordinator')], key: t('2026-09-19T20:13:00Z'), due: '2026-09-19T23:13:35Z' },
    // S3: mails 2443/2445 precede the Stop (§4.2); their times are chosen. The live word is shell.
    { s: 'S3', since: '2026-09-26T13:03:15Z', word: 'shell', mail: [mailRow(2443, t('2026-09-26T12:40:00Z'), COORD, WORKER, 'answer', 'ruling'), mailRow(2445, t('2026-09-26T12:55:00Z'), COORD, WORKER, 'answer', 'ruling')], key: RUN67_DISPATCHED, due: '2026-09-26T15:03:15Z' },
    { s: 'S4', since: '2026-09-28T21:56:31Z', word: 'idle', mail: S4_MAIL, key: t('2026-09-28T21:17:43Z'), due: '2026-09-28T23:56:31Z' },
  ])('$s: r1 falls due at $due and not a millisecond before', ({ since, word, mail, key, due }) => {
    const input = stallInput({ mail, worker: workerAt({ live: liveWord(word, t(since)) }) });
    expect(stallVerdict(input, t(due) - 1)).toEqual(NONE);
    expect(stallVerdict(input, t(due))).toEqual(r1(key));
  });

  it('S1: the ladder, coordinator at about 23:01, operator at about 00:01, then nothing', () => {
    const worker = workerAt({ live: liveWord('idle', S1) });
    const K = RUN67_DISPATCHED;
    const n1 = [notice('live', 'quiet', 1, K, t('2026-09-16T22:00:30Z'))];
    expect(stallVerdict(stallInput({ worker, notices: n1 }), t('2026-09-16T23:00:29.999Z'))).toEqual(NONE);
    expect(stallVerdict(stallInput({ worker, notices: n1 }), t('2026-09-16T23:00:30Z'))).toEqual({ act: 'measure-coordinator', coordinatorId: COORD });
    expect(stallVerdict(stallInput({ worker, notices: n1, coordinator: 'alive' }), t('2026-09-16T23:00:30Z'))).toEqual(r2(K));
    const n2 = [...n1, notice('live', 'quiet', 2, K, t('2026-09-16T23:01:00Z'))];
    expect(stallVerdict(stallInput({ worker, notices: n2 }), t('2026-09-17T00:00:59.999Z'))).toEqual(NONE);
    expect(stallVerdict(stallInput({ worker, notices: n2 }), t('2026-09-17T00:01:00Z'))).toEqual(r3(K, 'still-silent'));
    const n3 = [...n2, notice('live', 'quiet', 3, K, t('2026-09-17T00:01:30Z'))];
    expect(stallVerdict(stallInput({ worker, notices: n3 }), t('2026-09-17T12:00:00Z'))).toEqual(NONE);
  });

  it('S1 limit-locked: the limit hold holds r1 and pushes limit-cap once at 09-17 08:30:04', () => {
    const worker = workerAt({ live: liveWord('idle', S1), limits: { five: 100, seven: 40 } });
    expect(stallVerdict(stallInput({ worker }), t('2026-09-16T22:00:04Z'))).toEqual(hold('limit'));
    expect(stallVerdict(stallInput({ worker }), t('2026-09-17T08:30:03.999Z'))).toEqual(hold('limit'));
    expect(stallVerdict(stallInput({ worker }), t('2026-09-17T08:30:04Z'))).toEqual(capOf('limit-cap', RUN67_DISPATCHED));
  });

  it('S4: coordinator at 00:57, operator at 01:57, as the r1 body promises', () => {
    const worker = workerAt({ live: liveWord('idle', t('2026-09-28T21:56:31Z')) });
    const K = t('2026-09-28T21:17:43Z');
    const v = (notices: StallNotice[], iso: string) =>
      stallVerdict(stallInput({ mail: S4_MAIL, worker, notices, coordinator: 'alive' }), t(iso));
    const n1 = [notice('live', 'quiet', 1, K, t('2026-09-28T23:57:00Z'))];
    expect(v(n1, '2026-09-29T00:56:59.999Z')).toEqual(NONE);
    expect(v(n1, '2026-09-29T00:57:00Z')).toEqual(r2(K));
    const n2 = [...n1, notice('live', 'quiet', 2, K, t('2026-09-29T00:57:20Z'))];
    expect(v(n2, '2026-09-29T01:57:19.999Z')).toEqual(NONE);
    expect(v(n2, '2026-09-29T01:57:20Z')).toEqual(r3(K, 'still-silent'));
  });

  it('run 31: the worker own ordinary status, then silence, is the worker ball: r1 at 2 h, not at 24 h', () => {
    const D31 = t('2026-09-10T08:00:00Z'); // chosen
    const status = mailRow(3101, D31 + 3 * H, WORKER, 'coordinator', 'status', 'Task 2 pushed, starting Task 3', 31);
    const idleAt = status.at + 4 * MIN;
    const input = stallInput({ primary: { id: 31, dispatchedAt: D31 }, mail: [status], worker: workerAt({ live: liveWord('idle', idleAt) }) });
    expect(stallVerdict(input, idleAt + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(stallVerdict(input, idleAt + STALL_QUIET_MS)).toEqual(r1(status.at));
  });

  it('run 129: the shell-gated mail 2407 restarts the clock when it is queued, so r1 is at 04:28, not 2 h after the word turned shell', () => {
    const shellSince = t('2026-09-25T01:46:00Z'); // derived: the 84.2 h gap began 0.7 h before 2407's 83.5 h
    const q2407 = t('2026-09-25T02:28:00Z');
    const D129 = t('2026-09-24T18:00:00Z'); // chosen
    const input = stallInput({
      primary: { id: 129, dispatchedAt: D129 },
      mail: [mailRow(2407, q2407, COORD, WORKER, 'answer', 'ruling on F2', 129)],
      worker: workerAt({ live: liveWord('shell', shellSince) }),
    });
    expect(stallVerdict(input, shellSince + STALL_QUIET_MS)).toEqual(NONE);
    expect(stallVerdict(input, q2407 + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(stallVerdict(input, q2407 + STALL_QUIET_MS)).toEqual(r1(D129));
  });

  it('a hand-off: a reply beginning re stall-check: waiting closes the episode and hands over the ball until the 30 h cap', () => {
    const since = t('2026-09-21T10:00:00Z');
    const R1 = since + STALL_QUIET_MS + 20_000;
    const reply = mailRow(2601, R1 + 15 * MIN, WORKER, 'coordinator', 'status', `${STALL_REPLY_WAITING_PREFIX} on the F3 ruling`);
    const v = (at: number) => stallVerdict(stallInput({
      mail: [reply], notices: [notice('live', 'quiet', 1, RUN67_DISPATCHED, R1)], coordinator: 'alive',
      worker: workerAt({ live: liveWord('idle', reply.at + MIN) }),
    }), at);
    expect(stallFacts(stallInput({ mail: [reply] }))).toMatchObject({ ball: 'coordinator', episodeKeyMs: reply.at });
    expect(v(R1 + H)).toEqual(NONE);
    expect(v(reply.at + COORD_BALL_CAP_MS - 1)).toEqual(NONE);
    expect(v(reply.at + COORD_BALL_CAP_MS)).toEqual(capOf('coord-ball', reply.at));
  });

  it('any worker mail closes the episode, prefixed or not: the ladder restarts at r1 on the new key', () => {
    const since = t('2026-09-21T10:00:00Z');
    const R1 = since + STALL_QUIET_MS + 20_000;
    const plain = mailRow(2602, R1 + 15 * MIN, WORKER, 'coordinator', 'status', 'on it, Task 3 half done');
    const v = (at: number) => stallVerdict(stallInput({
      mail: [plain], notices: [notice('live', 'quiet', 1, RUN67_DISPATCHED, R1)], coordinator: 'alive',
      worker: workerAt({ live: liveWord('idle', plain.at + MIN) }),
    }), at);
    expect(v(R1 + H)).toEqual(NONE);
    expect(v(plain.at + MIN + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(v(plain.at + MIN + STALL_QUIET_MS)).toEqual(r1(plain.at));
  });

  it('a coordinator wait: closes the episode, so there is no r2 on the spent key, and a silence after the ball returns opens r1 on the new key', () => {
    const since = t('2026-09-21T10:00:00Z');
    const R1 = since + STALL_QUIET_MS + 20_000;
    const wait = mailRow(2603, R1 + 20 * MIN, COORD, WORKER, 'status', `${STALL_WAIT_PREFIX} CI on #201`);
    const back = mailRow(2604, wait.at + 3 * H, 'coordinator', WORKER, 'answer', 'CI is green, merge it');
    const notices = [notice('live', 'quiet', 1, RUN67_DISPATCHED, R1)];
    const worker = workerAt({ live: liveWord('idle', since) });
    const v = (mail: StallMailRow[], at: number) => stallVerdict(stallInput({ mail, notices, worker, coordinator: 'alive' }), at);
    expect(stallFacts(stallInput({ mail: [wait], worker })).episodeKeyMs).toBe(wait.at);
    expect(v([wait], R1 + H)).toEqual(NONE);
    expect(v([wait, back], back.at + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(v([wait, back], back.at + STALL_QUIET_MS)).toEqual(r1(wait.at));
  });

  it('a rejected wave-done TO the worker keeps the worker ball: the worker owes a new claim', () => {
    const T = t('2026-09-22T14:00:00Z');
    const done = mailRow(2701, T, WORKER, 'coordinator', 'status', WAVE_DONE_SUBJECT);
    const rejected = mailRow(2702, T + 10 * MIN, 'coordinator', WORKER, 'status', 'wave-done-rejected');
    const worker = workerAt({ live: liveWord('idle', T + MIN) });
    expect(stallVerdict(stallInput({ mail: [done], worker }), T + 3 * H)).toEqual(NONE);
    expect(stallFacts(stallInput({ mail: [done, rejected], worker })).ball).toBe('worker');
    expect(stallVerdict(stallInput({ mail: [done, rejected], worker }), rejected.at + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(stallVerdict(stallInput({ mail: [done, rejected], worker }), rejected.at + STALL_QUIET_MS)).toEqual(r1(T));
  });

  it('two overlapping runs on one session are judged once, on the most recently dispatched, with the mail of both', () => {
    const run29 = runRow({ id: 29, dispatchedAt: t('2026-09-08T09:00:00Z'), claimedBy: 'demo-old-coord', wave: 3 });
    const run31 = runRow({ id: 31, dispatchedAt: t('2026-09-10T08:00:00Z'), claimedBy: COORD, wave: 4 });
    const subjects = stallSubjects([run29, run31]);
    expect(subjects).toHaveLength(1);
    const subject = subjects[0];
    expect(subject.primary.id).toBe(31);
    const lastOn29 = t('2026-09-10T09:00:00Z');
    const own29 = mailRow(2901, lastOn29, WORKER, 'coordinator', 'status', 'still closing run 29', 29);
    const worker = workerAt({ live: liveWord('idle', lastOn29 - 10 * MIN) });
    const v = (over: Over, at: number) => stallVerdict(stallInput({ subject, worker, mail: [own29], ...over }), at);
    expect(stallFacts(stallInput({ subject, worker, mail: [own29] })).workerLast).toEqual(own29);
    expect(v({}, lastOn29 + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(v({}, lastOn29 + STALL_QUIET_MS)).toEqual(r1(lastOn29));
    const R1 = lastOn29 + STALL_QUIET_MS + 20_000;
    expect(v({ notices: [notice('live', 'quiet', 1, lastOn29, R1)], coordinator: 'alive' }, R1 + H)).toEqual(r2(lastOn29, COORD));
    const wait29 = mailRow(2902, lastOn29 + 30 * MIN, 'demo-old-coord', WORKER, 'status', `${STALL_WAIT_PREFIX} rebase run 29 first`, 29);
    expect(v({ mail: [own29, wait29] }, lastOn29 + 3 * H)).toEqual(NONE);
  });

  it('a declared-idle legit wait: a question holds the watch through the 28.7 h legit maximum, and coord-ball fires once at 30 h', () => {
    const Q = t('2026-09-12T15:00:00Z'); // chosen
    const question = mailRow(2801, Q, WORKER, 'coordinator', 'question', 'merge order for F2 and F3?');
    const worker = workerAt({ live: liveWord('idle', Q + 2 * MIN) });
    // The run was dispatched before the question, so the question's time is the episode key.
    const v = (notices: StallNotice[], at: number) => stallVerdict(stallInput({ primary: { dispatchedAt: Q - 6 * H }, mail: [question], worker, notices }), at);
    expect(v([], Q + 28.7 * H)).toEqual(NONE);
    expect(v([], Q + COORD_BALL_CAP_MS - 1)).toEqual(NONE);
    expect(v([], Q + COORD_BALL_CAP_MS)).toEqual(capOf('coord-ball', Q));
    expect(v([notice('live', 'coord-ball', 1, Q, Q + COORD_BALL_CAP_MS + 20_000)], Q + 40 * H)).toEqual(NONE);
  });
});

describe('r2: the coordinator state when it falls due', () => {
  const K = RUN67_DISPATCHED;
  const R1 = NOW - 90 * MIN;
  const worker = workerAt({ live: liveWord('idle', NOW - 4 * H) });
  const v = (over: Over, at = NOW) =>
    stallVerdict(stallInput({ worker, notices: [notice('live', 'quiet', 1, K, R1)], ...over }), at);

  it('before r1 + STALL_ESCALATE_MS nothing is due, paused or not', () => {
    expect(v({ coordinationPaused: true }, R1 + STALL_ESCALATE_MS - 1)).toEqual(NONE);
    expect(v({ coordinator: 'alive' }, R1 + STALL_ESCALATE_MS - 1)).toEqual(NONE);
  });
  it('not yet measured: measure-coordinator on the claimant', () => {
    expect(v({})).toEqual({ act: 'measure-coordinator', coordinatorId: COORD });
  });
  it('alive: r2 to the claimant', () => {
    expect(v({ coordinator: 'alive' })).toEqual(r2(K, COORD));
  });
  it('unmeasurable: r2 deferred as hold coordinator-unmeasurable', () => {
    expect(v({ coordinator: 'unmeasurable' })).toEqual(hold('coordinator-unmeasurable'));
  });
  it('dead: r2 skipped, r3 at r1 + 1 h naming the dead coordinator', () => {
    expect(v({ coordinator: 'dead' })).toEqual(r3(K, 'coordinator-dead'));
  });
  it('no claimant: r3 no-coordinator, and nothing is measured', () => {
    expect(v({ primary: { claimedBy: null } })).toEqual(r3(K, 'no-coordinator'));
  });
  it('paused: r3 coordination-paused, with a live claimant or with none', () => {
    expect(v({ coordinationPaused: true, coordinator: 'alive' })).toEqual(r3(K, 'coordination-paused'));
    expect(v({ coordinationPaused: true, primary: { claimedBy: null } })).toEqual(r3(K, 'coordination-paused'));
  });
  it('a skipped r2 leaves r3 as the last rung: once r3 is recorded the ladder is done', () => {
    const notices = [notice('live', 'quiet', 1, K, R1), notice('live', 'quiet', 3, K, R1 + H + 20_000)];
    expect(v({ coordinator: 'dead', notices }, NOW + 5 * H)).toEqual(NONE);
  });
});

describe('busy deferral: a rung due while the worker reads busy waits, and its hour runs from the word turning idle again', () => {
  const K = RUN67_DISPATCHED;
  const R1 = t('2026-09-29T06:00:00Z');
  const R2 = R1 + H;
  const v = (live: LiveWordRead, notices: StallNotice[], at: number) =>
    stallVerdict(stallInput({ worker: workerAt({ live }), notices, coordinator: 'alive' }), at);
  const upToR1 = [notice('live', 'quiet', 1, K, R1)];
  const upToR2 = [...upToR1, notice('live', 'quiet', 2, K, R2)];

  it('r2: busy at r1 + 1 h holds busy; idle again at r1 + 90 min puts r2 at r1 + 150 min', () => {
    expect(v(liveWord('busy', R1 + 50 * MIN), upToR1, R1 + H)).toEqual(hold('busy'));
    expect(v(liveWord('idle', R1 + 90 * MIN), upToR1, R1 + 150 * MIN - 1)).toEqual(NONE);
    expect(v(liveWord('idle', R1 + 90 * MIN), upToR1, R1 + 150 * MIN)).toEqual(r2(K));
  });
  it('r3: the same rule from r2', () => {
    expect(v(liveWord('busy', R2 + 30 * MIN), upToR2, R2 + H)).toEqual(hold('busy'));
    expect(v(liveWord('shell', R2 + 70 * MIN), upToR2, R2 + 130 * MIN - 1)).toEqual(NONE);
    expect(v(liveWord('shell', R2 + 70 * MIN), upToR2, R2 + 130 * MIN)).toEqual(r3(K, 'still-silent'));
  });
  it('r1: busy at 2 h holds busy, and the quiet clock restarts from the idle stamp', () => {
    const X = R1 - 30 * MIN;
    expect(v(liveWord('busy', X - 5 * H), [], X)).toEqual(hold('busy'));
    expect(v(liveWord('idle', X), [], X + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(v(liveWord('idle', X), [], X + STALL_QUIET_MS)).toEqual(r1(K));
  });
});

// Spec §4.2: "r2 at r1 + 1 h ... r3 at r2 + 1 h". A rung is re-timed only when the worker reads busy at its due
// time, and its hour then runs from the RAW live word turning idle or shell again. The r1 nudge's own turn
// restamps the worker, and mail after a rung is not a re-timing: worker mail and a coordinator wait: close
// the episode through the key instead.
describe('rung timing: an hour from the previous rung, re-timed only by the live word turning idle again after that hour', () => {
  const K = RUN67_DISPATCHED;
  const R1 = t('2026-09-29T06:00:00Z');
  const R2 = R1 + H;
  const upToR1 = [notice('live', 'quiet', 1, K, R1)];
  const upToR2 = [...upToR1, notice('live', 'quiet', 2, K, R2)];
  const v = (live: LiveWordRead, notices: StallNotice[], at: number, mail: StallMailRow[] = []) =>
    stallVerdict(stallInput({ worker: workerAt({ live }), notices, mail, coordinator: 'alive' }), at);

  it('a: the worker is idle again before r2 is due (the r1 nudge restamped it), and r2 still falls due at exactly r1 + 1 h', () => {
    const live = liveWord('idle', R1 + 10 * MIN);
    expect(v(live, upToR1, R1 + H - 1)).toEqual(NONE);
    expect(v(live, upToR1, R1 + H)).toEqual(r2(K));
  });
  it('a: the same for r3, from a restamp inside r2\'s hour', () => {
    const live = liveWord('idle', R2 + 10 * MIN);
    expect(v(live, upToR2, R2 + H - 1)).toEqual(NONE);
    expect(v(live, upToR2, R2 + H)).toEqual(r3(K, 'still-silent'));
  });
  it('b: a coordinator\'s ordinary mail to the worker after r2 does not move r3 off r2 + 1 h', () => {
    const resume = mailRow(6001, R2 + 30 * MIN, COORD, WORKER, 'answer', 'resume');
    const live = liveWord('idle', R1 - 30 * MIN);
    expect(v(live, upToR2, R2 + H - 1, [resume])).toEqual(NONE);
    expect(v(live, upToR2, R2 + H, [resume])).toEqual(r3(K, 'still-silent'));
  });
  it('b: the same for r2: an ordinary coordinator mail at r1 + 20 min leaves r2 at r1 + 1 h', () => {
    const resume = mailRow(6002, R1 + 20 * MIN, COORD, WORKER, 'answer', 'resume');
    const live = liveWord('idle', R1 - 30 * MIN);
    expect(v(live, upToR1, R1 + H - 1, [resume])).toEqual(NONE);
    expect(v(live, upToR1, R1 + H, [resume])).toEqual(r2(K));
  });
  it('c: busy at the due time, then idle again at T after it, puts the rung at T + 1 h', () => {
    const T = R1 + 90 * MIN;
    expect(v(liveWord('busy', R1 + 50 * MIN), upToR1, R1 + H)).toEqual(hold('busy'));
    expect(v(liveWord('idle', T), upToR1, T + H - 1)).toEqual(NONE);
    expect(v(liveWord('idle', T), upToR1, T + H)).toEqual(r2(K));
  });
  it('c: the boundary: a stamp at exactly r1 + 1 h is inside the hour, one ms later re-times it', () => {
    expect(v(liveWord('idle', R1 + H), upToR1, R1 + H)).toEqual(r2(K));
    expect(v(liveWord('idle', R1 + H + 1), upToR1, R1 + H + H)).toEqual(NONE);
    expect(v(liveWord('idle', R1 + H + 1), upToR1, R1 + H + 1 + H)).toEqual(r2(K));
  });
});

describe('shadow-rung-accounting: arming mid-episode sends the pending rung once, and the next rung waits its hour from the live one', () => {
  const K = RUN67_DISPATCHED;
  const since = t('2026-09-29T00:00:00Z');
  const R1 = since + STALL_QUIET_MS + 30_000;
  const R2 = R1 + H;
  const v = (arming: StallArming, notices: StallNotice[], at: number) =>
    stallVerdict(stallInput({ worker: workerAt({ live: liveWord('idle', since) }), arming, notices, coordinator: 'alive' }), at);

  it('in full shadow a shadow r1 counts as done, and r2 falls due an hour after it', () => {
    const n = [notice('shadow', 'quiet', 1, K, R1)];
    expect(v(SHADOW, n, R1 + H - 1)).toEqual(NONE);
    expect(v(SHADOW, n, R1 + H)).toEqual(r2(K));
  });
  it('stall-watch-live touched after a shadow r1: the live r1 goes out once', () => {
    expect(v(LIVE_ONLY, [notice('shadow', 'quiet', 1, K, R1)], R1 + 10 * MIN)).toEqual(r1(K));
    expect(v(LIVE_ONLY, [notice('shadow', 'quiet', 1, K, R1), notice('live', 'quiet', 1, K, R1 + 10 * MIN)], R1 + 11 * MIN)).toEqual(NONE);
  });
  it('a rung re-sent live is timed from its earliest LIVE row: r2 falls due an hour after the live r1, not after the shadow one', () => {
    const L1 = R1 + 40 * MIN;
    const n = [notice('shadow', 'quiet', 1, K, R1), notice('live', 'quiet', 1, K, L1)];
    // r2 is due one hour after its previous rung's earliest LIVE row, L1: the live stamp (`since`) is older than L1.
    expect(v(LIVE_ONLY, n, R1 + H)).toEqual(NONE);
    expect(v(LIVE_ONLY, n, L1 + H - 1)).toEqual(NONE);
    expect(v(LIVE_ONLY, n, L1 + H)).toEqual(r2(K));
  });
  it('a live row counts under any markers: disarming after a live r1 does not re-send it', () => {
    expect(v(SHADOW, [notice('live', 'quiet', 1, K, R1)], R1 + 5 * MIN)).toEqual(NONE);
  });
  it('stall-watch-escalate touched after a shadow r2: the live r2 goes out once, and r3 waits its hour from the live r2', () => {
    const L2 = R2 + 10 * MIN;
    const n = [notice('live', 'quiet', 1, K, R1), notice('shadow', 'quiet', 2, K, R2)];
    expect(v(LIVE_ONLY, n, L2)).toEqual(NONE);
    expect(v(ARMED, n, L2)).toEqual(r2(K));
    const sent = [...n, notice('live', 'quiet', 2, K, L2)];
    expect(v(ARMED, sent, R2 + H)).toEqual(NONE);
    expect(v(ARMED, sent, L2 + H - 1)).toEqual(NONE);
    expect(v(ARMED, sent, L2 + H)).toEqual(r3(K, 'still-silent'));
  });
  it('arming escalate after a shadow r2 and a shadow r3 sends r2 at once, and r3 waits its hour from the live r2', () => {
    const R3 = R2 + H;
    const L2 = R3 + 5 * MIN;
    const n = [notice('live', 'quiet', 1, K, R1), notice('shadow', 'quiet', 2, K, R2), notice('shadow', 'quiet', 3, K, R3)];
    expect(v(LIVE_ONLY, n, L2)).toEqual(NONE);
    expect(v(ARMED, n, L2)).toEqual(r2(K));
    const sent = [...n, notice('live', 'quiet', 2, K, L2)];
    expect(v(ARMED, sent, L2 + MIN)).toEqual(NONE);
    expect(v(ARMED, sent, L2 + H - 1)).toEqual(NONE);
    expect(v(ARMED, sent, L2 + H)).toEqual(r3(K, 'still-silent'));
  });
  it('a rung standing in shadow is timed from its earliest row: a shadow-only ladder, and a shadow r2 under a live r1', () => {
    const shadowOnly = [notice('shadow', 'quiet', 1, K, R1), notice('shadow', 'quiet', 2, K, R2)];
    expect(v(SHADOW, shadowOnly, R2 + H - 1)).toEqual(NONE);
    expect(v(SHADOW, shadowOnly, R2 + H)).toEqual(r3(K, 'still-silent'));
    const underLive = [notice('live', 'quiet', 1, K, R1), notice('shadow', 'quiet', 2, K, R2)];
    expect(v(LIVE_ONLY, underLive, R2 + H - 1)).toEqual(NONE);
    expect(v(LIVE_ONLY, underLive, R2 + H)).toEqual(r3(K, 'still-silent'));
  });
  it('a notice keyed on another episode is not this episode rung', () => {
    expect(v(ARMED, [notice('live', 'quiet', 1, K - 1, R1)], R1 + 5 * MIN)).toEqual(r1(K));
  });
});

describe('the three caps fire once per episode', () => {
  const K = RUN67_DISPATCHED;
  const since = t('2026-09-27T00:00:00Z');
  const limited = (over: Partial<PresentWorker> = {}) =>
    workerAt({ live: liveWord('idle', since), limits: { five: 100, seven: 55 }, ...over });
  const capRow = notice('live', 'limit-cap', 1, K, since + LIMIT_HOLD_CAP_MS + 20_000);

  it('limit-cap: once at LIMIT_HOLD_CAP_MS of quiet, then hold limit', () => {
    expect(stallVerdict(stallInput({ worker: limited() }), since + LIMIT_HOLD_CAP_MS - 1)).toEqual(hold('limit'));
    expect(stallVerdict(stallInput({ worker: limited() }), since + LIMIT_HOLD_CAP_MS)).toEqual(capOf('limit-cap', K));
    expect(stallVerdict(stallInput({ worker: limited(), notices: [capRow] }), since + 20 * H)).toEqual(hold('limit'));
  });
  it('limit-cap: a worker mail opens a new episode, whose cap may fire again', () => {
    const M = since + 21 * H;
    const mail = [mailRow(5001, M, WORKER, 'coordinator', 'status', 'still limit-locked')];
    const worker = limited({ live: liveWord('idle', M + MIN) });
    expect(stallVerdict(stallInput({ worker, mail, notices: [capRow] }), M + MIN + LIMIT_HOLD_CAP_MS - 1)).toEqual(hold('limit'));
    expect(stallVerdict(stallInput({ worker, mail, notices: [capRow] }), M + MIN + LIMIT_HOLD_CAP_MS)).toEqual(capOf('limit-cap', M));
  });
  it('dialog-cap: once at STALL_QUIET_MS under hold 2b, then hold dialog', () => {
    const worker = workerAt({ live: liveWord('waiting', since) });
    expect(stallVerdict(stallInput({ worker }), since + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', K));
    const n = [notice('live', 'dialog-cap', 1, K, since + STALL_QUIET_MS + 20_000)];
    expect(stallVerdict(stallInput({ worker, notices: n }), since + 9 * H)).toEqual(hold('dialog'));
  });
  it('coord-ball: once at COORD_BALL_CAP_MS, then none', () => {
    const mail = [mailRow(5002, since, WORKER, 'coordinator', 'question', 'which base?')];
    const worker = workerAt({ live: liveWord('idle', since + MIN) });
    expect(stallVerdict(stallInput({ worker, mail }), since + COORD_BALL_CAP_MS)).toEqual(capOf('coord-ball', since));
    const n = [notice('live', 'coord-ball', 1, since, since + COORD_BALL_CAP_MS + 20_000)];
    expect(stallVerdict(stallInput({ worker, mail, notices: n }), since + 50 * H)).toEqual(NONE);
  });
  it('a shadow cap row stands until stall-watch-escalate is touched; then the cap goes out once', () => {
    const n = [notice('shadow', 'limit-cap', 1, K, since + LIMIT_HOLD_CAP_MS + 20_000)];
    expect(stallVerdict(stallInput({ worker: limited(), notices: n, arming: LIVE_ONLY }), since + 13 * H)).toEqual(hold('limit'));
    expect(stallVerdict(stallInput({ worker: limited(), notices: n, arming: ARMED }), since + 13 * H)).toEqual(capOf('limit-cap', K));
  });
});

describe('two decision filters that no other row binds', () => {
  it('relevance: the coordinator mailing a THIRD party on the run does not take the ball back from the coordinator', () => {
    const Q = t('2026-09-12T15:00:00Z'); // chosen
    const question = mailRow(7001, Q, WORKER, 'coordinator', 'question', 'which base?');
    const aside = mailRow(7002, Q + H, COORD, PEER, 'status', 'note for the reviewer');
    const worker = workerAt({ live: liveWord('idle', Q + 2 * MIN) });
    const input = stallInput({ primary: { dispatchedAt: Q - 6 * H }, mail: [question, aside], worker });
    expect(stallFacts(input)).toMatchObject({ ball: 'coordinator', workerLast: question, inboundLast: null, lastExchangeAt: Q });
    expect(stallVerdict(input, Q + 4 * H)).toEqual(NONE);
  });

  it.each(['limit-cap', 'dialog-cap', 'coord-ball'] as const)('arm: a live %s row on the episode key is not the quiet r1', (arm) => {
    const rung1 = [notice('live', arm, 1, RUN67_DISPATCHED, NOW - 30 * MIN)];
    expect(stallVerdict(stallInput({ notices: rung1 }), NOW)).toEqual(r1(RUN67_DISPATCHED));
  });

  it('arm: a live quiet r1 row on the episode key does not spend the limit cap', () => {
    const since = t('2026-09-27T00:00:00Z');
    const worker = workerAt({ live: liveWord('idle', since), limits: { five: 100, seven: 55 } });
    const r1Row = [notice('live', 'quiet', 1, RUN67_DISPATCHED, since + STALL_QUIET_MS + 20_000)];
    expect(stallVerdict(stallInput({ worker, notices: r1Row }), since + LIMIT_HOLD_CAP_MS)).toEqual(capOf('limit-cap', RUN67_DISPATCHED));
  });
});

describe('the verdict kebab words are declared for the coord kebab scan', () => {
  it.each(['measure-coordinator', 'still-silent', 'coordinator-dead', 'no-coordinator', 'coordination-paused', 'no-pane', 'no-config-dir', 'no-state'])(
    'isStallKebab(%j)', (word) => {
      expect(isStallKebab(word)).toBe(true);
    });
  it('and still rejects a typo', () => {
    expect(isStallKebab('coordinator-deaad')).toBe(false);
  });
});
