// The stall watch's coordinator-blocked arm (operator ruling 2026-10-25, D-6942): mail addressed to a coordinator that
// the server still holds (a delivery `queued`, or a delivered one whose replay a gate holds) for COORD_BLOCKED_HELD_MS,
// whatever word the coordinator reads. The push names the gate reason in operator words: an open question
// (`waiting`), a background workflow (`busy` with no turn), the coordinator's own long busy stretch (`busy` with a
// turn), or idle but not receiving mail. It rises to rung 2 (escalated) when the busy or waiting stretch reaches
// COORD_BLOCKED_STRETCH_MS or the oldest held mail reaches COORD_BLOCKED_OLD_MS. One push per rung per episode; an
// episode runs while any mail to the coordinator stays held, and it only reports. The pure half: every input is built
// by the factories below and every clock is an argument. Each threshold is read by its constant's name.
import { describe, it, expect } from 'vitest';
import {
  COORD_BLOCKED_HELD_MS, COORD_BLOCKED_OLD_MS, COORD_BLOCKED_STRETCH_MS, MAIL_STUCK_MS, STALL_ARMS, rungRecipient,
  stallCoordBlockedPushText, stallCoordBlockedStep, stallCoordBusySince, stallCoordGate, stallNotifyDelivery, stallPushRoute,
} from '../src/coord/stall.js';
import type {
  StallArming, StallCoordBlockedInput, StallCoordEpisode, StallDeliveryRow, StallMailRow, StallNotify, StallRunRow,
  StallSessionInput, StallVerdict, StallWorker, TurnMark, TurnMarkRead,
} from '../src/coord/stall.js';
import { STALL_LADDER } from '../src/coord/stallsettings.js';

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-10-12T17:00:00Z');
const COORD = 'demo-calm-mesa';
const WORKER = 'demo-worker';
const PEER = 'demo-peer';
/** The default stretch opened 20 min ago, short of the escalation stretch. */
const STRETCH_AT = NOW - 20 * MIN;
/** The default held mail was queued exactly COORD_BLOCKED_HELD_MS ago. */
const MAIL_AT = NOW - COORD_BLOCKED_HELD_MS;

type PresentWorker = Extract<StallWorker, { present: true }>;

function runRow(over: Partial<StallRunRow> = {}): StallRunRow {
  return {
    id: 67, kind: 'work', state: 'working', sessionId: WORKER, claimedBy: COORD, dispatchedAt: NOW - 30 * H,
    program: 'demo-program', wave: 2, waveOf: 3, project: 'demo', workspace: 'demo-ws', ...over,
  };
}
function liveAt(word: string, since: number | null, over: Partial<PresentWorker> = {}): PresentWorker {
  return {
    present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 },
    dialogPending: false, stranded: false, swapBlocked: false, live: { ok: true, word, since },
    hookAsk: { kind: 'none' }, askRow: { kind: 'none' }, autoContinueHeldAt: null, ...over,
  };
}
const MARK_BASE: TurnMark = {
  crons: null, sessionId: 'uuid-c', state: 'done', event: 'Stop', at: STRETCH_AT - H, turnAt: STRETCH_AT - H - 20 * MIN,
  stopAt: STRETCH_AT - H, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [],
  lostIds: [], graceUntil: null,
};
function mark(over: Partial<TurnMark> = {}): TurnMarkRead {
  return { ok: true, ...MARK_BASE, ...over };
}
/** A current `working` marker: the coordinator's own turn is running. */
const WORKING = (turnAt = STRETCH_AT): TurnMarkRead => mark({ state: 'working', event: 'PreToolUse', at: turnAt, turnAt, stopAt: null });
function mailRow(id: number, at: number, fromId: string, kind = 'status', runId: number | null = null): StallMailRow {
  return { id, at, runId, fromId, toId: COORD, kind, subject: 's' };
}
function delivery(id: number, mailId: number, over: Partial<StallDeliveryRow> = {}): StallDeliveryRow {
  return { id, mailId, toId: COORD, state: 'queued', deliveredAt: null, ackedAt: null, lastGate: null, gateSince: null, replayCount: 0, ...over };
}

