// D-8610, the characterization commit: what each reader that still compared the live file's raw status word makes of
// every word, before it reads the word through `turnWordOf` (the one reading, ARCH-50). Green on the old code; the move
// commit changes none of it. The words are `turn-words-characterization.test.ts`'s: the three Claude Code writes (`idle`,
// `busy`, `shell`) and four it does not (`waiting`, a word this build has never seen, an empty string, and `Idle`).
// The readers: the interrupt door's verdict, the idle-compact nudge, and the stall lane's six (the coordinator's gate and
// its busy clock, orphan E, mail-stuck's idle start, the run verdict's frozen rung and wave 1's ladder). The interrupt
// route's own read of the word is pinned per word in `interrupt-route.test.ts`.
import { describe, it, expect } from 'vitest';
import { interruptVerdict, type InterruptReading } from '../src/inject/send.js';
import { decideIdleCompactNudge, readCompactionTail, type IdleNudgeFacts } from '../src/idlenudge.js';
import { IDLE_TAIL, T_NOTICE, jsonl } from './idleNudgeFixtures.js';
import {
  stallCoordBusySince, stallCoordGate, stallMailStuckVerdicts, stallOrphanEVerdict, stallVerdict,
} from '../src/coord/stall.js';
import type {
  HookRawFact, StallArming, StallDeliveryRow, StallInput, StallMailRow, StallRunRow, StallSessionInput, StallVerdict,
  StallW2Facts, StallWorker, TurnMark, TurnMarkRead,
} from '../src/coord/stall.js';

const WORDS = ['idle', 'busy', 'shell', 'waiting', 'compacting', '', 'Idle'] as const;
const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-09-30T12:00:00Z');
const WORKER = 'demo-worker';
const COORD = 'demo-calm-mesa';

/** A verdict as one short word: the act and its arm or reason. */
const said = (v: StallVerdict): string =>
  v.act === 'hold' ? `hold:${v.why}` : v.act === 'notify' ? `notify:${v.arm}:${v.rung}` : v.act;

describe('interruptVerdict, per word', () => {
  const T0 = NOW - 2 * MIN;
  const T1 = NOW - MIN;
  const reading = (word: string, over: Partial<InterruptReading> = {}): InterruptReading => ({
    word: { ok: true, word, since: T0 }, row: { dialogPending: false, hookState: 'done', background: { count: 2, kinds: ['workflow'] } },
    hookUpdatedAt: T1, hookEvent: 'Stop', ...over,
  });
  const kind = (r: InterruptReading): string => interruptVerdict(r).kind;

  it('a main Stop newer than the word over delegated work: idle is idle, busy and shell are background-only, every other word a turn', () => {
    expect(WORDS.map((w) => kind(reading(w)))).toEqual(['idle', 'background-only', 'background-only', 'turn', 'turn', 'turn', 'turn']);
  });
  it('a row that could not be assembled: idle is idle, every other word a turn', () => {
    expect(WORDS.map((w) => kind(reading(w, { row: null })))).toEqual(['idle', 'turn', 'turn', 'turn', 'turn', 'turn', 'turn']);
  });
  it('a pane menu pending: idle is idle, every other word a turn', () => {
    const row = { dialogPending: true, hookState: 'done' as const, background: { count: 2, kinds: ['workflow'] } };
    expect(WORDS.map((w) => kind(reading(w, { row })))).toEqual(['idle', 'turn', 'turn', 'turn', 'turn', 'turn', 'turn']);
  });
  it('a working hook state: idle is idle, shell is background-only, every other word a turn', () => {
    const row = { dialogPending: false, hookState: 'working' as const, background: { count: 2, kinds: ['workflow'] } };
    expect(WORDS.map((w) => kind(reading(w, { row })))).toEqual(['idle', 'turn', 'background-only', 'turn', 'turn', 'turn', 'turn']);
  });
  it('an unread word is idle', () => {
    expect(kind(reading('busy', { word: { ok: false } }))).toBe('idle');
  });
});

describe('decideIdleCompactNudge, per word', () => {
  const at = T_NOTICE + 40_000;
  const facts = (word: string): IdleNudgeFacts => ({
    disabled: false, durable: true, unmeasured: false, lifecycle: 'running', archived: false, status: 'idle',
    dialogPending: false, askSummary: null, ask: null, now: at,
    live: { ok: true, word, since: T_NOTICE },
    mark: { ok: true, state: 'done', bg: 0 },
    tasks: { ok: true, open: 2, touchedAt: at - 10 * MIN },
    compaction: readCompactionTail(jsonl(IDLE_TAIL)),
    alreadyNudged: () => false,
  });
  const v = (word: string): string => { const r = decideIdleCompactNudge(facts(word)); return r.act === 'hold' ? r.reason : r.act; };

  it('only an exact idle nudges; every other word, shell included, holds not-idle', () => {
    expect(WORDS.map(v)).toEqual(['nudge', 'not-idle', 'not-idle', 'not-idle', 'not-idle', 'not-idle', 'not-idle']);
  });
});

