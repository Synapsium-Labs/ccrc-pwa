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
import { STALL_FAILED_PREFIX, STALL_ORPHANED_PREFIX } from '../src/coord/stall.js';
import type { StallW2Facts } from '../src/coord/stall.js';

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

// ── Wave 2's vocabulary in the facts (plan Task 10) ──────────────────────────────────────────────────────────
describe('wave 2 vocabulary: a self-wake notice is the watch’s own, never mail on the run', () => {
  const selfWake = (subject: string): StallMailRow => mailRow(3000, NOW - H, 'operator', WORKER, 'status', subject);
  it.each([
    `${STALL_ORPHANED_PREFIX} your background subagent ended at 2026-09-29T10:50Z without waking you`,
    `${STALL_FAILED_PREFIX} your turn ended on an API error (server_error) at 2026-09-29T10:50Z`,
  ])('%s moves neither the quiet clock, the inbound mail nor the episode key', (subject) => {
    const input = stallInput({ mail: [selfWake(subject)] });
    expect(stallFacts(input)).toEqual(stallFacts(stallInput()));
    expect(stallVerdict(input, NOW)).toEqual(r1(RUN67_DISPATCHED));
  });
  it('CONTROL: the same subject from a coordinator is inbound mail, and it restarts the quiet clock', () => {
    const input = stallInput({ mail: [mailRow(3000, NOW - H, COORD, WORKER, 'status', `${STALL_FAILED_PREFIX} x`)] });
    expect(stallFacts(input).inboundLast?.id).toBe(3000);
    expect(stallVerdict(input, NOW)).toEqual(NONE);
  });
  it('w2-facts-separate-object (D-3629): a w2 fact set changes nothing wave 1 derives', () => {
    const w2: StallW2Facts = {
      mark: { ok: false, reason: 'absent' }, hook: { ok: false, reason: 'absent' }, deliveries: [],
      absentSince: null, deadSince: null, markUnreadableSince: null,
    };
    expect(stallFacts({ ...stallInput(), w2 })).toEqual(stallFacts(stallInput()));
  });
  it('a run-less mail row is a StallMailRow (runId null)', () => {
    const row: StallMailRow = { ...mailRow(3001, NOW - H, PEER, WORKER), runId: null };
    expect(row.runId).toBeNull();
  });
});

// ── wave 2 (spec 2026-09-29 §5.1, §5.2, §10): the run verdict after the turn marker ─────────────────────────────
// Every row builds on the wave-1 factories above. The `w2(...)` builder adds the facts wave 2 reads as a separate
// object (`w2-facts-separate-object` (D-3629)), so no wave-1 row changes. `W2_LIVE` arms the wave-2 rules; `ARMED` (the
// default) is the dark: wave-2 facts present, `stall-watch-w2-live` absent.
import {
  stallMarkView, stallMailDisabledHold, stallRunMail, stallCitedCheck, stallNotifyDelivery,
  STALL_BOUND_MS, DELEGATE_WINDOW_MS, DELEGATE_CAP_MS, FROZEN_NO_EVENT_MS, DEAD_GRACE_MS, COORD_DEAF_MS,
  CHECK_UNDELIVERED_MS, MARKER_UNREADABLE_MS,
} from '../src/coord/stall.js';
import type { HookRawFact, StallDeliveryRow, StallW2Cause, TurnMarkRead } from '../src/coord/stall.js';

const W2_LIVE: StallArming = { disabled: false, live: true, escalate: true, w2Live: true };
const UUID = 'uuid-1';
type OkMark = Extract<TurnMarkRead, { ok: true }>;

/** A current `done` marker: the worker's last Stop 3 h before NOW, a 10-minute turn, nothing in the background. */
function markOf(over: Partial<OkMark> = {}): TurnMarkRead {
  const stopAt = NOW - 3 * H;
  return {
    ok: true, sessionId: UUID, state: 'done', event: 'Stop', at: stopAt, turnAt: stopAt - 10 * MIN, stopAt,
    bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null,
    ...over,
  };
}
const UNREADABLE: TurnMarkRead = { ok: false, reason: 'unmeasured' };
const MALFORMED: TurnMarkRead = { ok: false, reason: 'malformed' };

/** A raw hook fact that is this session's (identity current), stamped `updatedAt` by `event`. */
function hookAt(updatedAt: number, event: string | null = 'PostToolUse', over: Partial<Extract<HookRawFact, { ok: true }>> = {}): HookRawFact {
  return { ok: true, updatedAt, event, sessionId: UUID, identity: 'current', ...over };
}
const HOOK_ABSENT: HookRawFact = { ok: false, reason: 'absent' };

function w2(over: Partial<StallW2Facts> = {}): StallW2Facts {
  return { mark: markOf(), hook: HOOK_ABSENT, deliveries: [], absentSince: null, deadSince: null, markUnreadableSince: null, ...over };
}
function w2Input(over: Over = {}, facts: Partial<StallW2Facts> = {}): StallInput {
  return { ...stallInput(over), w2: w2(facts) };
}
function delivery(id: number, mailId: number, toId: string, over: Partial<StallDeliveryRow> = {}): StallDeliveryRow {
  return { id, mailId, toId, state: 'queued', deliveredAt: null, ackedAt: null, lastGate: null, gateSince: null, ...over };
}
const vw = (over: Over = {}, facts: Partial<StallW2Facts> = {}, at = NOW): StallVerdict => stallVerdict(w2Input(over, facts), at);

const dead = (key: number, because: StallW2Cause, coordinatorId: string | null = COORD): StallVerdict => coordinatorId === null
  ? { act: 'notify', arm: 'dead', rung: 1, key, to: 'operator', because }
  : { act: 'notify', arm: 'dead', rung: 1, key, to: 'coordinator', coordinatorId, because };
const frozenV = (key: number, coordinatorId: string | null = COORD): StallVerdict => coordinatorId === null
  ? { act: 'notify', arm: 'frozen', rung: 1, key, to: 'operator', because: 'no-hook-event' }
  : { act: 'notify', arm: 'frozen', rung: 1, key, to: 'coordinator', coordinatorId, because: 'no-hook-event' };
const w2Push = (arm: 'coord-deaf' | 'mail-stuck' | 'marker-unreadable', key: number): StallVerdict =>
  ({ act: 'notify', arm, rung: 1, key, to: 'operator' });

/** A frozen-shaped worker: a turn begun 2 h ago (turnAt, the frozen key) under a busy word. */
const FROZEN_OVER: Partial<OkMark> = { state: 'working', event: 'PostToolUse', at: NOW - 2 * H, turnAt: NOW - 2 * H, stopAt: NOW - 5 * H };
const FROZEN = markOf(FROZEN_OVER);
const fv = (hook: HookRawFact, over: Over = {}, facts: Partial<StallW2Facts> = {}, at = NOW): StallVerdict =>
  vw({ arming: W2_LIVE, worker: workerAt({ live: liveWord('busy', NOW - 2 * H) }), ...over }, { mark: FROZEN, hook, ...facts }, at);