const ALERT: StallArming = { disabled: false, live: true, escalate: true };

interface Over {
  worker?: StallWorker; mark?: TurnMarkRead; mail?: readonly StallMailRow[]; deliveries?: readonly StallDeliveryRow[];
  arming?: StallArming; role?: StallSessionInput['role']; child?: StallCoordBlockedInput['child'];
  runs?: readonly StallRunRow[]; liveStartedAt?: number | null; episode?: StallCoordEpisode | null;
}
/** By default: a coordinator `busy` over a finished turn (the background-workflow case) since STRETCH_AT, holding one
 *  question from its run worker queued at MAIL_AT, which is the shape that must flag at rung 1. */
function input(over: Over = {}): StallCoordBlockedInput {
  const session: StallSessionInput = {
    sessionId: COORD, role: over.role ?? 'coordinator', run: null,
    worker: over.worker ?? liveAt('busy', STRETCH_AT), mark: over.mark ?? mark(),
    liveStartedAt: over.liveStartedAt !== undefined ? over.liveStartedAt : NOW - 30 * H, markUnreadableSince: null,
    mail: over.mail ?? [mailRow(501, MAIL_AT, WORKER, 'question', 67)],
    deliveries: over.deliveries ?? [delivery(901, 501)],
    notices: [], arming: over.arming ?? ALERT, coordinationPaused: false,
  };
  return { session, child: over.child ?? { kind: 'none' }, runs: over.runs ?? [runRow()], episode: over.episode ?? null };
}
const verdict = (i: StallCoordBlockedInput, now = NOW): StallVerdict => stallCoordBlockedStep(i, now).verdict;

const NONE: StallVerdict = { act: 'none' };
const fire = (key: number, rung: 1 | 2 = 1): StallVerdict => ({ act: 'notify', arm: 'coord-blocked', rung, key, to: 'operator' });

describe('coord-blocked: the arm, its wave and its recipient', () => {
  it('is an arm of the watch with two rungs, the flag and its escalation, both to the operator', () => {
    expect(STALL_ARMS).toContain('coord-blocked');
    expect(rungRecipient('coord-blocked', 1)).toBe('operator');
    expect(rungRecipient('coord-blocked', 2)).toBe('operator');
    expect(() => rungRecipient('coord-blocked', 3)).toThrow(RangeError);
  });
  it('follows the Stall watch level: it pushes from Alert up, records only shadow below it, and needs no new marker', () => {
    for (const rung of [1, 2] as const) {
      const at = (level: keyof typeof STALL_LADDER): 'send' | 'shadow' | 'off' => {
        const row = STALL_LADDER[level];
        return row.disabled ? 'off' : stallNotifyDelivery('coord-blocked', rungRecipient('coord-blocked', rung), row);
      };
      expect([at('off'), at('log'), at('check'), at('alert'), at('deliver'), at('all')], `rung ${rung}`)
        .toEqual(['off', 'shadow', 'shadow', 'send', 'send', 'send']);
    }
  });
  it('the thresholds: flag at 30 min held, escalate at a 60 min stretch or a 2 h old mail (see the constants)', () => {
    expect(COORD_BLOCKED_HELD_MS).toBe(30 * MIN);
    expect(COORD_BLOCKED_STRETCH_MS).toBe(60 * MIN);
    expect(COORD_BLOCKED_OLD_MS).toBe(2 * H);
    // Below mail-stuck's own clock, so a coordinator's held mail is named before the generic stuck push would be.
    expect(COORD_BLOCKED_HELD_MS).toBeLessThan(MAIL_STUCK_MS);
  });
  it('a run-less push tagged on the coordinator, the rung and the episode\'s start', () => {
    expect(stallPushRoute({ arm: 'coord-blocked', rung: 1, key: MAIL_AT }, COORD, null))
      .toEqual({ kind: 'run', tag: `stall-${COORD}-coord-blocked-1-${MAIL_AT}` });
    expect(stallPushRoute({ arm: 'coord-blocked', rung: 2, key: MAIL_AT }, COORD, null))
      .toEqual({ kind: 'run', tag: `stall-${COORD}-coord-blocked-2-${MAIL_AT}` });
  });
});