// ── the stall lane ────────────────────────────────────────────────────────────────────────────────────────────────
type PresentWorker = Extract<StallWorker, { present: true }>;
const W2: StallArming = { disabled: false, live: true, escalate: true, w2Live: true };
const DARK: StallArming = { disabled: false, live: true, escalate: true };

function runRow(over: Partial<StallRunRow> = {}): StallRunRow {
  return {
    id: 67, kind: 'work', state: 'working', sessionId: WORKER, claimedBy: COORD, dispatchedAt: NOW - 30 * H,
    program: 'demo-program', wave: 2, waveOf: 3, project: 'demo', workspace: 'demo-ws', ...over,
  };
}
function workerAt(word: string, since: number | null, over: Partial<PresentWorker> = {}): PresentWorker {
  return {
    present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 },
    dialogPending: false, stranded: false, swapBlocked: false, live: { ok: true, word, since },
    hookAsk: { kind: 'none' }, askRow: { kind: 'none' }, autoContinueHeldAt: null, ...over,
  };
}
const MARK_BASE: TurnMark = {
  crons: null, sessionId: 'uuid-1', state: 'done', event: 'Stop', at: NOW - 3 * H, turnAt: NOW - 3 * H - 20 * MIN,
  stopAt: NOW - 3 * H, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [],
  lostIds: [], graceUntil: null,
};
const mark = (over: Partial<TurnMark> = {}): TurnMarkRead => ({ ok: true, ...MARK_BASE, ...over });
const mailRow = (id: number, at: number, fromId: string, toId: string, subject: string, runId: number | null = null): StallMailRow =>
  ({ id, at, runId, fromId, toId, kind: 'status', subject });
const delivery = (id: number, mailId: number, over: Partial<StallDeliveryRow> = {}): StallDeliveryRow =>
  ({ id, mailId, toId: WORKER, state: 'queued', deliveredAt: null, ackedAt: null, lastGate: null, gateSince: null, replayCount: 0, ...over });

function sessionInput(over: Partial<StallSessionInput> = {}): StallSessionInput {
  return {
    sessionId: WORKER, role: 'worker', run: runRow(), worker: workerAt('idle', NOW - 3 * H), mark: mark(),
    liveStartedAt: NOW - 30 * H, markUnreadableSince: null, mail: [], deliveries: [], notices: [], arming: W2,
    coordinationPaused: false, ...over,
  };
}

describe('stallCoordGate and stallCoordBusySince, per word', () => {
  const since = NOW - 20 * MIN;
  const coord = (word: string, m: TurnMarkRead): StallSessionInput =>
    sessionInput({ sessionId: COORD, role: 'coordinator', run: null, worker: workerAt(word, since), mark: m });
  const working = mark({ state: 'working', event: 'PreToolUse', at: NOW - 30 * MIN, turnAt: NOW - 30 * MIN, stopAt: null });

  it('the gate over a finished turn: idle and shell rest, busy is background, waiting waits, any other word is null', () => {
    expect(WORDS.map((w) => stallCoordGate(coord(w, mark())))).toEqual(['idle', 'background', 'idle', 'waiting', null, null, null]);
  });
  it('the gate over a working turn: busy is the coordinator\'s own', () => {
    expect(WORDS.map((w) => stallCoordGate(coord(w, working)))).toEqual(['idle', 'busy', 'idle', 'waiting', null, null, null]);
  });
  it('the gate over no current marker: busy is busy-unread', () => {
    expect(WORDS.map((w) => stallCoordGate(coord(w, { ok: false, reason: 'absent' }))))
      .toEqual(['idle', 'busy-unread', 'idle', 'waiting', null, null, null]);
  });
  it('the busy clock: busy and waiting time a stretch (from the working turn when one runs), every other word is null', () => {
    expect(WORDS.map((w) => stallCoordBusySince(coord(w, mark())))).toEqual([null, since, null, since, null, null, null]);
    expect(WORDS.map((w) => stallCoordBusySince(coord(w, working)))).toEqual([null, NOW - 30 * MIN, null, NOW - 30 * MIN, null, null, null]);
  });
});

describe('stallOrphanEVerdict, per word', () => {
  const S = NOW - 30 * MIN;
  const e = (word: string): StallSessionInput => sessionInput({
    worker: workerAt(word, S + 2_000),
    mark: mark({ at: S, turnAt: S - 20 * MIN, stopAt: S, bg: 2, bgKinds: ['monitor', 'subagent'], bgIds: ['m0', 'm1'] }),
  });

  it('only an exact idle fires rung 1; shell and every other word are none', () => {
    expect(WORDS.map((w) => said(stallOrphanEVerdict(e(w), NOW)))).toEqual(['notify:orphan-e:1', 'none', 'none', 'none', 'none', 'none', 'none']);
  });
});

