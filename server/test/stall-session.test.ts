// Task 12 of the worker stall watch, wave 2 (spec 2026-09-29 §5.2, and §10's last sentence): the session-scoped
// verdicts. Orphan D, orphan E, failed and mail-stuck, and a coordinator's marker-unreadable, each judged beside
// `stallVerdict` and each passed through the mail-disabled filter; their shared holds; the coordinator candidates;
// and orphan D's candidate predicate on the mark alone. Every input is built by the factories below, and every
// clock is an argument. The times are chosen, not measured (the census gives none for these arms). Each threshold
// is read by its constant's name, so a boundary row is `constant ± 1 min`. No subject is compared to a literal:
// every expected subject is computed by Task 10's builders (`stallOrphanDSubject`, `stallOrphanESubject`,
// `stallFailedSubject`), which own the wording.
import { describe, it, expect } from 'vitest';
import {
  stallSessionHold, stallOrphanDVerdict, stallOrphanEVerdict, stallFailedVerdict, stallMailStuckVerdicts,
  stallSessionMarkerVerdict, stallCoordinatorSubjects, stallOrphanDCandidate, stallMailClass,
  stallOrphanDSubject, stallOrphanESubject, stallFailedSubject,
  ORPHAN_D_IDLE_MS, ORPHAN_E_IDLE_MS, FAILED_IDLE_MS, FAILED_REPEAT_MS, MAIL_STUCK_MS, BACKLOG_HORIZON_MS,
  ORPHAN_PUSH_MS, MARKER_UNREADABLE_MS, AUTO_CONTINUE_RECENT_MS, STALL_ORPHANED_PREFIX, STALL_FAILED_PREFIX,
  STOP_FAILURE_ERRORS,
} from '../src/coord/stall.js';
import type {
  StallArm, StallArming, StallDeliveryRow, StallHold, StallMailRow, StallMode, StallNotice, StallRunRow,
  StallSessionInput, StallSessionRole, StallVerdict, StallWorker, TurnMark, TurnMarkRead,
} from '../src/coord/stall.js';

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-09-30T12:00:00Z');
const WORKER = 'demo-worker';
const COORD = 'demo-calm-mesa';
/** The sender of every watch notice: the operator role. */
const WATCH = 'operator';

/** Wave 1 and wave 2 armed: a worker-bound rung sends, and so do coordinator- and operator-bound ones. */
const W2: StallArming = { disabled: false, live: true, escalate: true, w2Live: true };
/** The same, with `mail-disabled` standing. */
const W2_MAIL_OFF: StallArming = { ...W2, mailDisabled: true };
/** Wave 1 armed, wave 2 dark: every wave-2 rung is shadow (`stallNotifyDelivery`). */
const DARK: StallArming = { disabled: false, live: true, escalate: true };
const DARK_MAIL_OFF: StallArming = { ...DARK, mailDisabled: true };

type PresentWorker = Extract<StallWorker, { present: true }>;

function runRow(over: Partial<StallRunRow> = {}): StallRunRow {
  return {
    id: 67, kind: 'work', state: 'working', sessionId: WORKER, claimedBy: COORD, dispatchedAt: NOW - 30 * H,
    program: 'demo-program', wave: 2, waveOf: 3, project: 'demo', workspace: 'demo-ws', ...over,
  };
}

/** A present, fully measured, unlimited session whose live word is `word` since `since`. */
function workerAt(word: string, since: number | null, over: Partial<PresentWorker> = {}): PresentWorker {
  return {
    present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 },
    dialogPending: false, stranded: false, swapBlocked: false, live: { ok: true, word, since },
    hookAsk: { kind: 'none' }, askRow: { kind: 'none' }, autoContinueHeldAt: null, ...over,
  };
}

const MARK_BASE: TurnMark = {
  sessionId: 'uuid-1', state: 'done', event: 'Stop', at: NOW - 3 * H, turnAt: NOW - 3 * H - 20 * MIN,
  stopAt: NOW - 3 * H, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [],
  lostIds: [], graceUntil: null,
};
function mark(over: Partial<TurnMark> = {}): TurnMarkRead {
  return { ok: true, ...MARK_BASE, ...over };
}
function okMark(r: TurnMarkRead): TurnMark {
  if (!r.ok) throw new Error(`fixture: the mark reads ${r.reason}`);
  return r;
}

function mailRow(id: number, at: number, fromId: string, toId: string, subject: string, runId: number | null = null, kind = 'status'): StallMailRow {
  return { id, at, runId, fromId, toId, kind, subject };
}
function delivery(id: number, mailId: number, over: Partial<StallDeliveryRow> = {}): StallDeliveryRow {
  return { id, mailId, toId: WORKER, state: 'queued', deliveredAt: null, ackedAt: null, lastGate: null, gateSince: null, ...over };
}
function notice(mode: StallMode, arm: StallArm, rung: 1 | 2 | 3, key: number, at: number): StallNotice {
  return { mode, arm, rung, key, at };
}

interface Over {
  sessionId?: string; role?: StallSessionRole; run?: StallRunRow | null; worker?: StallWorker; mark?: TurnMarkRead;
  liveStartedAt?: number | null; markUnreadableSince?: number | null; mail?: readonly StallMailRow[];
  deliveries?: readonly StallDeliveryRow[]; notices?: readonly StallNotice[]; arming?: StallArming;
  coordinationPaused?: boolean;
}
/** A run worker (run 67, claimed by COORD) by default. A coordinator or `other` row gets `run: null` unless given one. */
function sessionInput(over: Over = {}): StallSessionInput {
  const role = over.role ?? 'worker';
  return {
    sessionId: over.sessionId ?? WORKER,
    role,
    run: over.run !== undefined ? over.run : role === 'worker' ? runRow() : null,
    worker: over.worker ?? workerAt('idle', NOW - 3 * H),
    mark: over.mark ?? mark(),
    liveStartedAt: over.liveStartedAt !== undefined ? over.liveStartedAt : NOW - 30 * H,
    markUnreadableSince: over.markUnreadableSince ?? null,
    mail: over.mail ?? [],
    deliveries: over.deliveries ?? [],
    notices: over.notices ?? [],
    arming: over.arming ?? W2,
    coordinationPaused: over.coordinationPaused ?? false,
  };
}

const NONE: StallVerdict = { act: 'none' };
const hold = (why: StallHold): StallVerdict => ({ act: 'hold', why });