describe('coord-blocked: the gate reason (stallCoordGate), one per measured hold in the census', () => {
  it('waiting: an open dialog, the operator question (the commonest long hold measured)', () => {
    expect(stallCoordGate(input({ worker: liveAt('waiting', STRETCH_AT) }).session)).toBe('waiting');
  });
  it('busy with no turn running: a finished marker under a busy word, the background workflow', () => {
    expect(stallCoordGate(input().session)).toBe('background');
  });
  it('busy with a turn running: a current working marker, its own long busy stretch', () => {
    expect(stallCoordGate(input({ mark: WORKING() }).session)).toBe('busy');
    // A working marker older than the live process is stale: no turn is proven running, so the word is over background work.
    expect(stallCoordGate(input({ mark: mark({ state: 'working', at: NOW - 40 * H, turnAt: NOW - 41 * H, stopAt: null }) }).session)).toBe('background');
  });
  it('idle (or shell) but undelivered: unsent input text or an account limit', () => {
    for (const word of ['idle', 'shell']) expect(stallCoordGate(input({ worker: liveAt(word, STRETCH_AT) }).session), word).toBe('idle');
  });
  it('a word it cannot read names no reason', () => {
    expect(stallCoordGate(input({ worker: liveAt('unknown', STRETCH_AT) }).session)).toBeNull();
    expect(stallCoordGate(input({ worker: liveAt('busy', null) }).session)).toBeNull();
    expect(stallCoordGate(input({ worker: { present: false } }).session)).toBeNull();
  });
});

describe('coord-blocked: the stretch (stallCoordBusySince)', () => {
  it('busy or waiting from the live stamp; a current working marker carries the turn\'s start across flips', () => {
    expect(stallCoordBusySince(input().session)).toBe(STRETCH_AT);
    expect(stallCoordBusySince(input({ worker: liveAt('waiting', STRETCH_AT) }).session)).toBe(STRETCH_AT);
    const turnAt = STRETCH_AT - 2 * H;
    expect(stallCoordBusySince(input({ worker: liveAt('waiting', STRETCH_AT), mark: WORKING(turnAt) }).session)).toBe(turnAt);
  });
  it('at rest or unmeasured: no stretch', () => {
    for (const word of ['idle', 'shell']) expect(stallCoordBusySince(input({ worker: liveAt(word, STRETCH_AT) }).session), word).toBeNull();
    expect(stallCoordBusySince(input({ worker: liveAt('busy', null) }).session)).toBeNull();
  });
});

describe('coord-blocked: each of the four gate reasons flags at the held threshold', () => {
  const cases: readonly [string, Over][] = [
    ['waiting (an open question)', { worker: liveAt('waiting', STRETCH_AT) }],
    ['busy with no turn (a background workflow)', {}],
    ['busy with a turn (its own long busy stretch)', { mark: WORKING() }],
    ['idle but undelivered', { worker: liveAt('idle', STRETCH_AT) }],
    ['idle under an account limit: a limit is one of the holds it reports, never one it waits out', { worker: liveAt('idle', STRETCH_AT, { stranded: true }) }],
  ];
  it.each(cases)('%s', (_label, over) => {
    expect(verdict(input(over))).toEqual(fire(MAIL_AT));
    // One minute short of the held threshold: nothing yet.
    expect(verdict(input({ ...over, mail: [mailRow(501, NOW - COORD_BLOCKED_HELD_MS + MIN, WORKER, 'question', 67)] })))
      .toEqual(NONE);
  });
});