/** The worker's question to the coordinator role, 61 min old, delivered to the claimant a minute later. */
const Q_AT = NOW - 61 * MIN;
const Q = mailRow(4001, Q_AT, WORKER, 'coordinator', 'question', 'which base?');
const QD = delivery(9101, 4001, COORD, { state: 'delivered', deliveredAt: Q_AT + MIN });

describe('wave 2: the §10 order after the turn marker, first match wins', () => {
  it('the base wave-2 input fires r1, under the w2 marker and in the dark', () => {
    expect(vw({ arming: W2_LIVE })).toEqual(r1(RUN67_DISPATCHED));
    expect(vw()).toEqual(r1(RUN67_DISPATCHED));
  });

  it.each([UNREADABLE, MALFORMED])('2a: a marker reading $reason for MARKER_UNREADABLE_MS pushes marker-unreadable ahead of an absent worker', (mark) => {
    const facts: Partial<StallW2Facts> = { mark, markUnreadableSince: NOW - MARKER_UNREADABLE_MS, absentSince: NOW - 2 * H };
    const gone: Over = { worker: { present: false }, arming: W2_LIVE };
    expect(vw(gone, facts)).toEqual(w2Push('marker-unreadable', RUN67_DISPATCHED));
    expect(vw(gone, { ...facts, markUnreadableSince: NOW - MARKER_UNREADABLE_MS + 1 })).toEqual(dead(RUN67_DISPATCHED, 'registry-absent'));
  });

  it.each(['absent', 'foreign', 'stale'] as const)('2a: a marker reading %s never pushes marker-unreadable', (reason) => {
    expect(vw({ arming: W2_LIVE }, { mark: { ok: false, reason }, markUnreadableSince: NOW - 5 * H })).toEqual(r1(RUN67_DISPATCHED));
  });

  it('2a: marker-unreadable is pushed once per episode, and again on the next one', () => {
    const done = [notice('live', 'marker-unreadable', 1, RUN67_DISPATCHED, NOW - 10 * MIN)];
    const facts = (mark: TurnMarkRead): Partial<StallW2Facts> => ({ mark, markUnreadableSince: NOW - 2 * H });
    expect(vw({ arming: W2_LIVE, notices: done }, facts(MALFORMED))).toEqual(r1(RUN67_DISPATCHED));
    expect(vw({ arming: W2_LIVE, notices: done }, facts(UNREADABLE))).toEqual(hold('unmeasured'));
    const own = mailRow(4100, NOW - 50 * MIN, WORKER, COORD, 'status', 'Task 3 pushed');
    expect(vw({ arming: W2_LIVE, notices: done, mail: [own] }, facts(MALFORMED))).toEqual(w2Push('marker-unreadable', own.at));
  });

  it('2b: an absent worker holds absent below DEAD_GRACE_MS and is the dead arm at it, once', () => {
    const gone: Over = { worker: { present: false }, arming: W2_LIVE };
    expect(vw(gone, { absentSince: NOW - DEAD_GRACE_MS + 1 })).toEqual(hold('absent'));
    expect(vw(gone, { absentSince: NOW - DEAD_GRACE_MS })).toEqual(dead(RUN67_DISPATCHED, 'registry-absent'));
    expect(vw(gone, { absentSince: null })).toEqual(hold('absent'));
    expect(vw({ ...gone, notices: [notice('live', 'dead', 1, RUN67_DISPATCHED, NOW - 5 * MIN)] }, { absentSince: NOW - H })).toEqual(hold('absent'));
    expect(stallVerdict(stallInput(gone), NOW)).toEqual(hold('absent'));
  });

  it('2b: the dead notice goes to the operator when coordination is paused or the run has no claimant', () => {
    const gone: Over = { worker: { present: false }, arming: W2_LIVE };
    expect(vw({ ...gone, coordinationPaused: true }, { absentSince: NOW - H })).toEqual(dead(RUN67_DISPATCHED, 'registry-absent', null));
    expect(vw({ ...gone, primary: { claimedBy: null } }, { absentSince: NOW - H })).toEqual(dead(RUN67_DISPATCHED, 'registry-absent', null));
  });

  it('2c before 3: an unmeasured fleet row holds unmeasured even on an orphan past the grace', () => {
    expect(vw({ arming: W2_LIVE, worker: workerAt({ unmeasured: true, lifecycle: 'orphan' }) }, { deadSince: NOW - H })).toEqual(hold('unmeasured'));
  });

  it('3: stopped holds lifecycle-stopped with the wave-2 facts, lifecycle without, and never feeds the dead arm', () => {
    const stopped = workerAt({ lifecycle: 'stopped', live: { ok: false, reason: 'no-pane' } });
    expect(vw({ arming: W2_LIVE, worker: stopped }, { deadSince: NOW - 5 * H })).toEqual(hold('lifecycle-stopped'));
    expect(vw({ worker: stopped }, { deadSince: NOW - 5 * H })).toEqual(hold('lifecycle-stopped'));
    expect(stallVerdict(stallInput({ arming: W2_LIVE, worker: stopped }), NOW)).toEqual(hold('lifecycle'));
  });

  it.each(['orphan', 'never-started'] as const)('3: lifecycle %s holds lifecycle below DEAD_GRACE_MS and is the dead arm at it, once', (lifecycle) => {
    const worker = workerAt({ lifecycle });
    expect(vw({ arming: W2_LIVE, worker }, { deadSince: NOW - DEAD_GRACE_MS + 1 })).toEqual(hold('lifecycle'));
    expect(vw({ arming: W2_LIVE, worker }, { deadSince: NOW - DEAD_GRACE_MS })).toEqual(dead(RUN67_DISPATCHED, lifecycle));
    expect(vw({ arming: W2_LIVE, worker, notices: [notice('live', 'dead', 1, RUN67_DISPATCHED, NOW - MIN)] }, { deadSince: NOW - H })).toEqual(hold('lifecycle'));
  });

  it('3 before 4: a dead-shaped lifecycle with no pane or a null stamp is the dead path', () => {
    const noPane = workerAt({ lifecycle: 'orphan', live: { ok: false, reason: 'no-pane' } });
    const noStamp = workerAt({ lifecycle: 'never-started', live: liveWord('idle', null) });
    expect(vw({ arming: W2_LIVE, worker: noPane }, { deadSince: NOW - 11 * MIN })).toEqual(dead(RUN67_DISPATCHED, 'orphan'));
    expect(vw({ arming: W2_LIVE, worker: noStamp }, { deadSince: NOW - 11 * MIN })).toEqual(dead(RUN67_DISPATCHED, 'never-started'));
    // Without the wave-2 facts the same worker now holds `lifecycle` where wave 1 held `unmeasured`: a hold either way.
    expect(stallVerdict(stallInput({ worker: noPane }), NOW)).toEqual(hold('lifecycle'));
  });

  it('4: under the w2 marker an unmeasured turn marker holds unmeasured, and a malformed one takes wave 1', () => {
    expect(vw({ arming: W2_LIVE }, { mark: UNREADABLE })).toEqual(hold('unmeasured'));
    expect(vw({ arming: W2_LIVE }, { mark: MALFORMED })).toEqual(r1(RUN67_DISPATCHED));
  });

  it('6 before 7: a limit-locked worker inside a restart grace holds limit', () => {
    expect(vw({ arming: W2_LIVE, worker: workerAt({ limits: { five: 100, seven: 10 } }) }, { mark: markOf({ graceUntil: NOW + MIN }) }))
      .toEqual(hold('limit'));
  });

  it('7: restart-grace holds until graceUntil, under the w2 marker only', () => {
    const graceMark = (graceUntil: number): TurnMarkRead => markOf({
      event: 'SessionStart', at: NOW - 4 * MIN, restartAt: NOW - 4 * MIN, turnAt: NOW - 3 * H + 5 * MIN, graceUntil,
    });
    expect(vw({ arming: W2_LIVE }, { mark: graceMark(NOW + 1) })).toEqual(hold('restart-grace'));
    expect(vw({ arming: W2_LIVE }, { mark: graceMark(NOW) })).toEqual(r1(RUN67_DISPATCHED));
    expect(vw({}, { mark: graceMark(NOW + 1) })).toEqual(r1(RUN67_DISPATCHED));
  });

  it('7 before 8: a frozen-shaped worker inside a restart grace holds restart-grace', () => {
    expect(fv(hookAt(NOW - 2 * H), {}, { mark: markOf({ ...FROZEN_OVER, graceUntil: NOW + MIN }) })).toEqual(hold('restart-grace'));
  });
});

