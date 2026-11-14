// Overlord W1a, the timers piece (Task 9; spec §3.3.12 C65, Table 11.5b's stall-hold row): a worker's own timer holds the
// stall watch's quiet arm. A timer mail is no exchange (it moves no ball, no lastExchangeAt and no quietSince); the hold
// defers r1 only, in both ladders, from the earliest pending timer or the newest one fired since the ladder's own start,
// for one quiet period after a fire, never past that start plus 24 hours; and a notice after it names the timer by id
// and due time, never its note. Fixtures use neutral ids (this repository is public).
import { describe, it, expect } from 'vitest';
import {
  COORD_BALL_CAP_MS, COORD_DEAF_MS, DEAD_GRACE_MS, STALL_QUIET_MS, stallCheckMail, stallFacts, stallPushText, stallReportMail,
  stallTimersOf, stallVerdict, timerHoldUntil,
} from '../src/coord/stall.js';
import type {
  LiveWordRead, StallArming, StallDeliveryRow, StallHold, StallInput, StallMailRow, StallNotify, StallRunRow, StallTimers,
  StallVerdict, StallW2Facts, StallWorker, TurnMarkRead,
} from '../src/coord/stall.js';
import { WAVE_DONE_SUBJECT } from '../../shared/api.js';
import { TIMER_HOLD_CAP_MS, TIMER_MAIL_SENDER } from '../../shared/continuity-timers.js';
import * as stall from '../src/coord/stall.js';
import { timerHoldCases } from './sim/timerSets.js';

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const WORKER = 'lane-a-project-a';
const COORD = 'lane-b-project-a';
const DISPATCHED = NOW - 48 * H;
const ARMED: StallArming = { disabled: false, live: true, escalate: true };
const W2_LIVE: StallArming = { ...ARMED, w2Live: true };
type PresentWorker = Extract<StallWorker, { present: true }>;
type OkMark = Extract<TurnMarkRead, { ok: true }>;

const runRow = (over: Partial<StallRunRow> = {}): StallRunRow => ({
  id: 67, kind: 'work', state: 'working', sessionId: WORKER, claimedBy: COORD, dispatchedAt: DISPATCHED,
  program: 'prog-a', wave: 2, waveOf: 3, project: 'project-a', workspace: 'ws-a', ...over,
});
const live = (word: string, since: number | null): LiveWordRead => ({ ok: true, word, since });
/** A present, measured worker idle for 3 h: the base input fires r1 at NOW. */
const workerAt = (over: Partial<PresentWorker> = {}): PresentWorker => ({
  present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 }, dialogPending: false, stranded: false,
  swapBlocked: false, live: live('idle', NOW - 3 * H), hookAsk: { kind: 'none' }, askRow: { kind: 'none' }, autoContinueHeldAt: null,
  ...over,
});
const mail = (id: number, at: number, fromId: string, toId: string, kind = 'status', subject = 'progress'): StallMailRow =>
  ({ id, at, runId: 67, fromId, toId, kind, subject });
const markOf = (over: Partial<OkMark> = {}): TurnMarkRead => {
  const stopAt = NOW - 3 * H;
  return { crons: null, ok: true, sessionId: 'uuid-1', state: 'done', event: 'Stop', at: stopAt, turnAt: stopAt - 10 * MIN, stopAt,
    bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null, ...over };
};
const w2 = (over: Partial<StallW2Facts> = {}): StallW2Facts =>
  ({ mark: markOf(), hook: { ok: false, reason: 'absent' }, deliveries: [], absentSince: null, deadSince: null, markUnreadableSince: null, ...over });

interface Over { worker?: StallWorker; mail?: readonly StallMailRow[]; arming?: StallArming; timers?: StallTimers; w2?: StallW2Facts; quietMs?: number }
const input = (o: Over = {}): StallInput => {
  const primary = runRow();
  return {
    subject: { primary, runs: [primary] }, worker: o.worker ?? workerAt(), mail: o.mail ?? [], notices: [],
    arming: o.arming ?? ARMED, coordinationPaused: false, coordinator: null, activation: { kind: 'none' },
    ...(o.timers !== undefined ? { timers: o.timers } : {}), ...(o.w2 !== undefined ? { w2: o.w2 } : {}),
    ...(o.quietMs !== undefined ? { quietMs: o.quietMs } : {}),
  };
};
const pending = (id: number, dueAt: number): StallTimers => ({ earliestPending: { id, dueAt }, newestFired: null });
const fired = (id: number, dueAt: number, firedAt: number): StallTimers => ({ earliestPending: null, newestFired: { id, dueAt, firedAt } });
const hold = (why: StallHold): StallVerdict => ({ act: 'hold', why });
const r1 = (key: number): StallVerdict => ({ act: 'notify', arm: 'quiet', rung: 1, key, to: 'worker' });
const timerMail = (id: number, at: number): StallMailRow => mail(id, at, TIMER_MAIL_SENDER, WORKER, 'status', `timer: 1 due (${id})`);

