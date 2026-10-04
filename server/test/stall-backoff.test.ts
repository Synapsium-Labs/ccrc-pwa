// Worker stall watch, wave 2, Task 17: I2, the working-reply back-off (planning departures `working-reply-backs-off` (D-3644)
// and `working-streak-counts-checks` (D-3672)). ISOLATED and DROPPABLE: this file, one contiguous block of
// `server/src/coord/stall.ts` and one token on the marker branch's r1 line are the whole of it, so reverting its one
// commit removes it. Pure: every clock is an argument, and no fixture HOME is touched.
import { describe, it, expect } from 'vitest';
import {
  stallBackoff, stallVerdict, STALL_WORKING_BACKOFF_CAP, STALL_QUIET_MS,
  STALL_CHECK_PREFIX, STALL_REPLY_PREFIX, STALL_REPLY_WAITING_PREFIX,
} from '../src/coord/stall.js';
import type {
  StallArming, StallInput, StallMailRow, StallRunRow, StallVerdict, StallW2Facts, StallWorker, TurnMarkRead,
} from '../src/coord/stall.js';

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-09-29T12:00:00Z');
const WORKER = 'demo-worker';
const COORD = 'demo-calm-mesa';
/** chosen: the run was dispatched well before any row below. */
const DISPATCHED = Date.parse('2026-09-15T12:00:00Z');

/** Wave 1's full arming: the marker rules are off, so the verdict is wave 1's. */
const ARMED: StallArming = { disabled: false, live: true, escalate: true };
/** The same with `stall-watch-w2-live`: the marker branch (§10 step 10) decides r1. */
const W2_LIVE: StallArming = { disabled: false, live: true, escalate: true, w2Live: true };

function runRow(): StallRunRow {
  return { id: 67, kind: 'work', state: 'working', sessionId: WORKER, claimedBy: COORD, dispatchedAt: DISPATCHED,
    program: 'demo-program', wave: 9, waveOf: 9, project: 'demo', workspace: 'demo-ws' };
}

/** A present, fully measured worker whose word has read idle since `since`. */
function workerIdleSince(since: number): StallWorker {
  return { present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 },
    dialogPending: false, stranded: false, swapBlocked: false, live: { ok: true, word: 'idle', since },
    hookAsk: { kind: 'none' }, askRow: { kind: 'none' }, autoContinueHeldAt: null };
}

/** A current `done` turn marker whose Stop landed at `stopAt`, with no background work and no restart. */
function doneMark(stopAt: number): TurnMarkRead {
  return { ok: true, sessionId: 'uuid-1', state: 'done', event: 'Stop', at: stopAt, turnAt: stopAt - 20 * MIN, stopAt,
    bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null };
}

/** Wave 2's facts with no hookstate, so neither the delegates hold nor the frozen clock can apply. */
function w2(mark: TurnMarkRead): StallW2Facts {
  return { mark, hook: { ok: false, reason: 'absent' }, deliveries: [], absentSince: null, deadSince: null,
    markUnreadableSince: null };
}

function input(mail: readonly StallMailRow[], over: { arming?: StallArming; w2?: StallW2Facts } = {}): StallInput {
  const primary = runRow();
  return {
    subject: { primary, runs: [primary] }, worker: workerIdleSince(NOW - 3 * H), mail, notices: [],
    arming: over.arming ?? ARMED, coordinationPaused: false, coordinator: null, activation: { kind: 'none' },
    ...(over.w2 !== undefined ? { w2: over.w2 } : {}),
  };
}

const row = (id: number, at: number, fromId: string, toId: string, subject: string, kind = 'status'): StallMailRow =>
  ({ id, at, runId: 67, fromId, toId, kind, subject });
/** r1: the watch's stall-check to the worker (or, with the last two arguments, a look-alike that is not one). */
const check = (id: number, toId = WORKER, fromId = 'operator'): StallMailRow =>
  row(id, NOW - 12 * H, fromId, toId, `${STALL_CHECK_PREFIX} run 67 — quiet 2h 0m, owed: first report`);
/** The worker's `re stall-check: working` reply, to the coordinator role. */
const working = (id: number): StallMailRow =>
  row(id, NOW - 3 * H, WORKER, 'coordinator', `${STALL_REPLY_PREFIX} working — task 3 of 7, next report 14:00Z`);
const waiting = (id: number): StallMailRow =>
  row(id, NOW - 3 * H, WORKER, 'coordinator', `${STALL_REPLY_WAITING_PREFIX} on the coordinator's answer to #7`);
const progress = (id: number): StallMailRow => row(id, NOW - 3 * H, WORKER, 'coordinator', 'progress');
const answer = (id: number): StallMailRow => row(id, NOW - 3 * H, COORD, WORKER, 'go on', 'answer');

const NONE: StallVerdict = { act: 'none' };
const r1 = (key: number): StallVerdict => ({ act: 'notify', arm: 'quiet', rung: 1, key, to: 'worker' });