describe('wave 2: frozen (§5.2, §10 step 8)', () => {
  it('8: FROZEN_NO_EVENT_MS with no main hook event fires to the claimant, keyed on turnAt; a fresher event holds busy', () => {
    expect(fv(hookAt(NOW - 59 * MIN))).toEqual(hold('busy'));
    expect(fv(hookAt(NOW - FROZEN_NO_EVENT_MS + 1))).toEqual(hold('busy'));
    expect(fv(hookAt(NOW - FROZEN_NO_EVENT_MS))).toEqual(frozenV(NOW - 2 * H));
    expect(fv(hookAt(NOW - 61 * MIN))).toEqual(frozenV(NOW - 2 * H));
    expect(fv(hookAt(NOW - 5 * H))).toEqual(frozenV(NOW - 2 * H));
    expect(fv(hookAt(NOW - MIN, null))).toEqual(hold('busy'));
  });

  it.each(['SessionStart', 'PreCompact', 'PostCompact'])('8: a %s hook event is plumbing and never refreshes the frozen clock', (event) => {
    expect(fv(hookAt(NOW - MIN, event))).toEqual(frozenV(NOW - 2 * H));
  });

  it.each([
    { label: 'a foreign hook', hook: hookAt(NOW - 5 * H, 'PostToolUse', { identity: 'foreign' }) },
    { label: 'an unregistered hook', hook: hookAt(NOW - 5 * H, 'PostToolUse', { identity: 'unregistered' }) },
    { label: 'a hook with an empty session id', hook: hookAt(NOW - 5 * H, 'PostToolUse', { sessionId: '' }) },
    { label: 'an unmeasured hook', hook: { ok: false, reason: 'unmeasured' } as HookRawFact },
    { label: 'an absent hook', hook: HOOK_ABSENT },
  ])('8: $label makes the frozen clock unmeasurable: hold busy, never frozen', ({ hook }) => {
    expect(fv(hook)).toEqual(hold('busy'));
  });

  it('8: paused, or with no claimant, frozen goes to the operator', () => {
    expect(fv(hookAt(NOW - 61 * MIN), { coordinationPaused: true })).toEqual(frozenV(NOW - 2 * H, null));
    expect(fv(hookAt(NOW - 61 * MIN), { primary: { claimedBy: null } })).toEqual(frozenV(NOW - 2 * H, null));
  });

  it('8: frozen fires once per turn, and again on the next turn', () => {
    const done = [notice('live', 'frozen', 1, NOW - 2 * H, NOW - 50 * MIN)];
    expect(fv(hookAt(NOW - 61 * MIN), { notices: done })).toEqual(hold('busy'));
    const nextTurn = markOf({ ...FROZEN_OVER, at: NOW - 90 * MIN, turnAt: NOW - 90 * MIN });
    expect(fv(hookAt(NOW - 61 * MIN), { notices: done }, { mark: nextTurn })).toEqual(frozenV(NOW - 90 * MIN));
  });
});

describe('wave 2: delegates (§5.1, §10 step 9)', () => {
  const dv = (hook: HookRawFact, over: Over = {}, facts: Partial<StallW2Facts> = {}): StallVerdict =>
    vw({ arming: W2_LIVE, ...over }, { hook, ...facts });

  it('9: a current main hook event inside DELEGATE_WINDOW_MS holds delegates; at the window it does not', () => {
    expect(dv(hookAt(NOW - 29 * MIN))).toEqual(hold('delegates'));
    expect(dv(hookAt(NOW - DELEGATE_WINDOW_MS + 1))).toEqual(hold('delegates'));
    expect(dv(hookAt(NOW - DELEGATE_WINDOW_MS))).toEqual(r1(RUN67_DISPATCHED));
    expect(dv(hookAt(NOW - 31 * MIN))).toEqual(r1(RUN67_DISPATCHED));
  });

  it('9: delegates is capped at DELEGATE_CAP_MS of main silence', () => {
    const quietFrom = (t0: number): Partial<StallW2Facts> => ({ mark: markOf({ at: t0, stopAt: t0, turnAt: t0 - 10 * MIN }) });
    const idleFrom = (t0: number): Over => ({ worker: workerAt({ live: liveWord('idle', t0) }) });
    expect(dv(hookAt(NOW - MIN), idleFrom(NOW - DELEGATE_CAP_MS + 1), quietFrom(NOW - DELEGATE_CAP_MS + 1))).toEqual(hold('delegates'));
    expect(dv(hookAt(NOW - MIN), idleFrom(NOW - DELEGATE_CAP_MS), quietFrom(NOW - DELEGATE_CAP_MS))).toEqual(r1(RUN67_DISPATCHED));
  });

  it('9: a plumbing event, a foreign hook, the dark and an empty session id never hold delegates', () => {
    expect(dv(hookAt(NOW - MIN, 'SessionStart'))).toEqual(r1(RUN67_DISPATCHED));
    expect(dv(hookAt(NOW - MIN, 'PostToolUse', { identity: 'foreign' }))).toEqual(r1(RUN67_DISPATCHED));
    expect(vw({}, { hook: hookAt(NOW - MIN) })).toEqual(r1(RUN67_DISPATCHED));
    expect(dv(hookAt(NOW - MIN, 'PostToolUse', { sessionId: '' }))).toEqual(r1(RUN67_DISPATCHED));
  });

  it('9: delegates holds the quiet arm only: under the coordinator ball the verdict is the ball verdict', () => {
    const question = mailRow(4001, NOW - 4 * H, WORKER, 'coordinator', 'question', 'which base?');
    expect(dv(hookAt(NOW - MIN), { mail: [question] })).toEqual(NONE);
  });
});