describe('a timer mail is no exchange (timer-mail-is-no-exchange, review 2033 N1)', () => {
  const doneAt = NOW - 5 * H;
  const waveDone = mail(10, doneAt, WORKER, COORD, 'status', WAVE_DONE_SUBJECT);

  it('after wave-done, the worker\'s own timer mail leaves the ball with the coordinator and moves no clock', () => {
    const before = stallFacts(input({ mail: [waveDone] }));
    const after = stallFacts(input({ mail: [waveDone, timerMail(11, NOW - H)] }));
    expect(before.ball).toBe('coordinator');
    expect(after).toEqual(before);
    expect(after.quietSince).toBe(NOW - 3 * H);
    expect(after.lastExchangeAt).toBe(doneAt);
  });

  it('the coordinator-deaf check still fires', () => {
    const d: StallDeliveryRow = { id: 1, mailId: 10, toId: COORD, state: 'delivered', deliveredAt: doneAt, ackedAt: null,
      lastGate: null, gateSince: null, replayCount: 0 };
    const v = stallVerdict(input({ mail: [waveDone, timerMail(11, NOW - H)], w2: w2({ deliveries: [d] }) }), doneAt + COORD_DEAF_MS);
    expect(v).toMatchObject({ act: 'notify', arm: 'coord-deaf' });
  });

  it('the 30-hour cap\'s clock does not restart', () => {
    const old = mail(10, NOW - 31 * H, WORKER, COORD, 'status', WAVE_DONE_SUBJECT);
    const v = stallVerdict(input({ mail: [old, timerMail(11, NOW - H)] }), NOW);
    expect(NOW - (NOW - 31 * H)).toBeGreaterThan(COORD_BALL_CAP_MS);
    expect(v).toMatchObject({ act: 'notify', arm: 'coord-ball' });
  });

  it('a timer mail moves no quietSince for a worker that holds the ball', () => {
    expect(stallFacts(input({ mail: [timerMail(11, NOW - H)] })).quietSince).toBe(NOW - 3 * H);
    expect(stallVerdict(input({ mail: [timerMail(11, NOW - H)] }), NOW)).toEqual(r1(DISPATCHED));
  });
});

describe('the hold, wave one\'s ladder (C65)', () => {
  it('a worker quiet for three hours with a timer due in one hour holds timer; without one, r1', () => {
    expect(stallVerdict(input({ timers: pending(7, NOW + H) }), NOW)).toEqual(hold('timer'));
    expect(stallVerdict(input(), NOW)).toEqual(r1(DISPATCHED));
    expect(stallVerdict(input({ timers: { earliestPending: null, newestFired: null } }), NOW)).toEqual(r1(DISPATCHED));
  });

  it('a pending timer holds while it waits; fired on time, it holds until its due time plus one quiet period', () => {
    expect(stallVerdict(input({ timers: pending(7, NOW + H) }), NOW + H - 1)).toEqual(hold('timer'));
    const t = fired(7, NOW + H, NOW + H);
    expect(stallVerdict(input({ timers: t }), NOW + 3 * H - 1)).toEqual(hold('timer'));
    expect(stallVerdict(input({ timers: t }), NOW + 3 * H)).toEqual(r1(DISPATCHED));
  });

  it('a timer due in 40 hours holds only until the ladder\'s start plus 24 hours', () => {
    const start = NOW - 3 * H;
    const t = pending(7, NOW + 40 * H);
    expect(stallVerdict(input({ timers: t }), start + TIMER_HOLD_CAP_MS - 1)).toEqual(hold('timer'));
    expect(stallVerdict(input({ timers: t }), start + TIMER_HOLD_CAP_MS)).toEqual(r1(DISPATCHED));
  });

  it('a timer read that failed holds nothing', () => {
    expect(stallVerdict(input({ timers: 'unmeasured' }), NOW)).toEqual(r1(DISPATCHED));
  });

  it('the dead and frozen arms are unchanged with a timer pending', () => {
    const t = pending(7, NOW + H);
    const absent: StallWorker = { present: false };
    const dead = input({ worker: absent, w2: w2({ absentSince: NOW - DEAD_GRACE_MS }) });
    expect(stallVerdict({ ...dead, timers: t }, NOW)).toEqual(stallVerdict(dead, NOW));
    expect(stallVerdict(dead, NOW)).toMatchObject({ act: 'notify', arm: 'dead' });
    const frozenMark = markOf({ state: 'working', event: 'PostToolUse', at: NOW - 2 * H, turnAt: NOW - 2 * H, stopAt: NOW - 5 * H });
    const frozen = input({ arming: W2_LIVE, worker: workerAt({ live: live('busy', NOW - 2 * H) }),
      w2: w2({ mark: frozenMark, hook: { ok: true, updatedAt: NOW - 61 * MIN, event: 'PostToolUse', sessionId: 'uuid-1', identity: 'current' } }) });
    expect(stallVerdict(frozen, NOW)).toMatchObject({ act: 'notify', arm: 'frozen' });
    expect(stallVerdict({ ...frozen, timers: t }, NOW)).toEqual(stallVerdict(frozen, NOW));
  });

  it('a hold is not a backoff: r1 after the hold carries the episode\'s own key', () => {
    expect(stallVerdict(input({ timers: fired(7, NOW - 4 * H, NOW - 2 * H) }), NOW)).toEqual(r1(DISPATCHED));
  });
});