describe('stallSessionHold: holds 1, 2 and the limit hold only (§10)', () => {
  it('hold: null for a measured, unlimited session', () => {
    expect(stallSessionHold(sessionInput(), NOW)).toBeNull();
  });
  it('hold: hold 1 belongs to a run worker alone', () => {
    expect(stallSessionHold(sessionInput({ run: runRow({ state: 'unknown' }) }), NOW)).toEqual(hold('run-unnamed'));
    expect(stallSessionHold(sessionInput({ run: runRow({ state: 'no-such-state' }) }), NOW)).toEqual(hold('run-unnamed'));
    expect(stallSessionHold(sessionInput({ run: runRow({ kind: 'chore' }) }), NOW)).toEqual(hold('run-unnamed'));
    expect(stallSessionHold(sessionInput({ role: 'coordinator', sessionId: COORD }), NOW)).toBeNull();
    expect(stallSessionHold(sessionInput({ role: 'other' }), NOW)).toBeNull();
  });
  it('hold: hold 1 comes before hold 2, and hold 2 before the limit hold', () => {
    expect(stallSessionHold(sessionInput({ run: runRow({ state: 'unknown' }), worker: { present: false } }), NOW)).toEqual(hold('run-unnamed'));
    expect(stallSessionHold(sessionInput({ worker: workerAt('idle', null, { stranded: true }) }), NOW)).toEqual(hold('unmeasured'));
  });
  it('hold: hold 2 answers absent, and unmeasured for every unmeasured input', () => {
    expect(stallSessionHold(sessionInput({ worker: { present: false } }), NOW)).toEqual(hold('absent'));
    const unmeasured: [string, Over][] = [
      ['FleetSession.unmeasured', { worker: workerAt('idle', NOW - 3 * H, { unmeasured: true }) }],
      ['a null lifecycle', { worker: workerAt('idle', NOW - 3 * H, { lifecycle: null }) }],
      ['lifecycle unmeasurable', { worker: workerAt('idle', NOW - 3 * H, { lifecycle: 'unmeasurable' }) }],
      ['a lifecycle word this build cannot name', { worker: workerAt('idle', NOW - 3 * H, { lifecycle: 'zombie' }) }],
      ['a live read that failed', { worker: workerAt('idle', NOW - 3 * H, { live: { ok: false, reason: 'unmeasured' } }) }],
      ['no live file', { worker: workerAt('idle', NOW - 3 * H, { live: { ok: false, reason: 'no-state' } }) }],
      ['a null live stamp', { worker: workerAt('idle', null) }],
      ['a marker read that failed', { mark: { ok: false, reason: 'unmeasured' } }],
    ];
    for (const [name, over] of unmeasured) expect(stallSessionHold(sessionInput(over), NOW), name).toEqual(hold('unmeasured'));
  });
  it('hold: a malformed, foreign, stale or absent marker is no hold', () => {
    for (const reason of ['absent', 'malformed', 'foreign', 'stale'] as const) {
      expect(stallSessionHold(sessionInput({ mark: { ok: false, reason } }), NOW), reason).toBeNull();
    }
  });
  it('hold: the limit hold and its boundaries', () => {
    const limited: [string, Partial<PresentWorker>][] = [
      ['the 5 h window at 100', { limits: { five: 100, seven: 34 } }],
      ['the 7 d window at 100', { limits: { five: 12, seven: 100 } }],
      ['stranded', { stranded: true }],
      ['swap blocked', { swapBlocked: true }],
      ['an auto-continue hold begun within AUTO_CONTINUE_RECENT_MS', { autoContinueHeldAt: NOW - AUTO_CONTINUE_RECENT_MS + MIN }],
    ];
    for (const [name, w] of limited) {
      expect(stallSessionHold(sessionInput({ worker: workerAt('idle', NOW - 3 * H, w) }), NOW), name).toEqual(hold('limit'));
    }
    expect(stallSessionHold(sessionInput({ worker: workerAt('idle', NOW - 3 * H, { autoContinueHeldAt: NOW - AUTO_CONTINUE_RECENT_MS }) }), NOW),
      'an auto-continue hold exactly AUTO_CONTINUE_RECENT_MS old').toBeNull();
    expect(stallSessionHold(sessionInput({ worker: workerAt('idle', NOW - 3 * H, { limits: null }) }), NOW), 'null limits').toBeNull();
  });
});

describe('stallCoordinatorSubjects: the claimants of the candidate runs (Contract note 2)', () => {
  const a = runRow({ id: 70, sessionId: 'demo-w1', claimedBy: COORD });
  const b = runRow({ id: 68, sessionId: 'demo-w2', claimedBy: 'demo-soft-basin' });
  const c = runRow({ id: 72, sessionId: 'demo-w3', claimedBy: COORD });
  const unclaimed = runRow({ id: 69, sessionId: 'demo-w4', claimedBy: null });
  const blank = runRow({ id: 71, sessionId: 'demo-w5', claimedBy: '' });
  it('coordinators: groups by claimant, runs in id order, subjects by first run id; no subject for an unclaimed or blank claimant', () => {
    expect(stallCoordinatorSubjects([a, b, c, unclaimed, blank])).toEqual([
      { sessionId: 'demo-soft-basin', runs: [b] },
      { sessionId: COORD, runs: [a, c] },
    ]);
  });
  it('coordinators: order-stable under any input order', () => {
    expect(stallCoordinatorSubjects([blank, c, unclaimed, b, a])).toEqual(stallCoordinatorSubjects([a, b, c, unclaimed, blank]));
  });
  it('coordinators: no runs, no subjects', () => {
    expect(stallCoordinatorSubjects([])).toEqual([]);
  });
});

