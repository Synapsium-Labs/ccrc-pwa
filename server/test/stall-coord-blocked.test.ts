// The stall watch's coordinator-blocked arm (operator ruling 2026-10-25, D-TBD-coord-blocked-stall): a coordinator
// whose turn has stayed open (live `busy` or `waiting`) past COORD_BLOCKED_BUSY_MS while mail addressed to it has
// waited undelivered behind that turn past COORD_BLOCKED_HELD_MS. One operator push per episode, keyed on the moment
// the turn opened; it only reports. The pure half: every input is built by the factories below and every clock is
// an argument. Each threshold is read by its constant's name, so a boundary row is `constant ± 1 min`.
import { describe, it, expect } from 'vitest';
import {
  COORD_BLOCKED_BUSY_MS, COORD_BLOCKED_HELD_MS, MAIL_STUCK_MS, STALL_ARMS, rungRecipient, stallCoordBlockedPushText,
  stallCoordBlockedVerdict, stallCoordBusySince, stallNotifyDelivery, stallPushRoute,
} from '../src/coord/stall.js';
import type {
  StallArming, StallCoordBlockedInput, StallDeliveryRow, StallMailRow, StallRunRow, StallSessionInput, StallVerdict,
  StallWorker, TurnMark, TurnMarkRead,
} from '../src/coord/stall.js';
import { STALL_LADDER } from '../src/coord/stallsettings.js';

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-10-12T17:00:00Z');
const COORD = 'demo-calm-mesa';
const WORKER = 'demo-worker';
const PEER = 'demo-peer';
/** The turn opened here: a background-workflow launch, as in the census's 7.6 h incident. */
const BUSY_AT = NOW - 7 * H;

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
  crons: null, sessionId: 'uuid-c', state: 'done', event: 'Stop', at: BUSY_AT - H, turnAt: BUSY_AT - H - 20 * MIN,
  stopAt: BUSY_AT - H, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [],
  lostIds: [], graceUntil: null,
};
function mark(over: Partial<TurnMark> = {}): TurnMarkRead {
  return { ok: true, ...MARK_BASE, ...over };
}
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
  runs?: readonly StallRunRow[]; liveStartedAt?: number | null;
}
/** By default: a coordinator busy since BUSY_AT, holding one question from its run worker queued an hour after the
 *  turn opened, which is the shape that must flag. */
function input(over: Over = {}): StallCoordBlockedInput {
  const session: StallSessionInput = {
    sessionId: COORD, role: over.role ?? 'coordinator', run: null,
    worker: over.worker ?? liveAt('busy', BUSY_AT), mark: over.mark ?? mark(),
    liveStartedAt: over.liveStartedAt !== undefined ? over.liveStartedAt : NOW - 30 * H, markUnreadableSince: null,
    mail: over.mail ?? [mailRow(501, BUSY_AT + H, WORKER, 'question', 67)],
    deliveries: over.deliveries ?? [delivery(901, 501)],
    notices: [], arming: over.arming ?? ALERT, coordinationPaused: false,
  };
  return { session, child: over.child ?? { kind: 'none' }, runs: over.runs ?? [runRow()] };
}

const NONE: StallVerdict = { act: 'none' };
const fire = (key: number): StallVerdict => ({ act: 'notify', arm: 'coord-blocked', rung: 1, key, to: 'operator' });