describe('wave 2: coord-deaf (§5.2, §10 step 10)', () => {
  const cv = (mail: StallMailRow[], deliveries: StallDeliveryRow[], over: Over = {}, at = NOW): StallVerdict =>
    vw({ arming: W2_LIVE, mail, ...over }, { deliveries }, at);

  it('10: a question to the coordinator unacked COORD_DEAF_MS pushes coord-deaf once, keyed on the mail', () => {
    expect(cv([Q], [QD])).toEqual(w2Push('coord-deaf', 4001));
    expect(cv([Q], [QD], {}, Q_AT + COORD_DEAF_MS)).toEqual(w2Push('coord-deaf', 4001));
    expect(cv([Q], [QD], {}, Q_AT + COORD_DEAF_MS - 1)).toEqual(NONE);
    expect(cv([{ ...Q, at: NOW - 59 * MIN }], [QD])).toEqual(NONE);
    expect(cv([Q], [QD], { notices: [notice('live', 'coord-deaf', 1, 4001, NOW - MIN)] })).toEqual(NONE);
  });

  it('10: an acked question is not deaf', () => {
    expect(cv([Q], [{ ...QD, state: 'acked', ackedAt: Q_AT + 2 * MIN }])).toEqual(NONE);
  });

  it('10: a ball-passing mail with NO delivery row is not deaf: nothing measured it unacked, and the coord-ball cap still fires', () => {
    expect(cv([Q], [])).toEqual(NONE);
    const done = mailRow(4002, Q_AT, WORKER, 'coordinator', 'status', WAVE_DONE_SUBJECT);
    expect(cv([done], [])).toEqual(NONE);
    expect(cv([Q], [{ ...QD, mailId: 4999 }])).toEqual(NONE);
    const old = mailRow(4001, NOW - COORD_BALL_CAP_MS, WORKER, 'coordinator', 'question', 'which base?');
    expect(cv([old], [])).toEqual(capOf('coord-ball', old.at));
    // CONTROL: the same question with its delivery row is deaf
    expect(cv([Q], [QD])).toEqual(w2Push('coord-deaf', 4001));
  });

  it('10: a wave-done or review-done status is deaf too; a question to a peer is not the coordinator one', () => {
    for (const subject of [WAVE_DONE_SUBJECT, REVIEW_DONE_SUBJECT]) {
      const done = mailRow(4002, Q_AT, WORKER, 'coordinator', 'status', subject);
      expect(cv([done], [{ ...QD, mailId: 4002 }]), subject).toEqual(w2Push('coord-deaf', 4002));
    }
    const toPeer = mailRow(4003, Q_AT, WORKER, PEER, 'question', 'which base?');
    expect(cv([toPeer], [{ ...QD, mailId: 4003, toId: PEER }])).toEqual(NONE);
  });

  it('10: coord-deaf comes before the coord-ball cap, and the cap still fires once after it', () => {
    const old = mailRow(4001, NOW - COORD_BALL_CAP_MS, WORKER, 'coordinator', 'question', 'which base?');
    const oldD = delivery(9101, 4001, COORD, { state: 'delivered', deliveredAt: old.at + MIN });
    expect(cv([old], [oldD])).toEqual(w2Push('coord-deaf', 4001));
    expect(cv([old], [oldD], { notices: [notice('live', 'coord-deaf', 1, 4001, old.at + COORD_DEAF_MS)] })).toEqual(capOf('coord-ball', old.at));
  });
});

describe('wave 2: the worker ball on the marker clock (§5.1, §10 step 11)', () => {
  it('11: quiet runs from stopAt: a restamped live stamp does not restart it', () => {
    const restamped = workerAt({ live: liveWord('idle', NOW - 30 * MIN) });
    expect(vw({ arming: W2_LIVE, worker: restamped })).toEqual(r1(RUN67_DISPATCHED));
    expect(vw({ worker: restamped })).toEqual(NONE);
  });

  it('11: busy workers are judged: a busy word over a done marker fires r1', () => {
    expect(vw({ arming: W2_LIVE, worker: workerAt({ live: liveWord('busy', NOW - 3 * H) }) })).toEqual(r1(RUN67_DISPATCHED));
  });

  it('11: a working marker at least as new as the live stamp holds busy; an older one reads as a turn interrupted at the stamp', () => {
    const working = (at: number, stopAt: number | null = null): Partial<StallW2Facts> =>
      ({ mark: markOf({ state: 'working', event: 'UserPromptSubmit', at, turnAt: at, stopAt }) });
    expect(vw({ arming: W2_LIVE }, working(NOW - 3 * H))).toEqual(hold('busy'));
    expect(vw({ arming: W2_LIVE }, working(NOW - 3 * H, NOW - 4 * H))).toEqual(hold('busy'));
    expect(vw({ arming: W2_LIVE }, working(NOW - 3 * H - 1))).toEqual(r1(RUN67_DISPATCHED));
    expect(vw({ arming: W2_LIVE, worker: workerAt({ live: liveWord('shell', NOW - H) }) }, working(NOW - 3 * H))).toEqual(NONE);
  });

  it('11: a word other than idle, shell or busy holds unmeasured', () => {
    expect(vw({ arming: W2_LIVE, worker: workerAt({ live: liveWord('thinking', NOW - 3 * H) }) })).toEqual(hold('unmeasured'));
  });

  it('11: a done marker with no stopAt takes wave 1 ladder', () => {
    const noStop: Partial<StallW2Facts> = { mark: markOf({ stopAt: null, event: 'SessionStart' }) };
    expect(vw({ arming: W2_LIVE, worker: workerAt({ live: liveWord('busy', NOW - 3 * H) }) }, noStop)).toEqual(hold('busy'));
    expect(vw({ arming: W2_LIVE, worker: workerAt({ live: liveWord('idle', NOW - 30 * MIN) }) }, noStop)).toEqual(NONE);
  });
});