describe('Task 10 subjects, as the session verdicts read them: the three self-mails are class self-wake', () => {
  // These rows pin Task 10's builders from the reader's side and pass from Step 2 on. The E first-kind rule is Task
  // 10's own row, not repeated here.
  const m = okMark(mark({ restartAt: NOW - H, lostBg: 2, lostKinds: ['shell'], bgKinds: ['subagent'], err: 'server_error' }));
  const d = stallOrphanDSubject(m);
  const e = stallOrphanESubject(m);
  const f = stallFailedSubject(m.err ?? '', m.stopAt ?? Number.NaN);
  it('subjects: each opens with its prefix and classes self-wake from the watch, ordinary mail from a session', () => {
    const cases: [string, string, string][] = [
      ['orphan-d', d, STALL_ORPHANED_PREFIX], ['orphan-e', e, STALL_ORPHANED_PREFIX], ['failed', f, STALL_FAILED_PREFIX],
    ];
    for (const [arm, subject, prefix] of cases) {
      expect(subject.startsWith(`${prefix} `), arm).toBe(true);
      expect(stallMailClass({ fromId: WATCH, runId: null, subject, mailId: 1 }), arm).toBe('self-wake');
      expect(stallMailClass({ fromId: WORKER, runId: null, subject, mailId: 1 }), arm).toBeNull();
    }
  });
  it('subjects: the three differ on one marker, so no arm reads another arm mail as its own', () => {
    expect(new Set([d, e, f]).size).toBe(3);
  });
});