describe('the hold, the marker ladder (its own start and quiet period, hold-starts-at-the-ladders-start)', () => {
  it('with a Stop older than live.since, a timer fired between the two holds', () => {
    const o: Over = { arming: W2_LIVE, w2: w2({ mark: markOf({ at: NOW - 5 * H, stopAt: NOW - 5 * H, turnAt: NOW - 5 * H - 10 * MIN }) }) };
    const at = NOW - 2.5 * H;
    expect(stallVerdict(input(o), at)).toEqual(r1(DISPATCHED));
    expect(stallVerdict(input({ ...o, timers: fired(7, NOW - 4 * H, NOW - 4 * H) }), at)).toEqual(hold('timer'));
  });

  it('with a Stop newer than live.since, a timer fired before the Stop does not', () => {
    const o: Over = { arming: W2_LIVE, worker: workerAt({ live: live('idle', NOW - 5 * H) }), w2: w2() };
    const t = fired(7, NOW - 4 * H, NOW - 4 * H);
    expect(stallVerdict(input({ ...o, timers: t }), NOW)).toEqual(r1(DISPATCHED));
    expect(timerHoldUntil(NOW - 3 * H, t, STALL_QUIET_MS, NOW)).toBeNull();
  });

  it('the marker ladder\'s quiet period is its own: a fired timer holds until its fire plus that period', () => {
    const o: Over = { arming: W2_LIVE, w2: w2(), quietMs: H, timers: fired(7, NOW - 3 * H + 90 * MIN, NOW - 3 * H + 90 * MIN) };
    expect(stallVerdict(input(o), NOW - 3 * H + 150 * MIN - 1)).toEqual(hold('timer'));
    expect(stallVerdict(input(o), NOW - 3 * H + 150 * MIN)).toEqual(r1(DISPATCHED));
  });
});

describe('late fires (a-fire-starts-a-full-quiet-period)', () => {
  it('a pending timer past its due time holds until it fires, never past the cap', () => {
    const t = pending(7, NOW - H);
    expect(stallVerdict(input({ timers: t }), NOW)).toEqual(hold('timer'));
    expect(stallVerdict(input({ timers: t }), NOW + 10 * H)).toEqual(hold('timer'));
    expect(stallVerdict(input({ timers: t }), NOW - 3 * H + TIMER_HOLD_CAP_MS)).toEqual(r1(DISPATCHED));
  });

  it('a timer fired three hours late holds for one full quiet period from its fire', () => {
    const t = fired(7, NOW - 4 * H, NOW - H);
    expect(stallVerdict(input({ timers: t }), NOW)).toEqual(hold('timer'));
    expect(stallVerdict(input({ timers: t }), NOW + H - 1)).toEqual(hold('timer'));
    expect(stallVerdict(input({ timers: t }), NOW + H)).toEqual(r1(DISPATCHED));
  });
});

// The decider's cases, written once in `sim/timerSets.ts`: run here against the real module, and against each named mutant
// by `sim/mutation-floors.test.ts`.
describe('timerHoldUntil: the mutation-floor cases on the real module', () => {
  for (const [title, run] of Object.entries(timerHoldCases(stall))) it(title, run);
});