describe('wave 2: escalation on proof (§5.1 (a) to (d)), and r3 an hour after r2', () => {
  // r1 went out live at R1 as stall check #5001; the worker's next Stop came 5 min later, and it has been idle since.
  const R1 = NOW - 30 * MIN;
  const CHECK = mailRow(5001, R1, 'operator', WORKER, 'status', `${STALL_CHECK_PREFIX} run 67 — quiet 2h 0m, owed: first report`);
  const R1_ROW = notice('live', 'quiet', 1, RUN67_DISPATCHED, R1);
  const DELIVERED = delivery(9001, 5001, WORKER, { state: 'delivered', deliveredAt: R1 + MIN });
  const UNDELIVERED = delivery(9001, 5001, WORKER);
  const AFTER: Partial<OkMark> = { at: R1 + 5 * MIN, stopAt: R1 + 5 * MIN, turnAt: R1 + 2 * MIN, bg: 1, bgKinds: ['shell'], bgIds: ['b989ocn62'] };
  const pv = (facts: Partial<StallW2Facts>, at = NOW, over: Over = {}): StallVerdict => stallVerdict(w2Input({
    arming: W2_LIVE, coordinator: 'alive', mail: [CHECK], notices: [R1_ROW],
    worker: workerAt({ live: liveWord('idle', R1 + 5 * MIN) }), ...over,
  }, facts), at);

  it('(a): the first Stop after a delivered check with a measured bg and no wake-bearing kind escalates at once', () => {
    expect(pv({ mark: markOf(AFTER), deliveries: [DELIVERED] })).toEqual(r2(RUN67_DISPATCHED));
  });

  it.each([
    { label: 'bg unmeasured', mark: { ...AFTER, bg: -1, bgKinds: [], bgIds: [] }, deliveries: [DELIVERED] },
    { label: 'a subagent at the Stop', mark: { ...AFTER, bg: 2, bgKinds: ['shell', 'subagent'] }, deliveries: [DELIVERED] },
    { label: 'a workflow at the Stop', mark: { ...AFTER, bgKinds: ['workflow'] }, deliveries: [DELIVERED] },
    { label: 'a Stop at the delivery, not after it', mark: { ...AFTER, at: R1 + MIN, stopAt: R1 + MIN }, deliveries: [DELIVERED] },
    { label: 'a StopFailure, not a Stop', mark: { ...AFTER, state: 'failed', err: 'server_error' }, deliveries: [DELIVERED] },
    { label: 'a check never delivered', mark: AFTER, deliveries: [UNDELIVERED] },
  ] as Array<{ label: string; mark: Partial<OkMark>; deliveries: StallDeliveryRow[] }>)('(a) does not fire: $label', ({ mark, deliveries }) => {
    expect(pv({ mark: markOf(mark), deliveries })).toEqual(NONE);
  });

  it('(a) does not fire: a check from an earlier episode', () => {
    const oldCheck = mailRow(4990, RUN67_DISPATCHED - MIN, 'operator', WORKER, 'status', `${STALL_CHECK_PREFIX} run 67 — quiet 2h 0m, owed: first report`);
    expect(pv({ mark: markOf(AFTER), deliveries: [{ ...DELIVERED, mailId: 4990 }] }, NOW, { mail: [oldCheck] })).toEqual(NONE);
  });

  it('(c) does not fire: a check from an earlier episode', () => {
    const oldCheck = mailRow(4990, RUN67_DISPATCHED - MIN, 'operator', WORKER, 'status', `${STALL_CHECK_PREFIX} run 67 — quiet 2h 0m, owed: first report`);
    expect(pv({ mark: markOf(AFTER), deliveries: [{ ...UNDELIVERED, mailId: 4990 }] }, R1 + CHECK_UNDELIVERED_MS, { mail: [oldCheck] })).toEqual(NONE);
  });

  it('the proofs never see a worker mail after the check: it opens a new episode, and r1 is not done on the new key', () => {
    const after = mailRow(4200, R1 + 10 * MIN, WORKER, COORD, 'status', 'Task 3 pushed');
    // proof (a) holds on the old key (a delivered check, then a Stop with only a shell), yet the new key has no r1
    expect(pv({ mark: markOf(AFTER), deliveries: [DELIVERED] }, NOW, { mail: [CHECK, after] })).toEqual(NONE);
    // CONTROL: without the worker's mail the same facts escalate
    expect(pv({ mark: markOf(AFTER), deliveries: [DELIVERED] }, NOW, { mail: [CHECK] })).toEqual(r2(RUN67_DISPATCHED));
  });

  it('(b): two orphan-e keys inside the episode escalate; one, a repeated key or keys outside it do not', () => {
    const e = (key: number, mode: StallMode = 'live'): StallNotice => notice(mode, 'orphan-e', 1, key, key + 10 * MIN);
    const noA: Partial<StallW2Facts> = { mark: markOf({ ...AFTER, bg: -1, bgKinds: [], bgIds: [] }), deliveries: [DELIVERED] };
    expect(pv(noA, NOW, { notices: [R1_ROW, e(R1 + 2 * MIN), e(R1 + 20 * MIN)] })).toEqual(r2(RUN67_DISPATCHED));
    expect(pv(noA, NOW, { notices: [R1_ROW, e(R1 + 2 * MIN, 'shadow'), e(R1 + 20 * MIN, 'shadow')] })).toEqual(r2(RUN67_DISPATCHED));
    expect(pv(noA, NOW, { notices: [R1_ROW, e(R1 + 2 * MIN)] })).toEqual(NONE);
    expect(pv(noA, NOW, { notices: [R1_ROW, e(R1 + 2 * MIN), e(R1 + 2 * MIN, 'shadow')] })).toEqual(NONE);
    expect(pv(noA, NOW, { notices: [R1_ROW, e(RUN67_DISPATCHED), e(RUN67_DISPATCHED - MIN)] })).toEqual(NONE);
  });

  it('(c): a check still undelivered CHECK_UNDELIVERED_MS after it was queued escalates', () => {
    const c: Partial<StallW2Facts> = { mark: markOf(AFTER), deliveries: [UNDELIVERED] };
    expect(pv(c, R1 + CHECK_UNDELIVERED_MS - 1)).toEqual(NONE);
    expect(pv(c, R1 + CHECK_UNDELIVERED_MS)).toEqual(r2(RUN67_DISPATCHED));
    expect(pv({ mark: markOf(AFTER), deliveries: [] }, R1 + CHECK_UNDELIVERED_MS)).toEqual(NONE);
    expect(pv({ mark: markOf({ ...AFTER, bgKinds: ['subagent'] }), deliveries: [DELIVERED] }, R1 + CHECK_UNDELIVERED_MS)).toEqual(NONE);
  });

  it('(d): STALL_BOUND_MS after r1 escalates whatever the Stops showed', () => {
    const noProof: Partial<StallW2Facts> = { mark: markOf({ ...AFTER, bgKinds: ['subagent'] }), deliveries: [DELIVERED] };
    expect(pv(noProof, R1 + STALL_BOUND_MS - 1)).toEqual(NONE);
    expect(pv(noProof, R1 + STALL_BOUND_MS)).toEqual(r2(RUN67_DISPATCHED));
  });

  it('r3 follows r2 by STALL_OPERATOR_MS and is never re-timed by a later live stamp', () => {
    const R2_ROW = notice('live', 'quiet', 2, RUN67_DISPATCHED, R1 + 20 * MIN);
    const facts: Partial<StallW2Facts> = { mark: markOf(AFTER), deliveries: [DELIVERED] };
    expect(pv(facts, R1 + 20 * MIN + STALL_OPERATOR_MS - 1, { notices: [R1_ROW, R2_ROW] })).toEqual(NONE);
    expect(pv(facts, R1 + 20 * MIN + STALL_OPERATOR_MS, { notices: [R1_ROW, R2_ROW] })).toEqual(r3(RUN67_DISPATCHED, 'still-silent'));
    // wave 1's `rungDueAt` would move r3 to R1 + 150 min here: the stamp turned idle again past r2's hour
    expect(pv(facts, R1 + 100 * MIN, { notices: [R1_ROW, R2_ROW], worker: workerAt({ live: liveWord('idle', R1 + 90 * MIN) }) }))
      .toEqual(r3(RUN67_DISPATCHED, 'still-silent'));
  });

  it('with no proof the marker ladder waits, where wave 1 escalates at r1 + 1 h: no marker, or the dark', () => {
    const waiting: Partial<StallW2Facts> = { mark: markOf(AFTER), deliveries: [] };
    expect(pv({ mark: { ok: false, reason: 'absent' }, deliveries: [] }, R1 + H)).toEqual(r2(RUN67_DISPATCHED));
    expect(pv(waiting, R1 + H)).toEqual(NONE);
    expect(pv(waiting, R1 + H, { arming: ARMED })).toEqual(r2(RUN67_DISPATCHED));
  });

  it('a due r2 still measures the claimant, and a paused coordination still goes to r3', () => {
    const proven: Partial<StallW2Facts> = { mark: markOf(AFTER), deliveries: [DELIVERED] };
    expect(pv(proven, NOW, { coordinator: null })).toEqual({ act: 'measure-coordinator', coordinatorId: COORD });
    expect(pv(proven, NOW, { coordinationPaused: true })).toEqual(r3(RUN67_DISPATCHED, 'coordination-paused'));
  });
});