describe('orphan D (§5.2): any session, a restart that cut background tasks short', () => {
  const R = NOW - 2 * H;
  /** A resume at `restartAt` (one hour after the last Stop) cut two background tasks. The pane has read idle since
   *  one minute after the restart, and the live process started five seconds before its SessionStart. */
  function dInput(restartAt: number, markOver: Partial<TurnMark> = {}, over: Over = {}): StallSessionInput {
    const stopAt = restartAt - H;
    return sessionInput({
      role: 'other', worker: workerAt('idle', restartAt + MIN), liveStartedAt: restartAt - 5_000,
      mark: mark({
        event: 'SessionStart', at: restartAt, turnAt: stopAt - 20 * MIN, stopAt, restartAt, bg: 0,
        lostBg: 2, lostKinds: ['shell', 'subagent'], lostIds: ['b989ocn62', 'a7c1d2e3'], ...markOver,
      }),
      ...over,
    });
  }
  const d1 = (key = R): StallVerdict => ({ act: 'notify', arm: 'orphan-d', rung: 1, key, to: 'worker' });
  const d2 = (key = R): StallVerdict => ({ act: 'notify', arm: 'orphan-d', rung: 2, key, to: 'operator' });
  const subjectOf = (input: StallSessionInput): string => stallOrphanDSubject(okMark(input.mark));
  /** Rung 1's mail, queued at `at`, with one delivery row shaped by `dOver` (none when null). */
  const sent = (input: StallSessionInput, dOver: Partial<StallDeliveryRow> | null, runId: number | null = null, at = NOW - 90 * MIN): Pick<StallSessionInput, 'mail' | 'deliveries'> => ({
    mail: [mailRow(601, at, WATCH, input.sessionId, subjectOf(input), runId)],
    deliveries: dOver === null ? [] : [delivery(801, 601, { toId: input.sessionId, ...dOver })],
  });

  it('D: fires rung 1 to the session itself, keyed on restartAt, for any row, a coordinator and a run worker', () => {
    expect(stallOrphanDVerdict(dInput(R), NOW)).toEqual(d1());
    expect(stallOrphanDVerdict(dInput(R, {}, { role: 'coordinator', sessionId: COORD }), NOW)).toEqual(d1());
    expect(stallOrphanDVerdict(dInput(R, {}, { role: 'worker', run: runRow() }), NOW)).toEqual(d1());
  });
  it('D: each conjunct, negated, is none', () => {
    const cases: [string, StallSessionInput][] = [
      ['a working mark', dInput(R, { state: 'working' })],
      ['a failed mark', dInput(R, { state: 'failed', err: 'server_error' })],
      ['nothing lost', dInput(R, { lostBg: 0, lostKinds: [], lostIds: [] })],
      ['no restart', dInput(R, { restartAt: null })],
      ['a restart at the stop', dInput(R, { stopAt: R })],
      ['a restart before the stop', dInput(R, { stopAt: R + MIN })],
      ['a busy pane', dInput(R, {}, { worker: workerAt('busy', R + MIN) })],
      ['a waiting pane', dInput(R, {}, { worker: workerAt('waiting', R + MIN) })],
      ['idle one minute short of ORPHAN_D_IDLE_MS', dInput(R, {}, { worker: workerAt('idle', NOW - ORPHAN_D_IDLE_MS + MIN) })],
    ];
    for (const [name, input] of cases) expect(stallOrphanDVerdict(input, NOW), name).toEqual(NONE);
  });
  it('D: the candidate predicate reads the mark alone, and each of its conjuncts, negated, is false', () => {
    const m = okMark(dInput(R).mark);
    expect(stallOrphanDCandidate(m)).toBe(true);
    const negated: [string, Partial<TurnMark>][] = [
      ['a working mark', { state: 'working' }],
      ['a failed mark', { state: 'failed', err: 'server_error' }],
      ['nothing lost', { lostBg: 0, lostKinds: [], lostIds: [] }],
      ['no restart', { restartAt: null }],
      ['a restart at the stop', { stopAt: R }],
      ['a restart before the stop', { stopAt: R + MIN }],
    ];
    for (const [name, over] of negated) expect(stallOrphanDCandidate({ ...m, ...over }), name).toBe(false);
    expect(stallOrphanDCandidate({ ...m, stopAt: null }), 'a restart with no stop recorded').toBe(true);
    expect(stallOrphanDCandidate({ ...m, restartAt: NOW - 25 * H, stopAt: NOW - 26 * H }), 'the horizon is the verdict, not the candidate').toBe(true);
  });
  it('D: fires from exactly ORPHAN_D_IDLE_MS, and on shell', () => {
    expect(stallOrphanDVerdict(dInput(R, {}, { worker: workerAt('idle', NOW - ORPHAN_D_IDLE_MS) }), NOW)).toEqual(d1());
    expect(stallOrphanDVerdict(dInput(R, {}, { worker: workerAt('shell', R + MIN) }), NOW)).toEqual(d1());
  });
  it('D: the 25 h row, a restart older than BACKLOG_HORIZON_MS is never woken', () => {
    expect(stallOrphanDVerdict(dInput(NOW - 25 * H), NOW)).toEqual(NONE);
    expect(stallOrphanDVerdict(dInput(NOW - 23 * H), NOW)).toEqual(d1(NOW - 23 * H));
    expect(stallOrphanDVerdict(dInput(NOW - BACKLOG_HORIZON_MS), NOW)).toEqual(d1(NOW - BACKLOG_HORIZON_MS));
  });
  it('D: a stale or unreadable mark is none, an unmeasured one holds', () => {
    expect(stallOrphanDVerdict(dInput(R, {}, { liveStartedAt: NOW - MIN }), NOW), 'older than the live process').toEqual(NONE);
    expect(stallOrphanDVerdict(dInput(R, {}, { liveStartedAt: null }), NOW), 'no startedAt').toEqual(NONE);
    for (const reason of ['absent', 'malformed', 'foreign', 'stale'] as const) {
      expect(stallOrphanDVerdict(dInput(R, {}, { mark: { ok: false, reason } }), NOW), reason).toEqual(NONE);
    }
    expect(stallOrphanDVerdict(dInput(R, {}, { mark: { ok: false, reason: 'unmeasured' } }), NOW)).toEqual(hold('unmeasured'));
    expect(stallOrphanDVerdict(dInput(R, {}, { worker: { present: false } }), NOW)).toEqual(hold('absent'));
    expect(stallOrphanDVerdict(dInput(R, {}, { worker: workerAt('idle', R + MIN, { stranded: true }) }), NOW)).toEqual(hold('limit'));
  });
  it('D: run-less rung 1 is done by the watch mail with the exact subject, and by nothing else', () => {
    const base = dInput(R);
    expect(stallOrphanDVerdict({ ...base, ...sent(base, null) }, NOW), 'the sent mail').toEqual(NONE);
    const other = { ...base, mail: [mailRow(601, NOW - 90 * MIN, WATCH, WORKER, `${STALL_ORPHANED_PREFIX} another episode`)] };
    expect(stallOrphanDVerdict(other, NOW), 'another subject').toEqual(d1());
    const fromSession = { ...base, mail: [mailRow(601, NOW - 90 * MIN, COORD, WORKER, subjectOf(base))] };
    expect(stallOrphanDVerdict(fromSession, NOW), 'the same words from a session').toEqual(d1());
    const toOther = { ...base, mail: [mailRow(601, NOW - 90 * MIN, WATCH, COORD, subjectOf(base))] };
    expect(stallOrphanDVerdict(toOther, NOW), 'to another session').toEqual(d1());
    const eSubject = { ...base, mail: [mailRow(601, NOW - 90 * MIN, WATCH, WORKER, stallOrphanESubject(okMark(base.mark)))] };
    expect(stallOrphanDVerdict(eSubject, NOW), 'the E subject on the same marker').toEqual(d1());
  });
  it('D: a run worker rung 1 is done by its run notice, not by the mail alone', () => {
    const w = dInput(R, {}, { role: 'worker', run: runRow() });
    expect(stallOrphanDVerdict({ ...w, notices: [notice('live', 'orphan-d', 1, R, NOW - 90 * MIN)] }, NOW)).toEqual(NONE);
    expect(stallOrphanDVerdict({ ...w, ...sent(w, null, 67) }, NOW), 'a mail with no notice').toEqual(d1());
  });
  it('D: a shadow rung-1 row stands while dark, and the rung is sent once armed', () => {
    const w = dInput(R, {}, { role: 'worker', run: runRow(), notices: [notice('shadow', 'orphan-d', 1, R, NOW - 90 * MIN)] });
    expect(stallOrphanDVerdict({ ...w, arming: DARK }, NOW)).toEqual(NONE);
    expect(stallOrphanDVerdict(w, NOW)).toEqual(d1());
  });
  it('D: rung 2 timings, unacked ORPHAN_PUSH_MS after delivery or undelivered that long after queueing', () => {
    const base = dInput(R);
    const at = (dOver: Partial<StallDeliveryRow> | null, mailAt?: number): StallVerdict =>
      stallOrphanDVerdict({ ...base, ...sent(base, dOver, null, mailAt) }, NOW);
    expect(at({ deliveredAt: NOW - ORPHAN_PUSH_MS - MIN }), 'delivered 31 min ago').toEqual(d2());
    expect(at({ deliveredAt: NOW - ORPHAN_PUSH_MS }), 'delivered exactly ORPHAN_PUSH_MS ago').toEqual(d2());
    expect(at({ deliveredAt: NOW - ORPHAN_PUSH_MS + MIN }), 'delivered 29 min ago').toEqual(NONE);
    expect(at({ deliveredAt: NOW - ORPHAN_PUSH_MS - MIN, ackedAt: NOW - 5 * MIN }), 'acked').toEqual(NONE);
    expect(at({}, NOW - ORPHAN_PUSH_MS - MIN), 'queued 31 min ago, never delivered').toEqual(d2());
    expect(at({}, NOW - ORPHAN_PUSH_MS + MIN), 'queued 29 min ago').toEqual(NONE);
    expect(at(null), 'no delivery row').toEqual(NONE);
    expect(at({ toId: COORD, deliveredAt: NOW - ORPHAN_PUSH_MS - MIN }), 'a delivery to another session').toEqual(NONE);
  });
  it('D: a run worker rung 2 is recorded, and done by its rung-2 notice', () => {
    const w = dInput(R, {}, { role: 'worker', run: runRow() });
    const r1Done: StallSessionInput = {
      ...w, ...sent(w, { deliveredAt: NOW - ORPHAN_PUSH_MS - MIN }, 67), notices: [notice('live', 'orphan-d', 1, R, NOW - 90 * MIN)],
    };
    expect(stallOrphanDVerdict(r1Done, NOW)).toEqual(d2());
    expect(stallOrphanDVerdict({ ...r1Done, notices: [...r1Done.notices, notice('live', 'orphan-d', 2, R, NOW - MIN)] }, NOW)).toEqual(NONE);
  });
  it('D: a run-less rung 2 answers every sweep, and the lane latch holds it to one push', () => {
    const base = dInput(R);
    const input = { ...base, ...sent(base, { deliveredAt: NOW - ORPHAN_PUSH_MS - MIN }) };
    expect(stallOrphanDVerdict(input, NOW)).toEqual(d2());
    expect(stallOrphanDVerdict(input, NOW + 10 * MIN)).toEqual(d2());
  });
  it('D: mail-disabled holds rung 1 when it would send, and rung 2 and a shadow rung 1 stand', () => {
    expect(stallOrphanDVerdict(dInput(R, {}, { arming: W2_MAIL_OFF }), NOW)).toEqual(hold('mail-disabled'));
    expect(stallOrphanDVerdict(dInput(R, {}, { arming: DARK_MAIL_OFF }), NOW), 'shadow').toEqual(d1());
    const base = dInput(R, {}, { arming: W2_MAIL_OFF });
    expect(stallOrphanDVerdict({ ...base, ...sent(base, { deliveredAt: NOW - ORPHAN_PUSH_MS - MIN }) }, NOW), 'rung 2').toEqual(d2());
  });
});