describe('coord-blocked: the arm, its wave and its recipient', () => {
  it('is an arm of the watch, with one rung, to the operator', () => {
    expect(STALL_ARMS).toContain('coord-blocked');
    expect(rungRecipient('coord-blocked', 1)).toBe('operator');
    expect(() => rungRecipient('coord-blocked', 2)).toThrow(RangeError);
  });
  it('follows the Stall watch level: it pushes from Alert up, records only shadow below it, and needs no new marker', () => {
    const at = (level: keyof typeof STALL_LADDER): 'send' | 'shadow' | 'off' => {
      const row = STALL_LADDER[level];
      return row.disabled ? 'off' : stallNotifyDelivery('coord-blocked', 'operator', row);
    };
    expect([at('off'), at('log'), at('check'), at('alert'), at('deliver'), at('all')])
      .toEqual(['off', 'shadow', 'shadow', 'send', 'send', 'send']);
  });
  it('the thresholds are an hour each, measured from the 14-day held-mail census (see the constants)', () => {
    expect(COORD_BLOCKED_BUSY_MS).toBe(60 * MIN);
    expect(COORD_BLOCKED_HELD_MS).toBe(60 * MIN);
    // Below mail-stuck's own clock, so a coordinator's long turn is named before the generic stuck push would be.
    expect(COORD_BLOCKED_HELD_MS).toBeLessThan(MAIL_STUCK_MS);
  });
  it('a run-less push tagged on the coordinator and the turn\'s opening, so one episode is one tray entry', () => {
    expect(stallPushRoute({ arm: 'coord-blocked', rung: 1, key: BUSY_AT }, COORD, null))
      .toEqual({ kind: 'run', tag: `stall-${COORD}-coord-blocked-1-${BUSY_AT}` });
  });
});

describe('coord-blocked: when the turn opened (stallCoordBusySince)', () => {
  it('a live busy word with a finished marker: the word\'s own stamp (the background-workflow case)', () => {
    expect(stallCoordBusySince(input().session)).toBe(BUSY_AT);
  });
  it('a dialog (`waiting`) is an open turn too: the operator-question hold, the commonest long hold measured', () => {
    expect(stallCoordBusySince(input({ worker: liveAt('waiting', BUSY_AT) }).session)).toBe(BUSY_AT);
  });
  it('a current working marker carries the turn\'s start across busy↔waiting flips', () => {
    const turnAt = BUSY_AT - 2 * H;
    const s = input({ worker: liveAt('waiting', BUSY_AT), mark: mark({ state: 'working', event: 'PreToolUse', at: BUSY_AT, turnAt, stopAt: null }) }).session;
    expect(stallCoordBusySince(s)).toBe(turnAt);
  });
  it('a working marker older than the live process is stale and does not move the start', () => {
    const s = input({ mark: mark({ state: 'working', at: NOW - 40 * H, turnAt: NOW - 41 * H, stopAt: null }) }).session;
    expect(stallCoordBusySince(s)).toBe(BUSY_AT);
  });
  it('at rest (idle or shell) or unmeasured: no open turn', () => {
    for (const word of ['idle', 'shell']) expect(stallCoordBusySince(input({ worker: liveAt(word, BUSY_AT) }).session), word).toBeNull();
    expect(stallCoordBusySince(input({ worker: liveAt('busy', null) }).session)).toBeNull();
    expect(stallCoordBusySince(input({ worker: { present: false } }).session)).toBeNull();
  });
});

