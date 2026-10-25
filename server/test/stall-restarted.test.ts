// D-6853 (coordinator-durability D5, #759): the `restarted` arm. A run worker whose pane was respawned
// over background tasks that did not survive is told at once (rung 1, to the worker), and its coordinator hears a
// heads-up (rung 2), at most one per worker on its run per RESTARTED_HEADS_UP_MS. Wave 2: shadow until `stall-watch-w2-live`.
// Every clock is an argument; every expected subject is computed by the builders, never a literal, except the
// prefix, which is spelled once here to pin it.
import { describe, it, expect } from 'vitest';
import {
  stallRestartedVerdict, stallRestartedVerdicts, stallOrphanDVerdict, stallSessionMail, stallMailClass, stallNotifyDelivery, rungRecipient,
  stallArmHasRung, stallDetail, parseStallDetail, stallRestartedSubject,
  RESTARTED_HEADS_UP_MS, STALL_RESTARTED_PREFIX, ORPHAN_D_IDLE_MS, BACKLOG_HORIZON_MS,
} from '../src/coord/stall.js';
import type {
  StallArm, StallArming, StallMode, StallNotice, StallRunRow, StallSessionInput, StallSessionRole, StallVerdict,
  StallWorker, TurnMark, TurnMarkRead,
} from '../src/coord/stall.js';

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const R = NOW - 2 * MIN;
const WORKER = 'demo-worker';
const COORD = 'demo-calm-mesa';
const W2: StallArming = { disabled: false, live: true, escalate: true, w2Live: true };
const DARK: StallArming = { disabled: false, live: true, escalate: true };
const NONE: StallVerdict = { act: 'none' };

function runRow(over: Partial<StallRunRow> = {}): StallRunRow {
  return {
    id: 67, kind: 'work', state: 'working', sessionId: WORKER, claimedBy: COORD, dispatchedAt: NOW - 30 * H,
    program: 'demo-program', wave: 2, waveOf: 3, project: 'demo', workspace: 'demo-ws', ...over,
  };
}
function workerAt(word: string, since: number): Extract<StallWorker, { present: true }> {
  return {
    present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 }, dialogPending: false,
    stranded: false, swapBlocked: false, live: { ok: true, word, since }, hookAsk: { kind: 'none' },
    askRow: { kind: 'none' }, autoContinueHeldAt: null,
  };
}
function mark(restartAt: number, over: Partial<TurnMark> = {}): TurnMarkRead {
  const stopAt = restartAt - H;
  return {
    ok: true, crons: null, sessionId: 'uuid-1', state: 'done', event: 'SessionStart', at: restartAt, turnAt: stopAt - 20 * MIN,
    stopAt, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt, lostBg: 2, lostKinds: ['shell', 'subagent'],
    lostIds: ['b989ocn62', 'a7c1d2e3'], graceUntil: null, ...over,
  };
}
function notice(mode: StallMode, arm: StallArm, rung: 1 | 2 | 3, key: number, at: number): StallNotice {
  return { mode, arm, rung, key, at };
}
interface Over {
  role?: StallSessionRole; run?: StallRunRow | null; worker?: StallWorker; mark?: TurnMarkRead; liveStartedAt?: number | null;
  notices?: readonly StallNotice[]; arming?: StallArming; coordinationPaused?: boolean;
}
/** A run worker resumed at `restartAt`, idle since a minute after it; the live process started 5 s before. */
function input(restartAt = R, over: Over = {}): StallSessionInput {
  const role = over.role ?? 'worker';
  return {
    sessionId: WORKER, role, run: over.run !== undefined ? over.run : role === 'worker' ? runRow() : null,
    worker: over.worker ?? workerAt('idle', restartAt + MIN), mark: over.mark ?? mark(restartAt),
    liveStartedAt: over.liveStartedAt !== undefined ? over.liveStartedAt : restartAt - 5_000, markUnreadableSince: null,
    mail: [], deliveries: [], notices: over.notices ?? [], arming: over.arming ?? W2,
    coordinationPaused: over.coordinationPaused ?? false,
  };
}
const r1 = (key = R): StallVerdict => ({ act: 'notify', arm: 'restarted', rung: 1, key, to: 'worker' });
const r2 = (key = R): StallVerdict => ({ act: 'notify', arm: 'restarted', rung: 2, key, to: 'coordinator', coordinatorId: COORD });