describe('orphan E (§5.2): run workers and coordinators, a wake-bearing task that ended without waking the session', () => {
  const S = NOW - 30 * MIN;
  /** A Stop 30 min ago left a monitor and a subagent running. The pane has read idle since two seconds after it. */
  function eInput(markOver: Partial<TurnMark> = {}, over: Over = {}): StallSessionInput {
    return sessionInput({
      worker: workerAt('idle', S + 2_000),
      mark: mark({ at: S, turnAt: S - 20 * MIN, stopAt: S, bg: 2, bgKinds: ['monitor', 'subagent'], bgIds: ['b989ocn62', 'm1'], ...markOver }),
      ...over,
    });
  }
  const e1 = (key = S): StallVerdict => ({ act: 'notify', arm: 'orphan-e', rung: 1, key, to: 'worker' });

  it('E: fires rung 1 to the session itself, keyed on stopAt, for a run worker and a coordinator', () => {
    expect(stallOrphanEVerdict(eInput(), NOW)).toEqual(e1());
    expect(stallOrphanEVerdict(eInput({}, { role: 'coordinator', sessionId: COORD }), NOW)).toEqual(e1());
  });
  it('E: any other session is not an E candidate, operator panes are excluded', () => {
    expect(stallOrphanEVerdict(eInput({}, { role: 'other' }), NOW)).toEqual(NONE);
  });
  it('E: each marker conjunct, negated, is none', () => {
    const cases: [string, StallSessionInput][] = [
      ['a working mark', eInput({ state: 'working' })],
      ['a failed mark', eInput({ state: 'failed', err: 'server_error' })],
      ['no stop', eInput({ stopAt: null })],
      ['a restart after the stop', eInput({ restartAt: S + 1_000 })],
      ['a restart at the stop', eInput({ restartAt: S })],
      ['a later write than the stop', eInput({ at: S + 5_000 })],
      ['no kinds', eInput({ bgKinds: [], bgIds: [] })],
      ['no wake-bearing kind', eInput({ bgKinds: ['monitor'], bgIds: ['m1'] })],
    ];
    for (const [name, input] of cases) expect(stallOrphanEVerdict(input, NOW), name).toEqual(NONE);
  });
  it('E: shell, subagent and workflow are each wake-bearing', () => {
    for (const k of ['shell', 'subagent', 'workflow']) expect(stallOrphanEVerdict(eInput({ bgKinds: [k] }), NOW), k).toEqual(e1());
  });
  it('E: a restart before the stop does not block it', () => {
    expect(stallOrphanEVerdict(eInput({ restartAt: S - H }), NOW)).toEqual(e1());
  });
  it('E: shell is not idle for E, the live word must be exactly idle', () => {
    expect(stallOrphanEVerdict(eInput({}, { worker: workerAt('shell', S + 2_000) }), NOW)).toEqual(NONE);
  });
  it('E: the live conjuncts', () => {
    expect(stallOrphanEVerdict(eInput({}, { worker: workerAt('busy', S + 2_000) }), NOW), 'busy').toEqual(NONE);
    expect(stallOrphanEVerdict(eInput({}, { worker: workerAt('idle', S - 1_000) }), NOW), 'idle since before the stop').toEqual(NONE);
    expect(stallOrphanEVerdict(eInput({}, { worker: workerAt('idle', NOW - ORPHAN_E_IDLE_MS + MIN) }), NOW), 'one minute short').toEqual(NONE);
    expect(stallOrphanEVerdict(eInput({}, { worker: workerAt('idle', NOW - ORPHAN_E_IDLE_MS) }), NOW), 'exactly ORPHAN_E_IDLE_MS').toEqual(e1());
  });
  it('E: done, a run worker by its notice, a coordinator by the watch mail with the exact subject', () => {
    expect(stallOrphanEVerdict(eInput({}, { notices: [notice('live', 'orphan-e', 1, S, NOW - 5 * MIN)] }), NOW)).toEqual(NONE);
    const c = eInput({}, { role: 'coordinator', sessionId: COORD });
    const subject = stallOrphanESubject(okMark(c.mark));
    expect(stallOrphanEVerdict({ ...c, mail: [mailRow(602, NOW - 5 * MIN, WATCH, COORD, subject)] }, NOW)).toEqual(NONE);
  });
  it('E: a stale mark is none', () => {
    expect(stallOrphanEVerdict(eInput({}, { liveStartedAt: NOW - MIN }), NOW)).toEqual(NONE);
    expect(stallOrphanEVerdict(eInput({}, { liveStartedAt: null }), NOW)).toEqual(NONE);
  });
  it('E: mail-disabled holds rung 1 when it would send, and a shadow rung 1 stands', () => {
    expect(stallOrphanEVerdict(eInput({}, { arming: W2_MAIL_OFF }), NOW)).toEqual(hold('mail-disabled'));
    expect(stallOrphanEVerdict(eInput({}, { arming: DARK_MAIL_OFF }), NOW)).toEqual(e1());
  });
});