describe('coord-blocked: the verdict', () => {
  it('busy long + held mail: flags, keyed on the turn\'s opening', () => {
    expect(stallCoordBlockedVerdict(input(), NOW)).toEqual(fire(BUSY_AT));
  });
  it('busy long without held mail: no flag (nothing queued, or every delivery already through)', () => {
    expect(stallCoordBlockedVerdict(input({ mail: [], deliveries: [] }), NOW)).toEqual(NONE);
    for (const state of ['delivered', 'acked', 'rejected']) {
      expect(stallCoordBlockedVerdict(input({ deliveries: [delivery(901, 501, { state, deliveredAt: BUSY_AT + H })] }), NOW), state).toEqual(NONE);
    }
    // A delivery to someone else is not held mail of this coordinator.
    expect(stallCoordBlockedVerdict(input({ deliveries: [delivery(901, 501, { toId: PEER })] }), NOW)).toEqual(NONE);
  });
  it('held mail with an idle coordinator: no flag (a delivery problem, which mail stuck owns)', () => {
    for (const word of ['idle', 'shell']) {
      expect(stallCoordBlockedVerdict(input({ worker: liveAt(word, BUSY_AT) }), NOW), word).toEqual(NONE);
    }
  });
  it('the busy threshold: one minute short holds nothing; at COORD_BLOCKED_BUSY_MS it flags', () => {
    const since = (ms: number): Over => ({ worker: liveAt('busy', NOW - ms), mail: [mailRow(501, NOW - 3 * H, WORKER, 'question', 67)] });
    expect(stallCoordBlockedVerdict(input(since(COORD_BLOCKED_BUSY_MS - MIN)), NOW)).toEqual(NONE);
    expect(stallCoordBlockedVerdict(input(since(COORD_BLOCKED_BUSY_MS)), NOW)).toEqual(fire(NOW - COORD_BLOCKED_BUSY_MS));
  });
  it('the held threshold counts from the later of the queue and the turn\'s opening, so mail queued before the turn is not double-counted', () => {
    const queued = (at: number): Over => ({ mail: [mailRow(501, at, WORKER, 'question', 67)] });
    expect(stallCoordBlockedVerdict(input(queued(NOW - COORD_BLOCKED_HELD_MS + MIN)), NOW)).toEqual(NONE);
    expect(stallCoordBlockedVerdict(input(queued(NOW - COORD_BLOCKED_HELD_MS)), NOW)).toEqual(fire(BUSY_AT));
    // Queued 20 h ago, long before the turn opened: it has waited behind THIS turn for 7 h, which counts.
    expect(stallCoordBlockedVerdict(input(queued(NOW - 20 * H)), NOW)).toEqual(fire(BUSY_AT));
    // The turn opened 61 min ago and the mail was queued 20 h ago: 61 min behind this turn, past both thresholds.
    const fresh = { worker: liveAt('busy', NOW - COORD_BLOCKED_BUSY_MS - MIN), ...queued(NOW - 20 * H) };
    expect(stallCoordBlockedVerdict(input(fresh), NOW)).toEqual(fire(NOW - COORD_BLOCKED_BUSY_MS - MIN));
  });
  it('any held mail counts, a peer\'s or a system ask brief as much as a child\'s', () => {
    expect(stallCoordBlockedVerdict(input({ mail: [mailRow(501, BUSY_AT + H, PEER, 'finding')] }), NOW)).toEqual(fire(BUSY_AT));
    expect(stallCoordBlockedVerdict(input({ mail: [mailRow(501, BUSY_AT + H, 'operator', 'question')] }), NOW)).toEqual(fire(BUSY_AT));
  });
  it('a new episode after recovery flags again, under its own key', () => {
    const later = NOW + 5 * H;
    const again = input({ worker: liveAt('busy', NOW + H), mail: [mailRow(502, NOW + 2 * H, WORKER, 'status', 67)], deliveries: [delivery(902, 502)] });
    expect(stallCoordBlockedVerdict(again, later)).toEqual(fire(NOW + H));
  });
  it('only a coordinator: a child workspace (or one whose child marker cannot be read), an unlisted row, a worker or another row never flags', () => {
    expect(stallCoordBlockedVerdict(input({ child: { kind: 'child', runId: 12 } }), NOW)).toEqual(NONE);
    expect(stallCoordBlockedVerdict(input({ child: { kind: 'unreadable' } }), NOW)).toEqual(NONE);
    expect(stallCoordBlockedVerdict(input({ child: { kind: 'unlisted' } }), NOW)).toEqual(NONE);
    expect(stallCoordBlockedVerdict(input({ role: 'worker' }), NOW)).toEqual(NONE);
    expect(stallCoordBlockedVerdict(input({ role: 'other' }), NOW)).toEqual(NONE);
  });
  it('only a coordinator that claims an open run', () => {
    expect(stallCoordBlockedVerdict(input({ runs: [] }), NOW)).toEqual(NONE);
  });
  it('holds what it cannot measure, and a usage limit, but never a dialog: a dialog is one of the turns it reports', () => {
    expect(stallCoordBlockedVerdict(input({ worker: { present: 'refused' } }), NOW)).toEqual({ act: 'hold', why: 'unmeasured' });
    expect(stallCoordBlockedVerdict(input({ worker: { present: false } }), NOW)).toEqual({ act: 'hold', why: 'absent' });
    expect(stallCoordBlockedVerdict(input({ mark: { ok: false, reason: 'unmeasured' } }), NOW)).toEqual({ act: 'hold', why: 'unmeasured' });
    expect(stallCoordBlockedVerdict(input({ worker: liveAt('busy', BUSY_AT, { stranded: true }) }), NOW)).toEqual({ act: 'hold', why: 'limit' });
    expect(stallCoordBlockedVerdict(input({ worker: liveAt('waiting', BUSY_AT, { dialogPending: true }) }), NOW)).toEqual(fire(BUSY_AT));
  });
  it('mail-disabled changes nothing: the push is the operator\'s, not mail', () => {
    expect(stallCoordBlockedVerdict(input({ arming: { ...ALERT, mailDisabled: true } }), NOW)).toEqual(fire(BUSY_AT));
  });
});