describe('restarted: the vocabulary', () => {
  it('is a wave-2 arm with a worker rung then a coordinator rung, and never an operator one', () => {
    expect(rungRecipient('restarted', 1)).toBe('worker');
    expect(rungRecipient('restarted', 2)).toBe('coordinator');
    expect(stallArmHasRung('restarted', 3)).toBe(false);
    expect(stallNotifyDelivery('restarted', 'worker', DARK)).toBe('shadow');
    expect(stallNotifyDelivery('restarted', 'worker', W2)).toBe('send');
    expect(stallNotifyDelivery('restarted', 'coordinator', W2)).toBe('send');
    expect(stallNotifyDelivery('restarted', 'coordinator', { ...W2, escalate: false })).toBe('shadow');
  });
  it('its observation detail reads back', () => {
    expect(parseStallDetail(stallDetail('shadow', 'restarted', 2, R))).toEqual({ mode: 'shadow', arm: 'restarted', rung: 2, key: R });
  });
  it('the prefix is a self-wake class: recorded on the phone, never pushed, and never mail on the run', () => {
    expect(STALL_RESTARTED_PREFIX).toBe('restarted:');
    const subject = stallRestartedSubject(R);
    expect(subject.startsWith(STALL_RESTARTED_PREFIX)).toBe(true);
    expect(stallMailClass({ fromId: 'operator', runId: null, subject, mailId: 1 })).toBe('self-wake');
    expect(stallMailClass({ fromId: WORKER, runId: null, subject, mailId: 1 })).toBeNull();
  });
});

describe('restarted rung 1: the worker is told at once', () => {
  it('fires for a run worker whose restart cut background tasks short, without waiting out ORPHAN_D_IDLE_MS', () => {
    expect(stallRestartedVerdict(input(), NOW)).toEqual(r1());
    expect(NOW - (R + MIN)).toBeLessThan(ORPHAN_D_IDLE_MS);
    expect(stallOrphanDVerdict(input(), NOW), 'orphan D is still waiting').toEqual(NONE);
  });
  it('each conjunct, negated, is none', () => {
    const cases: [string, StallSessionInput][] = [
      ['nothing lost', input(R, { mark: mark(R, { lostBg: 0, lostKinds: [], lostIds: [] }) })],
      ['no restart', input(R, { mark: mark(R, { restartAt: null }) })],
      ['a working mark', input(R, { mark: mark(R, { state: 'working' }) })],
      ['a restart before the stop', input(R, { mark: mark(R, { stopAt: R + MIN }) })],
      ['a mark older than the live process', input(R, { liveStartedAt: NOW })],
      ['a coordinator', input(R, { role: 'coordinator' })],
      ['a registry row on no run', input(R, { role: 'other' })],
      ['a worker with no run', input(R, { run: null })],
      ['a restart past the backlog horizon', input(NOW - BACKLOG_HORIZON_MS - MIN)],
      ['a refused marker', input(R, { mark: { ok: false, reason: 'malformed' } })],
    ];
    for (const [name, i] of cases) expect(stallRestartedVerdict(i, NOW), name).toEqual(NONE);
  });
  it('holds as the other session arms do: an absent pane, a dialog', () => {
    expect(stallRestartedVerdict(input(R, { worker: { present: false } }), NOW)).toEqual({ act: 'hold', why: 'absent' });
    expect(stallRestartedVerdict(input(R, { worker: { ...workerAt('idle', R + MIN), dialogPending: true } }), NOW)).toEqual({ act: 'hold', why: 'dialog' });
  });
  it('mail-disabled holds every rung that would send mail', () => {
    const v = stallRestartedVerdict(input(R, { arming: { ...W2, mailDisabled: true } }), NOW);
    expect(v.act).toBe('hold');
  });
  it('a live row makes the rung done; a shadow row stands while dark and is sent once armed', () => {
    expect(stallRestartedVerdict(input(R, { notices: [notice('live', 'restarted', 1, R, R + MIN)] }), NOW)).toEqual(r2());
    const shadow = [notice('shadow', 'restarted', 1, R, R + MIN)];
    expect(stallRestartedVerdict(input(R, { arming: DARK, notices: shadow }), NOW)).toEqual(r2());
    expect(stallRestartedVerdict(input(R, { notices: shadow }), NOW)).toEqual(r1());
  });
});

describe('restarted rung 2: the coordinator hears once, and at most once per worker per RESTARTED_HEADS_UP_MS', () => {
  const told = [notice('live', 'restarted', 1, R, R + MIN)];
  it('is 10 minutes', () => {
    expect(RESTARTED_HEADS_UP_MS).toBe(10 * MIN);
  });
  it('goes to the run\'s claimant, keyed on the restart', () => {
    expect(stallRestartedVerdict(input(R, { notices: told }), NOW)).toEqual(r2());
  });
  it('a done rung 2 is none', () => {
    expect(stallRestartedVerdict(input(R, { notices: [...told, notice('live', 'restarted', 2, R, R + MIN)] }), NOW)).toEqual(NONE);
  });
  it('a restart within the window of an earlier heads-up is not told again, however much later it is judged', () => {
    const earlier = (gap: number): StallNotice[] => [notice('live', 'restarted', 2, R - gap, R - gap + MIN), ...told];
    expect(stallRestartedVerdict(input(R, { notices: earlier(5 * MIN) }), NOW), 'five minutes after').toEqual(NONE);
    expect(stallRestartedVerdict(input(R, { notices: earlier(5 * MIN) }), NOW + 3 * H), 'judged hours later').toEqual(NONE);
    expect(stallRestartedVerdict(input(R, { notices: earlier(RESTARTED_HEADS_UP_MS - 1) }), NOW), 'one ms inside').toEqual(NONE);
    expect(stallRestartedVerdict(input(R, { notices: earlier(RESTARTED_HEADS_UP_MS) }), NOW), 'exactly the window').toEqual(r2());
    expect(stallRestartedVerdict(input(R, { notices: earlier(11 * MIN) }), NOW), 'eleven minutes after').toEqual(r2());
  });
  it('a shadow heads-up spends the window too, so arming mid-episode does not double it', () => {
    const shadowEarlier = [notice('shadow', 'restarted', 2, R - 5 * MIN, R - 4 * MIN), ...told];
    expect(stallRestartedVerdict(input(R, { notices: shadowEarlier }), NOW)).toEqual(NONE);
  });
  it('no claimant, or a paused coordination, is none: a heads-up never becomes an operator push', () => {
    expect(stallRestartedVerdict(input(R, { run: runRow({ claimedBy: null }), notices: told }), NOW)).toEqual(NONE);
    expect(stallRestartedVerdict(input(R, { coordinationPaused: true, notices: told }), NOW)).toEqual(NONE);
  });
});