describe('failed (§5.2): run workers and coordinators, a turn that ended on an API error', () => {
  const S = NOW - 20 * MIN;
  /** A StopFailure 20 min ago with `server_error`. The pane has read idle since one second after it. */
  function fInput(markOver: Partial<TurnMark> = {}, over: Over = {}): StallSessionInput {
    return sessionInput({
      worker: workerAt('idle', S + 1_000),
      mark: mark({ state: 'failed', event: 'StopFailure', at: S, turnAt: S - 5 * MIN, stopAt: S, err: 'server_error', ...markOver }),
      ...over,
    });
  }
  const f1 = (err = 'server_error', key = S): StallVerdict => ({ act: 'notify', arm: 'failed', rung: 1, key, to: 'worker', err });
  const f2c = (because: 'repeat' | 'request', err: string, key = S): StallVerdict =>
    ({ act: 'notify', arm: 'failed', rung: 2, key, to: 'coordinator', coordinatorId: COORD, err, because });
  const f2o = (because: 'repeat' | 'request', err: string, key = S): StallVerdict =>
    ({ act: 'notify', arm: 'failed', rung: 2, key, to: 'operator', err, because });
  const prior = (key: number, mode: StallMode = 'live'): StallNotice => notice(mode, 'failed', 1, key, key + 15 * MIN);
  const tokens = (cls: string): string[] => Object.entries(STOP_FAILURE_ERRORS).filter(([, c]) => c === cls).map(([e]) => e);

  it('failed: a retry-class error fires rung 1 to the session itself, keyed on stopAt', () => {
    expect(tokens('retry')).toHaveLength(4);
    for (const err of tokens('retry')) expect(stallFailedVerdict(fInput({ err }), NOW), err).toEqual(f1(err));
  });
  it('failed: fires for a coordinator too, and never for another session', () => {
    expect(stallFailedVerdict(fInput({}, { role: 'coordinator', sessionId: COORD }), NOW)).toEqual(f1());
    expect(stallFailedVerdict(fInput({}, { role: 'other' }), NOW)).toEqual(NONE);
  });
  it('failed: each conjunct, negated, is none', () => {
    const cases: [string, StallSessionInput][] = [
      ['a done mark', fInput({ state: 'done', err: null })],
      ['a working mark', fInput({ state: 'working' })],
      ['one minute short of FAILED_IDLE_MS', fInput({ at: NOW - FAILED_IDLE_MS + MIN, stopAt: NOW - FAILED_IDLE_MS + MIN })],
      ['a busy pane', fInput({}, { worker: workerAt('busy', S + 1_000) })],
      ['a waiting pane', fInput({}, { worker: workerAt('waiting', S + 1_000) })],
    ];
    for (const [name, input] of cases) expect(stallFailedVerdict(input, NOW), name).toEqual(NONE);
  });
  it('failed: fires from exactly FAILED_IDLE_MS, and on shell', () => {
    const edge = NOW - FAILED_IDLE_MS;
    expect(stallFailedVerdict(fInput({ at: edge, stopAt: edge }), NOW)).toEqual(f1('server_error', edge));
    expect(stallFailedVerdict(fInput({}, { worker: workerAt('shell', S + 1_000) }), NOW)).toEqual(f1());
  });
  it('failed: an account-class error holds failed-account, the limit, swap and authdead machinery owns it', () => {
    expect(tokens('account')).toHaveLength(7);
    for (const err of tokens('account')) expect(stallFailedVerdict(fInput({ err }), NOW), err).toEqual(hold('failed-account'));
  });
  it('failed: an unclassifiable token holds failed-unknown and is never guessed', () => {
    for (const err of ['new_error', '', null]) expect(stallFailedVerdict(fInput({ err }), NOW), String(err)).toEqual(hold('failed-unknown'));
  });
  it('failed: a request-class error goes to rung 2, to the claimant, else the operator', () => {
    expect(tokens('request')).toHaveLength(2);
    expect(stallFailedVerdict(fInput({ err: 'invalid_request' }), NOW)).toEqual(f2c('request', 'invalid_request'));
    expect(stallFailedVerdict(fInput({ err: 'model_not_found' }), NOW)).toEqual(f2c('request', 'model_not_found'));
    expect(stallFailedVerdict(fInput({ err: 'invalid_request' }, { coordinationPaused: true }), NOW), 'paused').toEqual(f2o('request', 'invalid_request'));
    expect(stallFailedVerdict(fInput({ err: 'invalid_request' }, { run: runRow({ claimedBy: null }) }), NOW), 'unclaimed').toEqual(f2o('request', 'invalid_request'));
    expect(stallFailedVerdict(fInput({ err: 'invalid_request' }, { role: 'coordinator', sessionId: COORD }), NOW), 'a coordinator').toEqual(f2o('request', 'invalid_request'));
  });
  it('failed: a retry-class repeat inside the window goes to rung 2', () => {
    expect(stallFailedVerdict(fInput({}, { notices: [prior(S - H)] }), NOW)).toEqual(f2c('repeat', 'server_error'));
    expect(stallFailedVerdict(fInput({}, { notices: [prior(S - H, 'shadow')] }), NOW), 'a shadow row records the failure too').toEqual(f2c('repeat', 'server_error'));
    expect(stallFailedVerdict(fInput({}, { notices: [prior(S - FAILED_REPEAT_MS)] }), NOW), 'the lower bound is inclusive').toEqual(f2c('repeat', 'server_error'));
    expect(stallFailedVerdict(fInput({}, { notices: [prior(S - H)], coordinationPaused: true }), NOW), 'paused').toEqual(f2o('repeat', 'server_error'));
  });
  it('failed: the 3 h row, a failure before the repeat window is no repeat', () => {
    expect(stallFailedVerdict(fInput({}, { notices: [prior(S - 3 * H)] }), NOW)).toEqual(f1());
  });
  it('failed: its own rung-1 notice is no prior failure, the rung is done', () => {
    expect(stallFailedVerdict(fInput({}, { notices: [prior(S)] }), NOW)).toEqual(NONE);
  });
  it('failed: a recorded rung 2 is done', () => {
    expect(stallFailedVerdict(fInput({}, { notices: [prior(S - H), notice('live', 'failed', 2, S, NOW - MIN)] }), NOW)).toEqual(NONE);
  });
  it('failed: run-less prior failure is a failed self-mail sent inside the window under another subject', () => {
    const c = fInput({}, { role: 'coordinator', sessionId: COORD });
    const priorSubject = stallFailedSubject('overloaded', S - H - 15 * MIN);
    const withMail = (at: number, subject = priorSubject, fromId = WATCH): StallSessionInput => ({ ...c, mail: [mailRow(603, at, fromId, COORD, subject)] });
    expect(stallFailedVerdict(withMail(S - H), NOW)).toEqual(f2o('repeat', 'server_error'));
    expect(stallFailedVerdict(withMail(S - 3 * H), NOW), 'the 3 h row, run-less').toEqual(f1());
    expect(stallFailedVerdict(withMail(S - H, `${STALL_ORPHANED_PREFIX} another episode`), NOW), 'an orphan mail is no failure').toEqual(f1());
    expect(stallFailedVerdict(withMail(S - H, priorSubject, WORKER), NOW), 'the same words from a session').toEqual(f1());
  });
  it('failed: run-less rung 1 is done by the watch mail with this failure exact subject', () => {
    const c = fInput({}, { role: 'coordinator', sessionId: COORD });
    const subject = stallFailedSubject('server_error', S);
    expect(stallFailedVerdict({ ...c, mail: [mailRow(604, NOW - 5 * MIN, WATCH, COORD, subject)] }, NOW)).toEqual(NONE);
  });
  it('failed: mail-disabled holds rung 1 and a coordinator-bound rung 2, and an operator-bound rung 2 and a shadow rung stand', () => {
    expect(stallFailedVerdict(fInput({}, { arming: W2_MAIL_OFF }), NOW), 'rung 1').toEqual(hold('mail-disabled'));
    expect(stallFailedVerdict(fInput({ err: 'invalid_request' }, { arming: W2_MAIL_OFF }), NOW), 'rung 2 to the claimant').toEqual(hold('mail-disabled'));
    expect(stallFailedVerdict(fInput({ err: 'invalid_request' }, { arming: W2_MAIL_OFF, coordinationPaused: true }), NOW), 'rung 2 to the operator')
      .toEqual(f2o('request', 'invalid_request'));
    expect(stallFailedVerdict(fInput({}, { arming: DARK_MAIL_OFF }), NOW), 'shadow').toEqual(f1());
  });
  it('failed: the shared holds and a stale mark', () => {
    expect(stallFailedVerdict(fInput({}, { worker: { present: false } }), NOW)).toEqual(hold('absent'));
    expect(stallFailedVerdict(fInput({}, { worker: workerAt('idle', S + 1_000, { stranded: true }) }), NOW)).toEqual(hold('limit'));
    expect(stallFailedVerdict(fInput({}, { run: runRow({ state: 'unknown' }) }), NOW)).toEqual(hold('run-unnamed'));
    expect(stallFailedVerdict(fInput({}, { liveStartedAt: NOW - MIN }), NOW)).toEqual(NONE);
  });
});