describe('stallMailStuckVerdicts (the idle start), per word', () => {
  const M_AT = NOW - 3 * H;
  const stuck = (word: string, arming: StallArming, since = NOW - 2 * H): StallSessionInput => sessionInput({
    worker: workerAt(word, since),
    mark: mark({ at: NOW - 2 * H, turnAt: NOW - 2 * H - 10 * MIN, stopAt: NOW - 2 * H }),
    mail: [mailRow(501, M_AT, COORD, WORKER, 'brief', 67)],
    deliveries: [delivery(901, 501, { lastGate: 'not-idle', gateSince: M_AT })],
    arming,
  });
  const v = (word: string, arming: StallArming, since?: number): string[] => stallMailStuckVerdicts(stuck(word, arming, since), NOW).map(said);

  // A dialog is one of the gates mail-stuck reports past, so `waiting` reads on to the idle clause like any other word.
  it('the default mode: idle and shell time from the word, busy from the stop plus the delegate cap, any other word from the stop', () => {
    expect(WORDS.map((w) => v(w, W2))).toEqual([
      ['notify:mail-stuck:1'], ['none'], ['notify:mail-stuck:1'], ['notify:mail-stuck:1'], ['notify:mail-stuck:1'],
      ['notify:mail-stuck:1'], ['notify:mail-stuck:1'],
    ]);
  });
  it('the busy mode: busy times from the stop, as every other non-idle word does', () => {
    expect(WORDS.map((w) => v(w, { ...W2, mailMode: 'busy' }))).toEqual([
      ['notify:mail-stuck:1'], ['notify:mail-stuck:1'], ['notify:mail-stuck:1'], ['notify:mail-stuck:1'], ['notify:mail-stuck:1'],
      ['notify:mail-stuck:1'], ['notify:mail-stuck:1'],
    ]);
  });
  it('a word too recent to time: idle and shell wait on it, every other word reads the stop', () => {
    expect(WORDS.map((w) => v(w, W2, NOW - 10 * MIN))).toEqual([
      ['none'], ['none'], ['none'], ['notify:mail-stuck:1'], ['notify:mail-stuck:1'], ['notify:mail-stuck:1'], ['notify:mail-stuck:1'],
    ]);
  });
});

describe('stallVerdict (the run verdict), per word', () => {
  const DISPATCHED = NOW - 30 * H;
  const runInput = (worker: StallWorker, arming: StallArming = DARK, w2?: StallW2Facts): StallInput => {
    const primary = runRow({ dispatchedAt: DISPATCHED });
    return {
      subject: { primary, runs: [primary] }, worker, mail: [], notices: [], arming, coordinationPaused: false,
      coordinator: null, activation: { kind: 'none' }, ...(w2 !== undefined ? { w2 } : {}),
    };
  };
  const HOOK_ABSENT: HookRawFact = { ok: false, reason: 'absent' };
  const w2 = (m: TurnMarkRead, hook: HookRawFact = HOOK_ABSENT): StallW2Facts =>
    ({ mark: m, hook, deliveries: [], absentSince: null, deadSince: null, markUnreadableSince: null });
  const v = (input: StallInput): string => said(stallVerdict(input, NOW));

  it('wave 1\'s ladder, quiet 3 h: idle and shell fire r1, busy holds busy, waiting is a dialog past its cap, every other word is unmeasured', () => {
    expect(WORDS.map((w) => v(runInput(workerAt(w, NOW - 3 * H)))))
      .toEqual(['notify:quiet:1', 'hold:busy', 'notify:quiet:1', 'notify:dialog-cap:1', 'hold:unmeasured', 'hold:unmeasured', 'hold:unmeasured']);
  });
  it('wave 2 live, a current done marker 3 h old: the marker clock fires r1 at rest and under busy, waiting is a dialog past its cap, doubt is unmeasured', () => {
    expect(WORDS.map((w) => v(runInput(workerAt(w, NOW - 3 * H), W2, w2(mark())))))
      .toEqual(['notify:quiet:1', 'notify:quiet:1', 'notify:quiet:1', 'notify:dialog-cap:1', 'hold:unmeasured', 'hold:unmeasured', 'hold:unmeasured']);
  });
  it('wave 2 live, a working marker 2 h old with no hook event for an hour: frozen fires under busy alone', () => {
    const frozen = mark({ state: 'working', event: 'PostToolUse', at: NOW - 2 * H, turnAt: NOW - 2 * H, stopAt: NOW - 5 * H });
    const hook: HookRawFact = { ok: true, updatedAt: NOW - H, event: 'PostToolUse', sessionId: 'uuid-1', identity: 'current' };
    expect(WORDS.map((w) => v(runInput(workerAt(w, NOW - 2 * H), W2, w2(frozen, hook)))))
      .toEqual(['hold:busy', 'notify:frozen:1', 'hold:busy', 'notify:dialog-cap:1', 'hold:busy', 'hold:busy', 'hold:busy']);
  });
});
