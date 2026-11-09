// The coord-ball mail rung's decider (design 2026-11-09 §8.3 items 1 and 2): an idle coordinator that claims open runs
// and holds the ball is mailed after COORD_BALL_MAIL_MS (rung 2), once more after COORD_BALL_MAIL_AGAIN_MS (rung 3),
// never a third time. Each hold alone makes it none. Pure: every input is built by the factories below.
import { describe, it, expect } from 'vitest';
import {
  COORD_BALL_CAP_MS, COORD_BALL_MAIL_AGAIN_MS, COORD_BALL_MAIL_MS, rungRecipient, stallCoordBallMail, stallCoordBallMailStep,
  stallMailClass, stallNotifyDelivery, stallRungWave, stallSessionMail,
} from '../src/coord/stall.js';
import type {
  StallArming, StallCoordBallInput, StallDeliveryRow, StallMailRow, StallNotify, StallRunRow, StallSessionInput, StallVerdict, StallWorker, TurnMark,
} from '../src/coord/stall.js';

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-11-09T12:00:00Z');
const COORD = 'demo-calm-mesa';
const BALL = NOW - COORD_BALL_MAIL_MS;
const W2: StallArming = { disabled: false, live: true, escalate: true, w2Live: true };
const DARK: StallArming = { disabled: false, live: true, escalate: true };

type PresentWorker = Extract<StallWorker, { present: true }>;
function live(word: string, since: number | null): PresentWorker {
  return {
    present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 }, dialogPending: false,
    stranded: false, swapBlocked: false, live: { ok: true, word, since }, hookAsk: { kind: 'none' }, askRow: { kind: 'none' },
    autoContinueHeldAt: null,
  };
}
const MARK: TurnMark = {
  crons: null, sessionId: 'uuid-c', state: 'done', event: 'Stop', at: BALL - H, turnAt: BALL - H - 20 * MIN, stopAt: BALL - H,
  bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null,
};
function run(over: Partial<StallRunRow> = {}): StallRunRow {
  return {
    id: 67, kind: 'work', state: 'reviewing', sessionId: 'demo-worker', claimedBy: COORD, dispatchedAt: NOW - 30 * H,
    program: 'demo-program', wave: 2, waveOf: 3, project: 'demo', workspace: 'demo-ws', ...over,
  };
}
function delivery(over: Partial<StallDeliveryRow> = {}): StallDeliveryRow {
  return { id: 1, mailId: 1, toId: COORD, state: 'acked', deliveredAt: BALL, ackedAt: BALL, lastGate: null, gateSince: null, replayCount: 0, ...over };
}
function sent(rung: 2 | 3, key: number, at: number): StallMailRow {
  return { id: at, at, runId: null, fromId: 'operator', toId: COORD, kind: 'status', subject: stallCoordBallMail({ key, rung }).subject };
}
interface Over {
  word?: string; since?: number; mail?: readonly StallMailRow[]; deliveries?: readonly StallDeliveryRow[]; arming?: StallArming;
  paused?: boolean; runs?: readonly StallRunRow[]; blockingItem?: boolean; liveBlock?: boolean; waitSentAt?: number | null;
  ballSince?: number | null;
}
function input(over: Over = {}): StallCoordBallInput {
  const session: StallSessionInput = {
    sessionId: COORD, role: 'coordinator', run: null, worker: live(over.word ?? 'idle', over.since ?? BALL),
    mark: { ok: true, ...MARK }, liveStartedAt: NOW - 30 * H, markUnreadableSince: null, mail: over.mail ?? [],
    deliveries: over.deliveries ?? [], notices: [], arming: over.arming ?? W2, coordinationPaused: over.paused ?? false,
  };
  return {
    session, runs: over.runs ?? [run()], blockingItem: over.blockingItem ?? false, liveBlock: over.liveBlock ?? false,
    waitSentAt: over.waitSentAt ?? null, ballSince: over.ballSince !== undefined ? over.ballSince : BALL,
  };
}
const NONE: StallVerdict = { act: 'none' };
const rung = (r: 2 | 3, key = BALL): StallNotify => ({ act: 'notify', arm: 'coord-ball', rung: r, key, to: 'worker' });

describe('stallCoordBallMailStep: rung 2', () => {
  it('idle 19 minutes is none; 20 minutes with nothing else is rung 2 to the session itself', () => {
    expect(stallCoordBallMailStep(input({ ballSince: NOW - (COORD_BALL_MAIL_MS - MIN) }), NOW)).toEqual(NONE);
    expect(stallCoordBallMailStep(input(), NOW)).toEqual(rung(2));
  });
  it.each([
    ['a dispatched run', { runs: [run({ state: 'dispatched' })] }],
    ['a working run', { runs: [run({ state: 'working' })] }],
    ['an open review run', { runs: [run({ state: 'reviewing' }), run({ id: 68, kind: 'review', state: 'reviewing' })] }],
    ['a run at merging', { runs: [run({ state: 'merging' })] }],
    ['an open blocking item', { blockingItem: true }],
    ['a live block row', { liveBlock: true }],
    ['a wait: mail after the ball', { waitSentAt: BALL + MIN }],
    ['a wait: mail that is the ball itself', { waitSentAt: BALL }],
    ['coordination paused', { paused: true }],
    ['a held mail', { deliveries: [delivery({ state: 'queued', deliveredAt: null, ackedAt: null })] }],
    ['no claimed run', { runs: [] }],
    ['no ball time', { ballSince: null }],
    ['a busy word', { word: 'busy' }],
    ['a waiting word', { word: 'waiting' }],
  ] as [string, Over][])('%s alone makes it none', (_n, over) => {
    expect(stallCoordBallMailStep(input(over), NOW)).toEqual(NONE);
  });
  it('a wait: mail from before the ball does not hold it', () => {
    expect(stallCoordBallMailStep(input({ waitSentAt: BALL - MIN }), NOW)).toEqual(rung(2));
  });
  it('a delivered mail is not a held mail', () => {
    expect(stallCoordBallMailStep(input({ deliveries: [delivery()] }), NOW)).toEqual(rung(2));
  });
  it('mail-disabled holds the live send and passes a shadow one', () => {
    expect(stallCoordBallMailStep(input({ arming: { ...W2, mailDisabled: true } }), NOW)).toEqual({ act: 'hold', why: 'mail-disabled' });
    expect(stallCoordBallMailStep(input({ arming: { ...DARK, mailDisabled: true } }), NOW)).toEqual(rung(2));
  });
});