describe('mail-stuck (§5.2): per queued delivery to a run worker or a coordinator', () => {
  const M_AT = NOW - 3 * H;
  const workingMark = mark({ state: 'working', at: NOW - 20 * MIN, turnAt: NOW - 20 * MIN, stopAt: NOW - 2 * H });
  /** A brief queued 3 h ago, still queued. The recipient has read idle for 2 h, and its marker reads done since then. */
  function stuckInput(dOver: Partial<StallDeliveryRow> = {}, over: Over = {}): StallSessionInput {
    return sessionInput({
      worker: workerAt('idle', NOW - 2 * H),
      mark: mark({ at: NOW - 2 * H, turnAt: NOW - 2 * H - 10 * MIN, stopAt: NOW - 2 * H }),
      mail: [mailRow(501, M_AT, COORD, WORKER, 'brief', 67)],
      deliveries: [delivery(901, 501, { lastGate: 'not-idle', gateSince: M_AT, ...dOver })],
      ...over,
    });
  }
  const stuck = (key = 901): StallVerdict => ({ act: 'notify', arm: 'mail-stuck', rung: 1, key, to: 'operator' });
  const busy = workerAt('busy', NOW - 10 * MIN);

  it('mail-stuck: fires MAIL_STUCK_MS after the main loop went idle, to the operator, keyed on the delivery id', () => {
    expect(stallMailStuckVerdicts(stuckInput(), NOW)).toEqual([stuck()]);
  });
  it('mail-stuck: the clock is max of idle start and queue time', () => {
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: workerAt('idle', NOW - MAIL_STUCK_MS + MIN) }), NOW), 'idle one minute short').toEqual([NONE]);
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: workerAt('idle', NOW - MAIL_STUCK_MS) }), NOW), 'idle exactly MAIL_STUCK_MS').toEqual([stuck()]);
    const late = [mailRow(501, NOW - MAIL_STUCK_MS + MIN, COORD, WORKER, 'brief', 67)];
    expect(stallMailStuckVerdicts(stuckInput({}, { mail: late }), NOW), 'queued one minute short, idle for 2 h').toEqual([NONE]);
  });
  it('mail-stuck: idle is live idle or shell, else a current marker that reads done or failed', () => {
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: workerAt('shell', NOW - 2 * H) }), NOW), 'shell').toEqual([stuck()]);
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy }), NOW), 'busy with a current done mark').toEqual([stuck()]);
    const failedMark = mark({ state: 'failed', err: 'server_error', at: NOW - 2 * H, stopAt: NOW - 2 * H });
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy, mark: failedMark }), NOW), 'busy with a current failed mark').toEqual([stuck()]);
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy, mark: workingMark }), NOW), 'busy with a working mark').toEqual([NONE]);
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy, liveStartedAt: NOW - MIN }), NOW), 'busy with a stale done mark').toEqual([NONE]);
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: busy, mark: { ok: false, reason: 'malformed' } }), NOW), 'busy, malformed').toEqual([NONE]);
  });
  it('mail-stuck: only queued rows to this session, one verdict each in id order', () => {
    expect(stallMailStuckVerdicts(stuckInput({ state: 'delivered', deliveredAt: NOW - 2 * H }), NOW), 'delivered').toEqual([]);
    expect(stallMailStuckVerdicts(stuckInput({ state: 'acked' }), NOW), 'acked').toEqual([]);
    expect(stallMailStuckVerdicts(stuckInput({ toId: COORD }), NOW), 'to another session').toEqual([]);
    const two = stuckInput({}, {
      mail: [mailRow(501, M_AT, COORD, WORKER, 'brief', 67), mailRow(502, NOW - H, COORD, WORKER, 'nudge', 67)],
      deliveries: [delivery(905, 502), delivery(901, 501)],
    });
    expect(stallMailStuckVerdicts(two, NOW)).toEqual([stuck(901), NONE]);
  });
  it('mail-stuck: a delivery whose mail row is not in the read cannot be timed by the idle clause', () => {
    expect(stallMailStuckVerdicts(stuckInput({}, { mail: [] }), NOW)).toEqual([NONE]);
  });
  it('mail-stuck: registry-unmeasurable for MAIL_STUCK_MS pushes whatever the live word, ahead of every hold', () => {
    const gate = (gateSince: number | null, over: Over = {}): StallVerdict[] =>
      stallMailStuckVerdicts(stuckInput({ lastGate: 'registry-unmeasurable', gateSince }, { worker: busy, mark: workingMark, ...over }), NOW);
    expect(gate(NOW - MAIL_STUCK_MS)).toEqual([stuck()]);
    expect(gate(NOW - MAIL_STUCK_MS + MIN), 'one minute short').toEqual([NONE]);
    expect(gate(null), 'no gateSince').toEqual([NONE]);
    expect(gate(NOW - MAIL_STUCK_MS, { worker: { present: false } }), 'absent').toEqual([stuck()]);
    expect(gate(NOW - MAIL_STUCK_MS, { mark: { ok: false, reason: 'unmeasured' } }), 'marker unmeasured').toEqual([stuck()]);
  });
  it('mail-stuck: the sticky-error row, any other recorded gate however old is not a stuck signal', () => {
    for (const lastGate of ['not-idle', 'tmux-gone', 'cooldown']) {
      expect(stallMailStuckVerdicts(stuckInput({ lastGate, gateSince: NOW - 5 * H }, { worker: busy, mark: workingMark }), NOW), lastGate).toEqual([NONE]);
    }
  });
  it('mail-stuck: the delivery port carries no lastError, sticky text is never read', () => {
    const noLastError: 'lastError' extends keyof StallDeliveryRow ? false : true = true;
    expect(noLastError).toBe(true);
  });
  it('mail-stuck: the idle clause answers the shared holds', () => {
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: { present: false } }), NOW)).toEqual([hold('absent')]);
    expect(stallMailStuckVerdicts(stuckInput({}, { worker: workerAt('idle', NOW - 2 * H, { stranded: true }) }), NOW)).toEqual([hold('limit')]);
    expect(stallMailStuckVerdicts(stuckInput({}, { run: runRow({ state: 'unknown' }) }), NOW)).toEqual([hold('run-unnamed')]);
  });
  it('mail-stuck: done, a run worker push is recorded on its run, a coordinator push answers every sweep', () => {
    expect(stallMailStuckVerdicts(stuckInput({}, { notices: [notice('live', 'mail-stuck', 1, 901, NOW - MIN)] }), NOW)).toEqual([NONE]);
    const c = stuckInput({ toId: COORD }, { role: 'coordinator', sessionId: COORD, mail: [mailRow(501, M_AT, WORKER, COORD, 'question', null, 'question')] });
    expect(stallMailStuckVerdicts(c, NOW)).toEqual([stuck()]);
    expect(stallMailStuckVerdicts(c, NOW + 10 * MIN)).toEqual([stuck()]);
  });
  it('mail-stuck: any other session is not a candidate', () => {
    expect(stallMailStuckVerdicts(stuckInput({}, { role: 'other' }), NOW)).toEqual([]);
  });
  it('mail-stuck: mail-disabled leaves the operator push standing', () => {
    expect(stallMailStuckVerdicts(stuckInput({}, { arming: W2_MAIL_OFF }), NOW)).toEqual([stuck()]);
  });
});