describe('coord-blocked: what counts as held', () => {
  it('a delivery still queued counts from its mail\'s queue time, whoever sent it', () => {
    expect(verdict(input({ mail: [mailRow(501, MAIL_AT, PEER, 'finding')] }))).toEqual(fire(MAIL_AT));
    expect(verdict(input({ mail: [mailRow(501, MAIL_AT, 'operator', 'question')] }))).toEqual(fire(MAIL_AT));
  });
  it('a delivered row whose replay a gate holds counts from the gate\'s own stamp', () => {
    const gated = (gateSince: number): Over => ({
      mail: [mailRow(501, NOW - 5 * H, WORKER, 'question', 67)],
      deliveries: [delivery(901, 501, { state: 'delivered', deliveredAt: NOW - 5 * H, lastGate: 'not-idle', gateSince })],
    });
    expect(verdict(input(gated(NOW - COORD_BLOCKED_HELD_MS)))).toEqual(fire(NOW - COORD_BLOCKED_HELD_MS));
    expect(verdict(input(gated(NOW - COORD_BLOCKED_HELD_MS + MIN)))).toEqual(NONE);
  });
  it('nothing held: no flag (no mail, a delivery through without a gate, acked or rejected, or mail to someone else)', () => {
    expect(verdict(input({ mail: [], deliveries: [] }))).toEqual(NONE);
    for (const state of ['delivered', 'acked', 'rejected']) {
      expect(verdict(input({ deliveries: [delivery(901, 501, { state, deliveredAt: MAIL_AT + MIN })] })), state).toEqual(NONE);
    }
    expect(verdict(input({ deliveries: [delivery(901, 501, { toId: PEER })] }))).toEqual(NONE);
  });
});

describe('coord-blocked: escalation to rung 2', () => {
  it('a busy or waiting stretch of COORD_BLOCKED_STRETCH_MS escalates; one minute short does not', () => {
    for (const word of ['busy', 'waiting']) {
      expect(verdict(input({ worker: liveAt(word, NOW - COORD_BLOCKED_STRETCH_MS) })), word).toEqual(fire(MAIL_AT, 2));
      expect(verdict(input({ worker: liveAt(word, NOW - COORD_BLOCKED_STRETCH_MS + MIN) })), word).toEqual(fire(MAIL_AT, 1));
    }
  });
  it('a held mail COORD_BLOCKED_OLD_MS old escalates, even under an idle coordinator', () => {
    const old = (age: number): Over => ({ worker: liveAt('idle', NOW - 5 * MIN), mail: [mailRow(501, NOW - age, WORKER, 'question', 67)] });
    expect(verdict(input(old(COORD_BLOCKED_OLD_MS)))).toEqual(fire(NOW - COORD_BLOCKED_OLD_MS, 2));
    expect(verdict(input(old(COORD_BLOCKED_OLD_MS - MIN)))).toEqual(fire(NOW - COORD_BLOCKED_OLD_MS + MIN, 1));
  });
  it('an idle coordinator\'s stretch never escalates: idle is no stretch', () => {
    expect(verdict(input({ worker: liveAt('idle', NOW - 5 * H) }))).toEqual(fire(MAIL_AT, 1));
  });
});