describe('stallBackoff: r1\'s threshold doubles per check the worker answered only with working (I2)', () => {
  it('caps the exponent at 2 over wave 1\'s 2 h base', () => {
    expect({ STALL_WORKING_BACKOFF_CAP, base: STALL_QUIET_MS }).toEqual({ STALL_WORKING_BACKOFF_CAP: 2, base: 2 * H });
  });

  it.each([
    ['no working reply', [], 0, 2 * H],
    ['one check answered by working', [check(1), working(2)], 1, 4 * H],
    ['two checks, each answered by working', [check(1), working(2), check(3), working(4)], 2, 8 * H],
    ['three checks, each answered by working (capped)', [check(1), working(2), check(3), working(4), check(5), working(6)], 3, 8 * H],
  ] as const)('%s', (_name, mail, streak, quietMs) => {
    expect(stallBackoff(input(mail))).toEqual({ streak, quietMs });
  });

  it('two working replies to ONE check count once: the streak counts checks, not reply mails', () => {
    expect(stallBackoff(input([check(1), working(2), working(3)]))).toEqual({ streak: 1, quietMs: 4 * H });
  });

  it('any other mail from the worker resets it, newest first', () => {
    expect(stallBackoff(input([check(1), working(2), check(3), working(4), progress(5)]))).toEqual({ streak: 0, quietMs: 2 * H });
    expect(stallBackoff(input([check(1), working(2), progress(3), check(4), working(5)]))).toEqual({ streak: 1, quietMs: 4 * H });
  });

  it('a waiting reply is not a working one, and resets like any other worker mail', () => {
    expect(stallBackoff(input([check(1), working(2), check(3), waiting(4)]))).toEqual({ streak: 0, quietMs: 2 * H });
    expect(stallBackoff(input([check(1), waiting(2), check(3), working(4)]))).toEqual({ streak: 1, quietMs: 4 * H });
  });

  it('a working reply with no earlier check answers nothing', () => {
    expect(stallBackoff(input([working(1)]))).toEqual({ streak: 0, quietMs: 2 * H });
    expect(stallBackoff(input([working(1), check(2)]))).toEqual({ streak: 0, quietMs: 2 * H });
    expect(stallBackoff(input([working(1), check(2), working(3)]))).toEqual({ streak: 1, quietMs: 4 * H });
  });

  it('only the watch\'s own check TO this worker counts', () => {
    expect(stallBackoff(input([check(1, 'demo-other'), working(2)]))).toEqual({ streak: 0, quietMs: 2 * H });
    expect(stallBackoff(input([check(1, WORKER, 'demo-coordinator'), working(2)]))).toEqual({ streak: 0, quietMs: 2 * H });
  });

  it('mail TO the worker neither counts nor resets', () => {
    expect(stallBackoff(input([check(1), working(2), answer(3)]))).toEqual({ streak: 1, quietMs: 4 * H });
  });

  it('reads the rows by id, whatever order they arrive in', () => {
    expect(stallBackoff(input([working(4), check(3), working(2), check(1)]))).toEqual({ streak: 2, quietMs: 8 * H });
  });
});

describe('the back-off applies on the marker branch only (w2Live and a readable marker); wave 1 keeps 2 h', () => {
  /** Idle and stopped 3 h ago: wave 1's r1 is due at NOW. */
  const quiet3h = { w2: w2(doneMark(NOW - 3 * H)) };

  it('control: with no working reply, the marker branch sends r1 at 2 h', () => {
    expect(stallVerdict(input([check(1), progress(2)], { ...quiet3h, arming: W2_LIVE }), NOW)).toEqual(r1(NOW - 3 * H));
  });

  it('one check answered by working: 3 h of quiet is not yet due, and 4 h is', () => {
    const mail = [check(1), working(2)];
    expect(stallVerdict(input(mail, { ...quiet3h, arming: W2_LIVE }), NOW)).toEqual(NONE);
    expect(stallVerdict(input(mail, { ...quiet3h, arming: W2_LIVE }), NOW + H - 1)).toEqual(NONE);
    expect(stallVerdict(input(mail, { ...quiet3h, arming: W2_LIVE }), NOW + H)).toEqual(r1(NOW - 3 * H));
  });

  it('three checks answered by working: capped at 8 h', () => {
    const mail = [check(1), working(2), check(3), working(4), check(5), working(6)];
    expect(stallVerdict(input(mail, { ...quiet3h, arming: W2_LIVE }), NOW + 5 * H - 1)).toEqual(NONE);
    expect(stallVerdict(input(mail, { ...quiet3h, arming: W2_LIVE }), NOW + 5 * H)).toEqual(r1(NOW - 3 * H));
  });

  it('without stall-watch-w2-live the verdict is wave 1\'s: r1 at 2 h whatever the streak', () => {
    expect(stallVerdict(input([check(1), working(2)], quiet3h), NOW)).toEqual(r1(NOW - 3 * H));
  });

  it('without a marker (no wave-2 facts) the verdict is wave 1\'s too, even with w2Live', () => {
    expect(stallVerdict(input([check(1), working(2)], { arming: W2_LIVE }), NOW)).toEqual(r1(NOW - 3 * H));
  });
});