describe('wave 2: the dark keeps wave 1 (F3, dark-mode-keeps-wave-1-verdict (D-3645))', () => {
  it('dark: a busy worker with a done marker holds busy', () => {
    expect(vw({ worker: workerAt({ live: liveWord('busy', NOW - 3 * H) }) })).toEqual(hold('busy'));
  });

  it('dark: an unmeasured marker, idle past 2 h, gives wave 1 r1 at once, or one sweep after a marker-unreadable shadow', () => {
    expect(vw({}, { mark: UNREADABLE })).toEqual(r1(RUN67_DISPATCHED));
    expect(vw({}, { mark: UNREADABLE, markUnreadableSince: NOW - 2 * H })).toEqual(w2Push('marker-unreadable', RUN67_DISPATCHED));
    expect(stallNotifyDelivery('marker-unreadable', 'operator', ARMED)).toBe('shadow');
    const shadowed = [notice('shadow', 'marker-unreadable', 1, RUN67_DISPATCHED, NOW - MIN)];
    expect(vw({ notices: shadowed }, { mark: UNREADABLE, markUnreadableSince: NOW - 2 * H })).toEqual(r1(RUN67_DISPATCHED));
  });

  it('dark: frozen, dead and coord-deaf answer notify, stallNotifyDelivery makes each shadow, and a standing shadow row is done', () => {
    const fz = fv(hookAt(NOW - 61 * MIN), { arming: ARMED });
    const dd = vw({ worker: { present: false } }, { absentSince: NOW - H });
    const deaf = vw({ mail: [Q] }, { deliveries: [QD] });
    expect(fz).toEqual(frozenV(NOW - 2 * H));
    expect(dd).toEqual(dead(RUN67_DISPATCHED, 'registry-absent'));
    expect(deaf).toEqual(w2Push('coord-deaf', 4001));
    for (const v of [fz, dd, deaf]) {
      if (v.act !== 'notify') throw new Error(`expected a notify, got ${v.act}`);
      expect(stallNotifyDelivery(v.arm, v.to, ARMED), v.arm).toBe('shadow');
    }
    expect(vw({ worker: { present: false }, notices: [notice('shadow', 'dead', 1, RUN67_DISPATCHED, NOW - MIN)] }, { absentSince: NOW - H }))
      .toEqual(hold('absent'));
  });
});

describe('wave 2: mail-disabled holds every mail rung that would send (lane-honours-mail-disabled (D-3636))', () => {
  const MD: StallArming = { ...ARMED, mailDisabled: true };
  const MD_SHADOW: StallArming = { ...SHADOW, mailDisabled: true };
  const MD_LIVE_ONLY: StallArming = { ...LIVE_ONLY, mailDisabled: true };
  const MD_W2: StallArming = { ...W2_LIVE, mailDisabled: true };
  const R1_LIVE = [notice('live', 'quiet', 1, RUN67_DISPATCHED, NOW - 2 * H)];

  it('md: r1 that would send holds mail-disabled', () => {
    expect(stallVerdict(stallInput({ arming: MD }), NOW)).toEqual(hold('mail-disabled'));
  });

  it('md: r1 in shadow stands, so the lane still records its shadow row', () => {
    expect(stallVerdict(stallInput({ arming: MD_SHADOW }), NOW)).toEqual(r1(RUN67_DISPATCHED));
  });

  it('md: with r1 done live, measure-coordinator and r2 hold; with escalation unarmed they stand', () => {
    expect(stallVerdict(stallInput({ arming: MD, notices: R1_LIVE }), NOW)).toEqual(hold('mail-disabled'));
    expect(stallVerdict(stallInput({ arming: MD, notices: R1_LIVE, coordinator: 'alive' }), NOW)).toEqual(hold('mail-disabled'));
    expect(stallVerdict(stallInput({ arming: MD_LIVE_ONLY, notices: R1_LIVE }), NOW)).toEqual({ act: 'measure-coordinator', coordinatorId: COORD });
  });

  it('md: with r1 done and coordination paused, r3 still pushes to the operator', () => {
    expect(stallVerdict(stallInput({ arming: MD, notices: R1_LIVE, coordinationPaused: true }), NOW)).toEqual(r3(RUN67_DISPATCHED, 'coordination-paused'));
  });

  it('md: the caps still push', () => {
    expect(stallVerdict(stallInput({ arming: MD, worker: workerAt({ live: liveWord('waiting', NOW - 3 * H) }) }), NOW))
      .toEqual(capOf('dialog-cap', RUN67_DISPATCHED));
  });

  it('md: a wave-2 dead notice to the claimant holds; to the operator it pushes; in the dark it stands', () => {
    const gone: Over = { worker: { present: false } };
    expect(vw({ ...gone, arming: MD_W2 }, { absentSince: NOW - H })).toEqual(hold('mail-disabled'));
    expect(vw({ ...gone, arming: MD_W2, coordinationPaused: true }, { absentSince: NOW - H })).toEqual(dead(RUN67_DISPATCHED, 'registry-absent', null));
    expect(vw({ ...gone, arming: MD }, { absentSince: NOW - H })).toEqual(dead(RUN67_DISPATCHED, 'registry-absent'));
  });

  it('md: the filter passes everything when mail-disabled is off, and never touches a hold or none', () => {
    expect(stallMailDisabledHold(r1(RUN67_DISPATCHED), ARMED)).toEqual(r1(RUN67_DISPATCHED));
    expect(stallMailDisabledHold(r1(RUN67_DISPATCHED), { ...ARMED, mailDisabled: false })).toEqual(r1(RUN67_DISPATCHED));
    expect(stallMailDisabledHold(hold('busy'), MD)).toEqual(hold('busy'));
    expect(stallMailDisabledHold(NONE, MD)).toEqual(NONE);
  });
});