describe('stallCoordBallMailStep: rung 3 and never a third', () => {
  const done2 = (ago: number): StallMailRow[] => [sent(2, BALL, NOW - ago)];
  it('rung 2 done 29 minutes ago is none, 30 minutes ago is rung 3', () => {
    const since = NOW - 40 * MIN;
    expect(stallCoordBallMailStep(input({ mail: done2(COORD_BALL_MAIL_AGAIN_MS - MIN), since }), NOW)).toEqual(NONE);
    expect(stallCoordBallMailStep(input({ mail: done2(COORD_BALL_MAIL_AGAIN_MS), since }), NOW)).toEqual(rung(3));
  });
  it('a turn since rung 2 (the idle stamp is newer) is none', () => {
    expect(stallCoordBallMailStep(input({ mail: done2(COORD_BALL_MAIL_AGAIN_MS), since: NOW - 5 * MIN }), NOW)).toEqual(NONE);
  });
  it('rung 3 done is none', () => {
    const mail = [...done2(COORD_BALL_MAIL_AGAIN_MS + 20 * MIN), sent(3, BALL, NOW - 20 * MIN)];
    expect(stallCoordBallMailStep(input({ mail, since: NOW - H }), NOW)).toEqual(NONE);
  });
  it('a row on another key does not count as done', () => {
    expect(stallCoordBallMailStep(input({ mail: [sent(2, BALL - H, NOW - MIN)] }), NOW)).toEqual(rung(2));
  });
});

describe('the rung is wave 2: dark until stall-watch-w2-live', () => {
  it('rungs 2 and 3 are wave 2, rung 1 wave 1, every other arm reads its table', () => {
    expect(stallRungWave('coord-ball', 1)).toBe(1);
    expect(stallRungWave('coord-ball', 2)).toBe(2);
    expect(stallRungWave('coord-ball', 3)).toBe(2);
    expect(stallRungWave('quiet', 3)).toBe(1);
    expect(stallRungWave('dead', 1)).toBe(2);
  });
  it('recipients are the operator, then the session twice', () => {
    expect([1, 2, 3].map((r) => rungRecipient('coord-ball', r as 1 | 2 | 3))).toEqual(['operator', 'worker', 'worker']);
  });
  it('rung 2 is shadow without w2Live, rung 1 unchanged', () => {
    expect(stallNotifyDelivery('coord-ball', 'worker', DARK, 2)).toBe('shadow');
    expect(stallNotifyDelivery('coord-ball', 'worker', W2, 2)).toBe('send');
    expect(stallNotifyDelivery('coord-ball', 'operator', DARK, 1)).toBe(stallNotifyDelivery('coord-ball', 'operator', { ...DARK, w2Live: true }, 1));
    expect(stallNotifyDelivery('coord-ball', 'operator', { ...DARK, escalate: false }, 1)).toBe('shadow');
  });
  it('a run-less shadow rung records no mail, so it is never done: rung 2 is returned again, harmlessly', () => {
    expect(stallCoordBallMailStep(input({ arming: DARK }), NOW)).toEqual(rung(2));
    expect(stallCoordBallMailStep(input({ arming: DARK, since: NOW - 40 * MIN }), NOW)).toEqual(rung(2));
  });
  it('a sent rung-2 mail is done, and rung 3 is reachable because its subject differs from rung 2', () => {
    const mail = [sent(2, BALL, NOW - COORD_BALL_MAIL_AGAIN_MS)];
    expect(stallCoordBallMailStep(input({ arming: W2, mail, since: NOW - H }), NOW)).toEqual(rung(3));
    expect(stallCoordBallMailStep(input({ arming: W2, mail: [...mail, sent(3, BALL, NOW - MIN)], since: NOW - H }), NOW)).toEqual(NONE);
  });
  it('the two rungs never share a subject', () => {
    expect(stallCoordBallMail({ key: BALL, rung: 2 }).subject).not.toBe(stallCoordBallMail({ key: BALL, rung: 3 }).subject);
  });
});

describe('the notice', () => {
  it('reads as the watch\'s own notice and says what to do', () => {
    const t = stallCoordBallMail({ key: BALL, rung: 2 });
    expect(t.subject).toBe(`stall:coord-ball:${BALL}:r2`);
    expect(t.body).toBe('You have open runs and nothing waits on the operator. Continue per coordinator clause 21; re-read `runs list` and `goals show`.');
    expect(stallSessionMail(input().session, rung(2), NOW)).toEqual(t);
  });
  it('the operator cap still fires at COORD_BALL_CAP_MS (cap constant unchanged)', () => {
    expect(COORD_BALL_CAP_MS).toBe(30 * H);
  });
  it('stallMailClass reads the subject as the watch\'s own notice', () => {
    const t = stallCoordBallMail({ key: BALL, rung: 3 });
    expect(stallMailClass({ fromId: 'operator', runId: null, subject: t.subject, mailId: 1 })).toBe('report');
  });
});