describe('coord-blocked: the push text', () => {
  const n = { act: 'notify', arm: 'coord-blocked', rung: 1, key: BUSY_AT, to: 'operator' } as const;
  it('names the coordinator, how long it has been busy, the oldest held item and its age, and the children waiting', () => {
    const i = input({
      mail: [mailRow(501, BUSY_AT + H, WORKER, 'question', 67), mailRow(502, BUSY_AT + 10 * MIN, PEER, 'finding'),
        mailRow(503, BUSY_AT + 2 * H, 'demo-other-child', 'status', 68), mailRow(504, BUSY_AT + 3 * H, WORKER, 'status', 67)],
      deliveries: [delivery(901, 501), delivery(902, 502), delivery(903, 503), delivery(904, 504)],
      runs: [runRow(), runRow({ id: 68, sessionId: 'demo-other-child' })],
    });
    const t = stallCoordBlockedPushText(i, n, NOW);
    expect(t.title).toBe(`⚠ coordinator blocked › ${COORD}`);
    expect(t.body).toContain(`coordinator ${COORD}`);
    expect(t.body).toContain('busy since 2026-10-12T10:00Z (7h 0m)');
    expect(t.body).toContain('4 items addressed to it wait undelivered');
    expect(t.body).toContain(`the oldest, mail #502 finding from ${PEER}, was queued at 2026-10-12T10:10Z (6h 50m ago)`);
    expect(t.body).toContain(`Children waiting: ${WORKER} (run 67), demo-other-child (run 68).`);
    expect(t.body).toContain('It only reports: nothing was interrupted, killed or rerouted.');
  });
  it('says the dialog when the turn is one, and says no child waits when only peers or the system hold mail', () => {
    const t = stallCoordBlockedPushText(input({ worker: liveAt('waiting', BUSY_AT), mail: [mailRow(501, BUSY_AT + H, PEER, 'finding')] }), n, NOW);
    expect(t.body).toContain('waiting on a dialog since 2026-10-12T10:00Z');
    expect(t.body).toContain('1 item addressed to it waits undelivered');
    expect(t.body).toContain('No run worker of it is among the senders.');
  });
  it('prints no hostile id: an id outside the id pattern prints as unprintable', () => {
    const t = stallCoordBlockedPushText(input({ mail: [mailRow(501, BUSY_AT + H, 'bad id; rm', 'question')] }), n, NOW);
    expect(t.body).not.toContain('bad id; rm');
    expect(t.body).toContain('(unprintable)');
  });
});