describe('stallRunMail (F4, run-mail-filtered-in-l1 (D-3650))', () => {
  const onRun = mailRow(4100, NOW - 4 * H, WORKER, COORD, 'status', 'Task 2 pushed');
  const offRun = mailRow(4101, NOW - 20 * MIN, WORKER, COORD, 'status', 'run 68 pushed', 68);
  const runLess: StallMailRow = { ...mailRow(4102, NOW - 10 * MIN, WORKER, PEER, 'status', 'peer note'), runId: null };

  it('keeps only the rows on the subject runs: an off-run row and a run-less row are dropped', () => {
    expect(stallRunMail([onRun, offRun, runLess], [67])).toEqual([onRun]);
    expect(stallRunMail([onRun, offRun, runLess], [67, 68])).toEqual([onRun, offRun]);
    expect(stallRunMail([onRun, offRun, runLess], [])).toEqual([]);
  });

  it('F4 parity: the filtered read gives the facts and the verdict of the run-scoped mail; the whole read would move the key', () => {
    const whole = [onRun, offRun, runLess];
    const scoped = stallInput({ mail: stallRunMail(whole, [67]) });
    const waveOne = stallInput({ mail: [onRun] });
    expect(stallFacts(scoped)).toEqual(stallFacts(waveOne));
    expect(stallVerdict(scoped, NOW)).toEqual(stallVerdict(waveOne, NOW));
    expect(stallVerdict(waveOne, NOW)).toEqual(r1(onRun.at));
    expect(stallFacts(stallInput({ mail: whole })).episodeKeyMs).toBe(runLess.at);
  });
});

describe('stallCitedCheck (M7a, cited-check-derived-in-l1 (D-3634))', () => {
  it('stallCitedCheck cites the earliest live r1 row, else the earliest r1 row, on this key only', () => {
    const K = RUN67_DISPATCHED;
    const cite = (notices: StallNotice[]): StallNotice | null => stallCitedCheck(stallInput({ notices }), K);
    const s0 = notice('shadow', 'quiet', 1, K, NOW - 4 * H);
    const s1 = notice('shadow', 'quiet', 1, K, NOW - 3 * H);
    const l0 = notice('live', 'quiet', 1, K, NOW - 150 * MIN);
    const l1 = notice('live', 'quiet', 1, K, NOW - 2 * H);
    expect(cite([])).toBeNull();
    expect(cite([s1])).toEqual(s1);
    expect(cite([s1, l1])).toEqual(l1);
    expect(cite([l1, l0])).toEqual(l0);
    expect(cite([s1, s0])).toEqual(s0);
    expect(cite([notice('live', 'quiet', 1, K + 1, NOW), notice('live', 'quiet', 2, K, NOW), notice('live', 'dialog-cap', 1, K, NOW)])).toBeNull();
  });
});

describe('stallMarkView (§5.1, an interrupted turn)', () => {
  const viewOf = (over: Partial<OkMark>, live: LiveWordRead) => {
    const m = markOf(over);
    if (!m.ok) throw new Error('markOf builds an ok mark');
    return stallMarkView(m, live);
  };
  it('reads a working marker older than an idle or shell stamp as a turn interrupted at that stamp; anything else as written', () => {
    const W: Partial<OkMark> = { state: 'working', at: NOW - H, turnAt: NOW - H, stopAt: NOW - 2 * H };
    const asWritten = { state: 'working', stopAt: NOW - 2 * H, interrupted: false };
    expect(viewOf(W, liveWord('idle', NOW - H + 1))).toEqual({ state: 'done', stopAt: NOW - H + 1, interrupted: true });
    expect(viewOf(W, liveWord('shell', NOW - 30 * MIN))).toEqual({ state: 'done', stopAt: NOW - 30 * MIN, interrupted: true });
    expect(viewOf(W, liveWord('idle', NOW - H))).toEqual(asWritten);
    expect(viewOf(W, liveWord('busy', NOW - 30 * MIN))).toEqual(asWritten);
    expect(viewOf(W, liveWord('idle', null))).toEqual(asWritten);
    expect(viewOf(W, { ok: false, reason: 'no-state' })).toEqual(asWritten);
    expect(viewOf({ state: 'failed', err: 'server_error' }, liveWord('idle', NOW))).toEqual({ state: 'failed', stopAt: NOW - 3 * H, interrupted: false });
  });
});

// The self-wake facts row is Task 10's (`a self-wake notice is the watch’s own, never mail on the run`); it is not
// repeated here.
describe('wave 2: the approval envelope and the cause words', () => {
  it('a PermissionRequest approval is a dialog with no question behind it: hold 2b, capped once', () => {
    const A = t('2026-09-20T08:00:00Z');
    const primary: Partial<StallRunRow> = { dispatchedAt: A - 5 * H };
    const worker = workerAt({ live: liveWord('waiting', A), hookAsk: { kind: 'approval', at: A } });
    expect(stallVerdict(stallInput({ primary, worker }), A + H)).toEqual(hold('dialog'));
    expect(stallVerdict(stallInput({ primary, worker }), A + STALL_QUIET_MS)).toEqual(capOf('dialog-cap', A - 5 * H));
  });

  it('the wave-2 causes are declared for the coord kebab scan', () => {
    const causes: StallW2Cause[] = ['registry-absent', 'orphan', 'never-started', 'no-hook-event'];
    for (const w of causes) expect(isStallKebab(w), w).toBe(true);
  });
});

// ── fix round 1 (the Task 11 review): guard terms the first round left without a red row ─────────────────────────
// Each row below goes red under ONE named mutation of `stall.ts` and is green unmutated (the report lists each).
import { stallNewestDelivery } from '../src/coord/stall.js';

describe('wave 2: the marker quiet clock holds on each of its terms (§5.1, "Quiet with the marker")', () => {
  // The base worker has been idle since NOW - 3 h and its marker's Stop is 3 h old, so r1 is due at NOW. Each row puts
  // ONE other term 30 min old: that term alone holds the clock, r1 is not due, and the verdict is `none`. Each CONTROL
  // moves the same term back to 3 h, where it holds nothing and r1 fires.
  it('(a) the newest mail TO the worker holds the clock', () => {
    const reply = mailRow(4300, NOW - 30 * MIN, COORD, WORKER, 'status', 'Task 3 is yours');
    expect(vw({ arming: W2_LIVE, mail: [reply] })).toEqual(NONE);
    expect(vw({ arming: W2_LIVE, mail: [{ ...reply, at: NOW - 3 * H }] })).toEqual(r1(RUN67_DISPATCHED));
  });

  it('(b) the worker\'s own last mail holds the clock', () => {
    const own = mailRow(4301, NOW - 30 * MIN, WORKER, COORD, 'status', 'Task 3 pushed');
    expect(vw({ arming: W2_LIVE, mail: [own] })).toEqual(NONE);
    expect(vw({ arming: W2_LIVE, mail: [{ ...own, at: NOW - 3 * H }] })).toEqual(r1(NOW - 3 * H));
  });

  it('(c) the run\'s dispatchedAt holds the clock', () => {
    expect(vw({ arming: W2_LIVE, primary: { dispatchedAt: NOW - 30 * MIN } })).toEqual(NONE);
    expect(vw({ arming: W2_LIVE, primary: { dispatchedAt: NOW - 3 * H } })).toEqual(r1(NOW - 3 * H));
  });
});