describe('coord-blocked: once per episode, recovery, then a new episode', () => {
  it('the first held sighting opens the episode at the oldest held mail, before the flag is due', () => {
    const early = stallCoordBlockedStep(input({ mail: [mailRow(501, NOW - 5 * MIN, WORKER, 'question', 67)] }), NOW);
    expect(early).toEqual({ verdict: NONE, episode: { since: NOW - 5 * MIN, rung: 0 } });
  });
  it('the same episode keeps its key while mail stays held, even after the oldest item is delivered', () => {
    const first = stallCoordBlockedStep(input({
      mail: [mailRow(501, MAIL_AT, WORKER, 'question', 67), mailRow(502, MAIL_AT + 5 * MIN, PEER, 'finding')],
      deliveries: [delivery(901, 501), delivery(902, 502)],
    }), NOW);
    expect(first).toEqual({ verdict: fire(MAIL_AT), episode: { since: MAIL_AT, rung: 1 } });
    // The gate drains one delivery per sweep: 501 goes through, 502 is still held, and it is the same episode.
    const drained = stallCoordBlockedStep(input({
      mail: [mailRow(501, MAIL_AT, WORKER, 'question', 67), mailRow(502, MAIL_AT + 5 * MIN, PEER, 'finding')],
      deliveries: [delivery(901, 501, { state: 'acked', deliveredAt: NOW, ackedAt: NOW }), delivery(902, 502)],
      episode: first.episode,
    }), NOW + MIN);
    expect(drained.verdict).toEqual(fire(MAIL_AT));
    expect(drained.episode).toEqual({ since: MAIL_AT, rung: 1 });
  });
  it('the rung never falls inside an episode: an escalation stands after the stretch ends', () => {
    const escalated = stallCoordBlockedStep(input({ worker: liveAt('busy', NOW - 2 * H) }), NOW);
    expect(escalated.verdict).toEqual(fire(MAIL_AT, 2));
    const after = stallCoordBlockedStep(input({ worker: liveAt('idle', NOW), episode: escalated.episode }), NOW + MIN);
    expect(after).toEqual({ verdict: fire(MAIL_AT, 2), episode: { since: MAIL_AT, rung: 2 } });
  });
  it('recovery (nothing held) closes the episode; new held mail opens a new one under its own key', () => {
    const open: StallCoordEpisode = { since: MAIL_AT, rung: 1 };
    const recovered = stallCoordBlockedStep(input({ deliveries: [delivery(901, 501, { state: 'acked', deliveredAt: NOW, ackedAt: NOW })], episode: open }), NOW);
    expect(recovered).toEqual({ verdict: NONE, episode: null });
    const later = NOW + 3 * H;
    const again = stallCoordBlockedStep(input({
      worker: liveAt('waiting', later - 10 * MIN),
      mail: [mailRow(502, later - COORD_BLOCKED_HELD_MS, WORKER, 'status', 67)], deliveries: [delivery(902, 502)],
      episode: recovered.episode,
    }), later);
    expect(again).toEqual({ verdict: fire(later - COORD_BLOCKED_HELD_MS), episode: { since: later - COORD_BLOCKED_HELD_MS, rung: 1 } });
  });
});

describe('coord-blocked: who is watched, and the holds', () => {
  it('only a coordinator: a child workspace (or one whose child marker cannot be read), an unlisted row, a worker or another row never flags', () => {
    for (const over of [{ child: { kind: 'child', runId: 12 } }, { child: { kind: 'unreadable' } }, { child: { kind: 'unlisted' } },
      { role: 'worker' }, { role: 'other' }] as Over[]) {
      expect(stallCoordBlockedStep(input(over), NOW), JSON.stringify(over)).toEqual({ verdict: NONE, episode: null });
    }
  });
  it('only a coordinator that claims an open run', () => {
    expect(verdict(input({ runs: [] }))).toEqual(NONE);
  });
  it('holds what it cannot measure, keeping the episode; never a dialog and never a limit', () => {
    const open: StallCoordEpisode = { since: MAIL_AT, rung: 1 };
    expect(stallCoordBlockedStep(input({ worker: { present: 'refused' }, episode: open }), NOW))
      .toEqual({ verdict: { act: 'hold', why: 'unmeasured' }, episode: open });
    expect(verdict(input({ worker: { present: false } }))).toEqual({ act: 'hold', why: 'absent' });
    expect(verdict(input({ mark: { ok: false, reason: 'unmeasured' } }))).toEqual({ act: 'hold', why: 'unmeasured' });
    expect(verdict(input({ worker: liveAt('waiting', STRETCH_AT, { dialogPending: true }) }))).toEqual(fire(MAIL_AT));
    expect(verdict(input({ worker: liveAt('busy', STRETCH_AT, { stranded: true }) }))).toEqual(fire(MAIL_AT));
  });
  it('mail-disabled changes nothing: the push is the operator\'s, not mail', () => {
    expect(verdict(input({ arming: { ...ALERT, mailDisabled: true } }))).toEqual(fire(MAIL_AT));
  });
});