describe('marker-unreadable for a coordinator (coordinator-marker-unreadable)', () => {
  const SINCE = NOW - MARKER_UNREADABLE_MS - MIN;
  function mkInput(over: Over = {}): StallSessionInput {
    return sessionInput({ role: 'coordinator', sessionId: COORD, mark: { ok: false, reason: 'malformed' }, markUnreadableSince: SINCE, ...over });
  }
  const mu = (key = SINCE): StallVerdict => ({ act: 'notify', arm: 'marker-unreadable', rung: 1, key, to: 'operator' });

  it('marker: 59 vs 61 min, pushes the operator from MARKER_UNREADABLE_MS keyed on the first-seen time', () => {
    expect(stallSessionMarkerVerdict(mkInput(), NOW), '61 min').toEqual(mu());
    expect(stallSessionMarkerVerdict(mkInput({ markUnreadableSince: NOW - MARKER_UNREADABLE_MS + MIN }), NOW), '59 min').toEqual(NONE);
    expect(stallSessionMarkerVerdict(mkInput({ markUnreadableSince: NOW - MARKER_UNREADABLE_MS }), NOW), 'exactly').toEqual(mu(NOW - MARKER_UNREADABLE_MS));
  });
  it('marker: unmeasured counts, and absent, foreign, stale and a readable mark do not', () => {
    expect(stallSessionMarkerVerdict(mkInput({ mark: { ok: false, reason: 'unmeasured' } }), NOW)).toEqual(mu());
    for (const reason of ['absent', 'foreign', 'stale'] as const) {
      expect(stallSessionMarkerVerdict(mkInput({ mark: { ok: false, reason } }), NOW), reason).toEqual(NONE);
    }
    expect(stallSessionMarkerVerdict(mkInput({ mark: mark() }), NOW), 'ok').toEqual(NONE);
  });
  it('marker: coordinators only, a run worker gets it through the run verdict', () => {
    expect(stallSessionMarkerVerdict(mkInput({ role: 'worker', sessionId: WORKER }), NOW)).toEqual(NONE);
    expect(stallSessionMarkerVerdict(mkInput({ role: 'other' }), NOW)).toEqual(NONE);
  });
  it('marker: no first-seen time, no push', () => {
    expect(stallSessionMarkerVerdict(mkInput({ markUnreadableSince: null }), NOW)).toEqual(NONE);
  });
  it('marker: holds 1 and 2 do not apply, the unreadable mark is the fact reported', () => {
    expect(stallSessionMarkerVerdict(mkInput({ worker: { present: false } }), NOW), 'absent').toEqual(mu());
    expect(stallSessionMarkerVerdict(mkInput({ worker: workerAt('idle', NOW - H, { live: { ok: false, reason: 'unmeasured' } }) }), NOW), 'live unmeasured').toEqual(mu());
    expect(stallSessionMarkerVerdict(mkInput({ worker: workerAt('idle', NOW - H, { lifecycle: 'unmeasurable' }) }), NOW), 'lifecycle unmeasurable').toEqual(mu());
  });
  it('marker: the limit hold applies', () => {
    expect(stallSessionMarkerVerdict(mkInput({ worker: workerAt('idle', NOW - H, { stranded: true }) }), NOW)).toEqual(hold('limit'));
  });
  it('marker: mail-disabled leaves the operator push standing', () => {
    expect(stallSessionMarkerVerdict(mkInput({ arming: W2_MAIL_OFF }), NOW)).toEqual(mu());
  });
});