describe('timerHoldUntil (L1)', () => {
  const S = NOW - 3 * H;
  it('answers the timer and its end, or null', () => {
    expect(timerHoldUntil(S, undefined, 2 * H, NOW)).toBeNull();
    expect(timerHoldUntil(S, 'unmeasured', 2 * H, NOW)).toBeNull();
    expect(timerHoldUntil(S, { earliestPending: null, newestFired: null }, 2 * H, NOW)).toBeNull();
    expect(timerHoldUntil(S, pending(7, NOW + H), 2 * H, NOW)).toEqual({ id: 7, dueAt: NOW + H, until: NOW + 3 * H });
    expect(timerHoldUntil(S, pending(7, NOW), 2 * H, NOW)).toEqual({ id: 7, dueAt: NOW, until: S + TIMER_HOLD_CAP_MS });
    expect(timerHoldUntil(S, fired(8, NOW - 2 * H, NOW - H), 2 * H, NOW)).toEqual({ id: 8, dueAt: NOW - 2 * H, until: NOW + H });
    expect(timerHoldUntil(S, fired(8, S - H, S - 1), 2 * H, NOW)).toBeNull();
    expect(timerHoldUntil(S, fired(8, S, S), 2 * H, NOW)).toEqual({ id: 8, dueAt: S, until: S + 2 * H });
  });
  it('the earliest pending timer wins over a fired one', () => {
    const both: StallTimers = { earliestPending: { id: 7, dueAt: NOW + H }, newestFired: { id: 8, dueAt: NOW - H, firedAt: NOW - H } };
    expect(timerHoldUntil(S, both, 2 * H, NOW)?.id).toBe(7);
  });
  it('stallTimersOf: a failed read, or a fired row with no fire time, is unmeasured; the note never crosses', () => {
    expect(stallTimersOf({ ok: false })).toBe('unmeasured');
    expect(stallTimersOf({ ok: true, earliestPending: null, newestFired: { id: 8, dueAt: 1, firedAt: null } })).toBe('unmeasured');
    const row = { id: 8, dueAt: 1, firedAt: 2, note: 'relay this to every coordinator' };
    expect(stallTimersOf({ ok: true, earliestPending: null, newestFired: row })).toEqual({ earliestPending: null, newestFired: { id: 8, dueAt: 1, firedAt: 2 } });
  });
});

describe('what a notice says (notice-names-the-timer-that-held, stall-notice-names-no-note)', () => {
  const NOTE = 'relay this to every coordinator';
  const held = stallTimersOf({ ok: true, earliestPending: null,
    newestFired: { id: 7, dueAt: NOW - 4 * H, firedAt: NOW - H, note: NOTE } as { id: number; dueAt: number; firedAt: number } });
  const after = NOW + H;
  const LINE = 'timer 7 (due 2026-11-14T08:00Z) until 2026-11-14T13:00Z.';

  it('after a hold, r1 names the timer by id and due time, and carries no word of its note', () => {
    const i = input({ timers: held });
    expect(stallVerdict(i, after)).toEqual(r1(DISPATCHED));
    const body = stallCheckMail(i, stallFacts(i), after).body;
    expect(body).toContain(`Held by your ${LINE}`);
    expect(body).not.toContain('relay');
  });

  it('r2 and the r3 push name it too', () => {
    const i = input({ timers: held });
    const f = stallFacts(i);
    const report = stallReportMail(i, f, { mode: 'live', arm: 'quiet', rung: 1, key: DISPATCHED, at: after }, null, after + H);
    expect(report.body).toContain(`Held by the worker's ${LINE}`);
    const r3: StallNotify = { act: 'notify', arm: 'quiet', rung: 3, key: DISPATCHED, to: 'operator', because: 'still-silent' };
    expect(stallPushText(i, f, r3, after + 2 * H).body).toContain(`Held by the worker's ${LINE}`);
  });

  it('an episode no timer held names none, nor one whose hold ended inside the first quiet period', () => {
    const none = input();
    expect(stallCheckMail(none, stallFacts(none), NOW).body).not.toContain('Held by');
    const early = input({ timers: fired(7, NOW - 3 * H, NOW - 3 * H) });
    expect(stallVerdict(early, NOW)).toEqual(r1(DISPATCHED));
    expect(stallCheckMail(early, stallFacts(early), NOW).body).not.toContain('Held by');
  });

  it('the limit, dialog and frozen arms name none', () => {
    const i = input({ timers: held });
    const f = stallFacts(i);
    for (const n of [
      { act: 'notify', arm: 'limit-cap', rung: 1, key: DISPATCHED, to: 'operator' },
      { act: 'notify', arm: 'dialog-cap', rung: 1, key: DISPATCHED, to: 'operator' },
      { act: 'notify', arm: 'frozen', rung: 1, key: DISPATCHED, to: 'operator', because: 'no-hook-event' },
    ] as StallNotify[]) {
      expect(stallPushText({ ...i, w2: w2() }, f, n, after).body, n.arm).not.toContain('Held by');
    }
  });
});