describe('coord-blocked: the push text names the gate reason in operator words', () => {
  const n = (rung: 1 | 2 = 1): StallNotify => (rung === 1
    ? { act: 'notify', arm: 'coord-blocked', rung: 1, key: MAIL_AT, to: 'operator' }
    : { act: 'notify', arm: 'coord-blocked', rung: 2, key: MAIL_AT, to: 'operator' });
  const held = {
    mail: [mailRow(501, MAIL_AT, WORKER, 'question', 67), mailRow(502, MAIL_AT + 10 * MIN, PEER, 'finding'),
      mailRow(503, MAIL_AT + 12 * MIN, 'demo-other-child', 'status', 68), mailRow(504, MAIL_AT + 15 * MIN, WORKER, 'status', 67)],
    deliveries: [delivery(901, 501), delivery(902, 502), delivery(903, 503), delivery(904, 504)],
    runs: [runRow(), runRow({ id: 68, sessionId: 'demo-other-child' })],
  };
  it('waiting: the coordinator is waiting on you, with the child mails queued behind it', () => {
    const t = stallCoordBlockedPushText(input({ ...held, worker: liveAt('waiting', STRETCH_AT) }), n(), NOW);
    expect(t.title).toBe(`⚠ coordinator blocked › ${COORD}`);
    expect(t.body).toContain(`coordinator ${COORD}: the coordinator is waiting on you (an open question); 3 child mails are queued behind it.`);
    expect(t.body).toContain('4 items addressed to it are held');
    expect(t.body).toContain(`the oldest, mail #501 question from ${WORKER}, was queued at 2026-10-12T16:30Z (0h 30m ago)`);
    expect(t.body).toContain(`Children waiting: ${WORKER} (run 67), demo-other-child (run 68).`);
    expect(t.body).toContain('It only reports: nothing was interrupted, killed or rerouted.');
  });
  it('busy with no turn: held behind a background workflow', () => {
    expect(stallCoordBlockedPushText(input(held), n(), NOW).body).toContain(`coordinator ${COORD}: held behind a background workflow.`);
  });
  it('busy with a turn: its own long busy stretch', () => {
    expect(stallCoordBlockedPushText(input({ ...held, mark: WORKING() }), n(), NOW).body).toContain(`coordinator ${COORD}: its own long busy stretch.`);
  });
  it('idle: idle but not receiving mail', () => {
    expect(stallCoordBlockedPushText(input({ ...held, worker: liveAt('idle', STRETCH_AT) }), n(), NOW).body)
      .toContain(`coordinator ${COORD}: idle but not receiving mail (input text or account limit).`);
  });
  it('rung 2 says it is escalated, and says how long the stretch has run', () => {
    const t = stallCoordBlockedPushText(input({ ...held, worker: liveAt('busy', NOW - 90 * MIN) }), n(2), NOW);
    expect(t.title).toBe(`⚠ coordinator blocked (escalated) › ${COORD}`);
    expect(t.body).toContain('Escalated: busy or waiting since 2026-10-12T15:30Z (1h 30m).');
  });
  it('says no child waits when only peers or the system hold mail', () => {
    const t = stallCoordBlockedPushText(input({ mail: [mailRow(501, MAIL_AT, PEER, 'finding')] }), n(), NOW);
    expect(t.body).toContain('1 item addressed to it is held');
    expect(t.body).toContain('No run worker of it is among the senders.');
  });
  it('prints no hostile id: an id outside the id pattern prints as unprintable', () => {
    const t = stallCoordBlockedPushText(input({ mail: [mailRow(501, MAIL_AT, 'bad id; rm', 'question')] }), n(), NOW);
    expect(t.body).not.toContain('bad id; rm');
    expect(t.body).toContain('(unprintable)');
  });
});