describe('orphan D is left as it was: the safety net behind rung 1', () => {
  const idle = (over: Over = {}): StallSessionInput => input(R, { worker: workerAt('idle', NOW - ORPHAN_D_IDLE_MS), ...over });
  const d1: StallVerdict = { act: 'notify', arm: 'orphan-d', rung: 1, key: R, to: 'worker' };
  it('still fires for a worker that sat idle past ORPHAN_D_IDLE_MS after being told', () => {
    expect(stallOrphanDVerdict(idle({ notices: [notice('live', 'restarted', 1, R, R + MIN)] }), NOW)).toEqual(d1);
    expect(stallOrphanDVerdict(idle(), NOW)).toEqual(d1);
  });
  it('a worker that took a turn after the notice is no candidate for either arm', () => {
    const working = input(R, { mark: mark(R, { state: 'working' }), notices: [notice('live', 'restarted', 1, R, R + MIN)] });
    expect(stallOrphanDVerdict(working, NOW)).toEqual(NONE);
    expect(stallRestartedVerdict(working, NOW)).toEqual(NONE);
  });
});

describe('restarted: both rungs of one sweep come from one marker read', () => {
  it('returns rung 1 and rung 2 together while rung 1 is not yet recorded', () => {
    expect(stallRestartedVerdicts(input(), NOW)).toEqual([r1(), r2()]);
  });
  it('returns rung 2 alone once rung 1 is recorded', () => {
    expect(stallRestartedVerdicts(input(R, { notices: [notice('live', 'restarted', 1, R, R + MIN)] }), NOW)).toEqual([r2()]);
  });
  it('returns rung 1 alone when the run has no claimant, and holds like the single verdict', () => {
    const noClaim = input(R, { coordinationPaused: true });
    expect(stallRestartedVerdicts(noClaim, NOW)).toEqual([r1()]);
    expect(stallRestartedVerdicts(input(R, { worker: { present: false } }), NOW)).toEqual([{ act: 'hold', why: 'absent' }]);
  });
});

describe('restarted: the mails', () => {
  const sess = (): StallSessionInput => input();
  it('rung 1 tells the worker when it restarted, what did not survive, and to re-check and relaunch', () => {
    const text = stallSessionMail(sess(), r1() as Extract<StallVerdict, { act: 'notify' }>, NOW);
    expect(text.subject).toBe(stallRestartedSubject(R));
    expect(text.subject.startsWith(STALL_RESTARTED_PREFIX)).toBe(true);
    expect(text.body).toContain('2026-10-24T11:58:00Z');
    expect(text.body).toContain('2 background task(s) were running (shell, subagent)');
    expect(text.body).toContain('b989ocn62');
    expect(text.body).toMatch(/Re-check/);
    expect(text.body).toMatch(/relaunch/);
    expect(text.body).toContain('run 67');
  });
  it('rung 2 tells the coordinator which run and which worker, and that nothing was restarted by this notice', () => {
    const text = stallSessionMail(sess(), r2() as Extract<StallVerdict, { act: 'notify' }>, NOW);
    expect(text.subject.startsWith(STALL_RESTARTED_PREFIX)).toBe(true);
    expect(text.subject).toContain('run 67');
    expect(text.subject).toContain(WORKER);
    expect(text.body).toContain(WORKER);
    expect(text.body).toContain('demo-ws');
    expect(text.body).toContain('2 background task(s)');
    expect(text.body).toMatch(/restart nothing|restarts nothing|did not restart/);
    // The window reads the worker's primary run's rows only, so the body says it is per worker on its run.
    expect(text.body).toContain('at most one of these per worker on its run per 0h 10m');
    expect(stallMailClass({ fromId: 'operator', runId: 67, subject: text.subject, mailId: 2 })).toBe('self-wake');
  });
  it('the two subjects differ, so neither reads as the other', () => {
    const a = stallSessionMail(sess(), r1() as Extract<StallVerdict, { act: 'notify' }>, NOW).subject;
    const b = stallSessionMail(sess(), r2() as Extract<StallVerdict, { act: 'notify' }>, NOW).subject;
    expect(a).not.toBe(b);
  });
});