describe('wave 2: frozen needs a BUSY word, and delegates a non-working marker (§10 steps 8 and 9)', () => {
  // A turn begun 2 h ago, at least as new as a 3 h live stamp (so the marker reads `working` as written), and a hook
  // event 61 min old: the frozen clock has run out, so ONLY the word term keeps this worker from `frozen`.
  const staleWorking = { mark: markOf(FROZEN_OVER), hook: hookAt(NOW - 61 * MIN) };
  const under = (word: string, arming: StallArming): Over => ({ arming, worker: workerAt({ live: liveWord(word, NOW - 3 * H) }) });

  it.each(['idle', 'shell'])('8: a working marker as new as the %s live stamp, with a stale current hook, is not frozen: hold busy', (word) => {
    expect(vw(under(word, W2_LIVE), staleWorking)).toEqual(hold('busy'));
    expect(vw(under(word, W2_LIVE), { ...staleWorking, hook: hookAt(NOW - 5 * H) })).toEqual(hold('busy'));
  });

  it('8: in the dark the same facts give wave 1\'s verdict, and frozen answers nothing', () => {
    const waveOne = stallVerdict(stallInput(under('idle', ARMED)), NOW);
    expect(waveOne).toEqual(r1(RUN67_DISPATCHED));
    expect(vw(under('idle', ARMED), staleWorking)).toEqual(waveOne);
    // CONTROL: the same marker and hook under a busy word is frozen
    expect(vw(under('busy', W2_LIVE), staleWorking)).toEqual(frozenV(NOW - 2 * H));
  });

  it('8: a turn marker with no turnAt keys frozen on its own `at`', () => {
    const noTurnAt = { mark: markOf({ ...FROZEN_OVER, turnAt: null }) };
    expect(fv(hookAt(NOW - 61 * MIN), {}, noTurnAt)).toEqual(frozenV(NOW - 2 * H));
    const done = [notice('live', 'frozen', 1, NOW - 2 * H, NOW - 50 * MIN)];
    expect(fv(hookAt(NOW - 61 * MIN), { notices: done }, noTurnAt)).toEqual(hold('busy'));
  });

  it('9: a working marker never holds delegates, even with a fresh hook inside the cap: it holds busy', () => {
    const working = markOf({ state: 'working', event: 'UserPromptSubmit', at: NOW - 2 * H, turnAt: NOW - 2 * H, stopAt: NOW - 3 * H });
    expect(vw({ arming: W2_LIVE }, { mark: working, hook: hookAt(NOW - 5 * MIN) })).toEqual(hold('busy'));
    // CONTROL: the same hook over a done marker holds delegates
    expect(vw({ arming: W2_LIVE }, { mark: markOf(), hook: hookAt(NOW - 5 * MIN) })).toEqual(hold('delegates'));
  });
});

describe('wave 2: coord-deaf reads the worker\'s own ball-passing mail, by its newest delivery row', () => {
  const cv = (mail: StallMailRow[], deliveries: StallDeliveryRow[]): StallVerdict => vw({ arming: W2_LIVE, mail }, { deliveries });
  const ago = (ms: number): number => NOW - ms;

  it('another session\'s unacked question to the coordinator is not the worker\'s: not coord-deaf', () => {
    // The ball is with the coordinator by its own `wait:`, so the only question to it that stands unacked is a peer's.
    const wait = mailRow(4390, ago(2 * H), COORD, WORKER, 'status', `${STALL_WAIT_PREFIX} the review`);
    const peerQ = mailRow(4401, Q_AT, PEER, 'coordinator', 'question', 'which base?');
    const peerD = delivery(9201, 4401, COORD, { state: 'delivered', deliveredAt: Q_AT + MIN });
    expect(cv([wait, peerQ], [peerD])).toEqual(NONE);
    // ... and a peer's newer question does not displace the worker's own, acked one
    const own = mailRow(4400, ago(3 * H), WORKER, 'coordinator', 'question', 'which base?');
    const ownD = delivery(9202, 4400, COORD, { state: 'acked', deliveredAt: ago(3 * H) + MIN, ackedAt: ago(3 * H) + 2 * MIN });
    expect(cv([own, peerQ], [ownD, peerD])).toEqual(NONE);
    // CONTROL: the worker's own question, unacked, is deaf
    expect(cv([own], [{ ...ownD, state: 'delivered', ackedAt: null }])).toEqual(w2Push('coord-deaf', 4400));
  });

  const older = (over: Partial<StallDeliveryRow>): StallDeliveryRow => delivery(9101, 4001, COORD, { deliveredAt: Q_AT + MIN, ...over });
  const newer = (over: Partial<StallDeliveryRow>): StallDeliveryRow => delivery(9102, 4001, COORD, { deliveredAt: Q_AT + 3 * MIN, ...over });

  it('the newest delivery row judges the mail, in either row order: older unacked, newer acked is not deaf', () => {
    const rows = [older({ state: 'delivered' }), newer({ state: 'acked', ackedAt: Q_AT + 4 * MIN })];
    expect(cv([Q], rows)).toEqual(NONE);
    expect(cv([Q], [...rows].reverse())).toEqual(NONE);
  });

  it('the newest delivery row judges the mail, in either row order: older acked, newer unacked past the limit is deaf', () => {
    const rows = [older({ state: 'acked', ackedAt: Q_AT + 2 * MIN }), newer({ state: 'delivered' })];
    expect(cv([Q], rows)).toEqual(w2Push('coord-deaf', 4001));
    expect(cv([Q], [...rows].reverse())).toEqual(w2Push('coord-deaf', 4001));
  });
});

describe('stallNewestDelivery', () => {
  it('answers the delivery row with the greatest id for the mail, in any row order, and null for a mail with none', () => {
    const rows = [delivery(9101, 4001, COORD), delivery(9103, 4002, COORD), delivery(9102, 4001, COORD)];
    expect(stallNewestDelivery(rows, 4001)?.id).toBe(9102);
    expect(stallNewestDelivery([...rows].reverse(), 4001)?.id).toBe(9102);
    expect(stallNewestDelivery(rows, 4002)?.id).toBe(9103);
    expect(stallNewestDelivery(rows, 4999)).toBeNull();
    expect(stallNewestDelivery([], 4001)).toBeNull();
  });
});
