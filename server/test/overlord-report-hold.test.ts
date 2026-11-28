// A report to the Overlord (request ids A, RI6 and RI17): a mail row to the role `overlord` from a session that is no role sender is
// held by the mail sweep at the head of its loop (`heldUntilAcked`, the fixed-line row `overlord-report`, `hold: 'acked'`): never
// typed, never gated, never counted, never woken or parked, read again each sweep until it is acked; and recorded, never pushed
// (`push: 'record-only'`). Driven through the real mail sweep and the real push path over a fixture coord.db, as
// `overlord-timer-line-lane.test.ts` and `overlord-prompt-record.test.ts` drive theirs. The designation is spied except in the
// rebind and retire endings, which go through the real designation writers (a fake authority appender). Fixture HOMEs only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NotifyLog } from '../src/notifylog.js';
import type { CoordStore } from '../src/coord/store.js';
import { renderMailNudge, FIXED_LINE_MAIL, fixedLinePushOf, heldDeliveryIdsOf, heldUntilAcked } from '../src/coord/envelope.js';
import { mailHoldsSleep } from '../src/sleep.js';
import { stallMailStuckVerdicts } from '../src/coord/stall.js';
import type { StallArming, StallSessionInput, StallWorker, TurnMark, TurnMarkRead } from '../src/coord/stall.js';
import type { AuthorityAppender } from '../src/coord/overlordDesignationStore.js';
import type { AuthorityAppend } from '../src/coord/overlordAuthorityJournal.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { TIMER_MAIL_SENDER } from '../../shared/continuity-timers.js';
import { TERMINAL_REQUEST_STATES } from '../../shared/overlordRequests.js';
import { operatorMessageSubject } from '../../shared/operatorMessages.js';
import { providerRetrySubject } from '../../shared/provider-retry.js';
import { INBOX_WAKE_SUBJECT, renderInboxWakeBody } from '../../shared/overlordInbox.js';
import { SPOT_PROBE_SUBJECT } from '../src/continuity/renewalFeed.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { callsIn, sourceOfSymbol, symbolOf } from './scan/symbols.js';
import { ID, PEER, NOW, emptyBox, echoedBox, seedRegistry, literalSends, keyPresses, sendCalls, primed, designate, queueMail, rowOf,
  sweepFar, sweepMany, expectUntouched } from './helpers/reportHoldSweep.js';

const SUBJECT = 'report: request 7 is done';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); removeTmpFixtures(); });
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });

/** A report: mail from a session to the role, one delivery queued to `session`. */
const queueReport = (coord: CoordStore, session: string = ID, fromId = PEER): { mailId: number; id: number } => {
  const mail = coord.insertMail({ fromId, fromUuid: 'u-peer', toId: 'overlord', runId: null, kind: 'status', subject: SUBJECT, body: 'the work is done', artifacts: [] });
  return { mailId: mail.id, id: coord.queueDelivery(mail.id, session, 'ccrc-mail test payload').id };
};

describe('a report to the Overlord is held by the mail sweep', () => {
  it('1. delivered to the bound session: never typed, attempts 0, no gate, still queued, never delivered, over 30 sweeps past every back-off and the replay window', async () => {
    const { h, coord, w } = await primed([emptyBox]);
    designate(coord, ID);
    const { id } = queueReport(coord);
    const before = rowOf(coord, id);
    expect(before.state).toBe('queued');
    await sweepMany(w, 30);
    expect(sendCalls(h.calls)).toEqual([]);
    expect(h.calls.some((a) => a[0] === 'capture-pane')).toBe(false);   // not even a box read: held before every gate
    expectUntouched(coord, id, before);
  });

  it('2a. delivered to a session whose registry row is gone: never gated (registry-absent), never parked, never woken, never typed', async () => {
    const { h, coord, w } = await primed([emptyBox], { seed: false });
    designate(coord, 'lane-z-project-a');                         // the body bound since is another session
    const { id } = queueReport(coord, ID);                        // the delivery names a body whose registry row is absent
    const before = rowOf(coord, id);
    await sweepMany(w, 30);
    expect(sendCalls(h.calls)).toEqual([]);
    expectUntouched(coord, id, before);
    expect(rowOf(coord, id).lastGate).not.toBe('registry-absent');
    expect(coord.parkedDeliveries().some((p: { id: number }) => p.id === id)).toBe(false);
  });

  it('2b. delivered to a session the registry lists but tmux says is dead: never gated (session-dead), never parked, never typed', async () => {
    const { h, coord, w } = await primed([emptyBox], { dead: true });
    designate(coord, ID);
    const { id } = queueReport(coord);
    const before = rowOf(coord, id);
    await sweepMany(w, 30);
    expect(sendCalls(h.calls)).toEqual([]);
    expectUntouched(coord, id, before);
    expect(coord.parkedDeliveries().some((p: { id: number }) => p.id === id)).toBe(false);
  });

  it('2c. delivered to a body the designation retired since (another session is bound now): held all the same', async () => {
    const { h, coord, w } = await primed([emptyBox]);
    designate(coord, 'lane-z-project-a');
    const { id } = queueReport(coord, ID);
    const before = rowOf(coord, id);
    await sweepMany(w, 30);
    expect(sendCalls(h.calls)).toEqual([]);
    expectUntouched(coord, id, before);
  });

  it('3. delivered to the role word itself (no body bound): held, never typed, never gated, never parked', async () => {
    const { h, coord, w } = await primed([emptyBox]);              // an empty database: nothing is designated
    expect(coord.designationRead().kind).not.toBe('designated');
    const { id } = queueReport(coord, 'overlord');
    const before = rowOf(coord, id);
    await sweepMany(w, 30);
    expect(sendCalls(h.calls)).toEqual([]);
    expectUntouched(coord, id, before);
    expect(coord.parkedDeliveries().some((p: { id: number }) => p.id === id)).toBe(false);
  });

  it('3b. the pure rule: only a session sender\'s mail to the role holds; a role sender\'s mail to the role, a mail to a session and an unread origin do not', () => {
    const d = { kind: 'not-designated' } as never;
    const origin = (fromId: string, toId: string) => ({ fromId, subject: SUBJECT, toId });
    expect(heldUntilAcked('overlord', origin(PEER, 'overlord'), d)).toBe(true);
    expect(heldUntilAcked(ID, origin(PEER, 'overlord'), d)).toBe(true);
    expect(heldUntilAcked(ID, origin(PEER, ID), d)).toBe(false);
    expect(heldUntilAcked(ID, origin('operator', 'overlord'), d)).toBe(false);
    expect(heldUntilAcked(ID, null, d)).toBe(false);
  });
});

describe('what is not held', () => {
  it('4a. an ordinary peer mail to the same session in the same sweep is typed as today, beside the untouched held report', async () => {
    const nudge = renderMailNudge(ID);
    const { h, coord, w } = await primed([emptyBox, echoedBox(nudge), emptyBox]);
    designate(coord, ID);
    const report = queueReport(coord);
    const before = rowOf(coord, report.id);
    const peer = queueMail(coord, PEER, ID, ID, 'ordinary news');
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([nudge]);
    expect(rowOf(coord, peer.id).state).toBe('delivered');
    expectUntouched(coord, report.id, before);
  });

  it('4b. the timer row\'s mail (from the timer, to the role) still waits for the card as before: nothing typed, no attempt, no gate stamp, queued', async () => {
    const { h, coord, w } = await primed([emptyBox, emptyBox, emptyBox]);
    designate(coord, ID);                                          // no generation minted, no card read: the card hold stands
    const timer = queueMail(coord, TIMER_MAIL_SENDER, 'overlord', ID, 'timer: 2 due');
    const before = rowOf(coord, timer.id);
    await w.sweepMail();
    await sweepFar(w);
    expect(literalSends(h.calls)).toEqual([]);
    expect(keyPresses(h.calls)).toEqual([]);
    expect(rowOf(coord, timer.id)).toEqual(before);
    expect(before.attempts).toBe(0);
    expect(before.lastGate).toBeNull();
  });

  it('4c. the table: the timer row holds on `card`, the report row on `acked` and records only; the four older rows hold nothing', () => {
    const by = Object.fromEntries(FIXED_LINE_MAIL.map((r) => [r.name, { hold: r.hold, push: r.push }]));
    expect(by).toEqual({
      'operator-message': { hold: undefined, push: undefined },
      'spot-probe': { hold: undefined, push: undefined },
      'inbox-wake': { hold: undefined, push: undefined },
      'provider-retry': { hold: undefined, push: undefined },
      timer: { hold: 'card', push: undefined },
      'overlord-report': { hold: 'acked', push: 'record-only' },
    });
  });
});

describe('the kill switches', () => {
  for (const marker of ['mail-disabled', 'coordinator-paused']) {
    it(`5. with ${marker} standing a held report is neither typed nor marked, and acking it through markAcked still ends it`, async () => {
      const { h, coord, w } = await primed([emptyBox]);
      designate(coord, ID);
      const { id } = queueReport(coord);
      const before = rowOf(coord, id);
      writeFileSync(path.join(h.home, '.cc-sessions', marker), '');
      await sweepMany(w, 5);
      expect(sendCalls(h.calls)).toEqual([]);
      expectUntouched(coord, id, before);
      expect(coord.markAcked(id, Date.now())).toEqual({ ok: true, state: 'acked' });
      expect(rowOf(coord, id).state).toBe('acked');
      await sweepFar(w);
      expect(rowOf(coord, id).state).toBe('acked');
      expect(sendCalls(h.calls)).toEqual([]);
    });
  }
});

describe('the push', () => {
  const rig = async () => {
    const sent: { title: string; body: string }[] = [];
    const push = { notify: async (p: { title: string; body: string }) => { sent.push(p); } };
    const notifyLog = new NotifyLog(path.join(mkTmp('ccrc-report-hold-log-'), 'n.json'));
    await notifyLog.load();
    const { coord, w } = await primed([emptyBox], { over: { push: push as never, notifyLog } });
    // "recorded" is the durable feed: `pushOne` mirrors every record (recordAlways) there, pushed or not
    const recordedOf = (): string[] => coord.feedEvents(100).map((e) => e.body);
    return { coord, w, sent, recordedOf };
  };

  it('6a. a new report is recorded and pushes nothing; a peer\'s ordinary mail beside it pushes as today', async () => {
    const { coord, w, sent, recordedOf } = await rig();
    queueReport(coord);
    const ordinary = queueMail(coord, PEER, ID, ID, 'ordinary news');
    expect(ordinary.id).toBeGreaterThan(0);
    await w.tick();
    expect(recordedOf()).toContain(SUBJECT);
    expect(recordedOf()).toContain('ordinary news');
    expect(sent.map((p) => p.body)).toContain('ordinary news');     // the control: the tick read both
    expect(sent.map((p) => p.body)).not.toContain(SUBJECT);
  });

  it('6b. fixedLinePushOf: only the report row says record-only; every other mail answers absent', () => {
    expect(fixedLinePushOf({ fromId: PEER, subject: SUBJECT, mailToId: 'overlord' })).toBe('record-only');
    expect(fixedLinePushOf({ fromId: PEER, subject: SUBJECT, mailToId: ID })).toBeUndefined();
    expect(fixedLinePushOf({ fromId: 'operator', subject: operatorMessageSubject(3), mailToId: ID })).toBeUndefined();
    expect(fixedLinePushOf({ fromId: TIMER_MAIL_SENDER, subject: 'timer: 1 due', mailToId: 'overlord' })).toBeUndefined();
  });

  // Characterizes main: the older rows' push, whatever `pushNewMail`'s own record-only condition says today.
  const older: [string, (coord: CoordStore) => string, 'pushed' | 'recorded-only'][] = [
    ['operator message', (c) => { const s = operatorMessageSubject(9); queueMail(c, 'operator', ID, ID, s); return s; }, 'recorded-only'],
    ['spot-probe', (c) => { queueMail(c, 'operator', 'overlord', ID, SPOT_PROBE_SUBJECT); return SPOT_PROBE_SUBJECT; }, 'pushed'],
    ['inbox wake', (c) => {
      const m = c.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: 'overlord', runId: null, kind: 'status', subject: INBOX_WAKE_SUBJECT,
        body: renderInboxWakeBody({ waiting: 1, firstDue: { kind: 'none' }, keys: [] } as never), artifacts: [] });
      c.queueDelivery(m.id, ID, 'e'); return INBOX_WAKE_SUBJECT;
    }, 'recorded-only'],
    ['provider retry', (c) => { const s = providerRetrySubject(NOW + 60_000); queueMail(c, 'operator', ID, ID, s); return s; }, 'recorded-only'],
    ['timer', (c) => { queueMail(c, TIMER_MAIL_SENDER, 'overlord', ID, 'timer: 1 due'); return 'timer: 1 due'; }, 'recorded-only'],
  ];
  for (const [name, make, expected] of older) {
    it(`6c. the older row "${name}" is ${expected} (as main does)`, async () => {
      const { coord, w, sent, recordedOf } = await rig();
      const subject = make(coord);
      await w.tick();
      expect(recordedOf()).toContain(subject);                          // every mail is recorded
      expect(sent.map((p) => p.body).includes(subject)).toBe(expected === 'pushed');
    });
  }
});

describe('the stall watch', () => {
  it('7. the mail-stuck arm does not read a held report as stuck, however long it stands (judged as a coordinator, the one role that runs the arm)', async () => {
    const { coord } = await primed([emptyBox]);
    designate(coord, ID);
    const { id } = queueReport(coord);
    const H = 3_600_000;
    const later = NOW + 30 * H;
    const read = coord.stallMailFor(ID, [], NOW - H);
    if (!read.ok) throw new Error(`read: ${read.detail}`);
    expect(read.deliveries.map((d) => d.id)).toContain(id);
    const arming: StallArming = { disabled: false, live: true, escalate: true, w2Live: true };
    const worker = { present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 }, dialogPending: false, stranded: false,
      swapBlocked: false, live: { ok: true, word: 'idle', since: NOW + H }, hookAsk: { kind: 'none' }, askRow: { kind: 'none' }, autoContinueHeldAt: null } as unknown as StallWorker;
    const mark: TurnMark = { crons: null, sessionId: 'uuid-1', state: 'done', event: 'Stop', at: NOW + H, turnAt: NOW + H - 20 * 60_000, stopAt: NOW + H, bg: 0,
      bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null };
    const markRead: TurnMarkRead = { ok: true, ...mark };
    const input: StallSessionInput = { sessionId: ID, role: 'coordinator', run: null, worker, mark: markRead, liveStartedAt: NOW - 30 * H, markUnreadableSince: null,
      mail: read.mail, deliveries: read.deliveries, notices: [], arming, coordinationPaused: false,
      heldDeliveryIds: heldDeliveryIdsOf(read.mail, read.deliveries) };
    // The table's hold, read the way the watcher reads it (envelope's `heldDeliveryIdsOf`), names the report's delivery.
    expect([...input.heldDeliveryIds!]).toEqual([id]);
    const said = stallMailStuckVerdicts(input, later).map((v) => (v.act === 'notify' ? `notify:${v.arm}` : v.act));
    // The held report is not a candidate at all: the arm reads the table's hold, the rule the sweep holds it by.
    expect(said).toEqual([]);
    // the field is what holds it: without it, the same report reads as stuck
    const { heldDeliveryIds: _held, ...bare } = input;
    expect(stallMailStuckVerdicts(bare, later).map((v) => (v.act === 'notify' ? v.arm : v.act))).toEqual(['mail-stuck']);
    // the control: the same session's ordinary queued mail, equally old, is read as stuck, and is the only candidate
    queueMail(coord, PEER, ID, ID, 'ordinary news');
    const read2 = coord.stallMailFor(ID, [], NOW - H);
    if (!read2.ok) throw new Error('read2');
    const verdicts = stallMailStuckVerdicts({ ...input, mail: read2.mail, deliveries: read2.deliveries,
      heldDeliveryIds: heldDeliveryIdsOf(read2.mail, read2.deliveries) }, later);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ act: 'notify', arm: 'mail-stuck' });
  });

  it('7c. the mail pass leaves the held out of its due list through the one filter beside the hold rule (call 1995)', () => {
    // `notHeldUntilAcked` (envelope.ts) is called once in the pass, and the pass names the rule itself nowhere else.
    const calls = callsIn(symbolOf('server/src/watch.ts', 'FleetWatcher.mailPass')).map((c) => c.name);
    expect(calls.filter((n) => n === 'notHeldUntilAcked')).toHaveLength(1);
    expect(calls).not.toContain('heldUntilAcked');
  });

  it('7b. the watcher passes the hold into both stall judgements that run the mail-stuck arm (the worker and the coordinator)', () => {
    // Read through the symbol scan, so deleting either line in watch.ts reds here. The third judgement (role `other`) runs no
    // mail-stuck arm (`stallMailStuckVerdicts` answers [] for it), so it carries none.
    for (const method of ['FleetWatcher.judgeStall', 'FleetWatcher.judgeStallCoordinator']) {
      expect(sourceOfSymbol('server/src/watch.ts', method), method).toContain('heldDeliveryIds: heldDeliveryIdsOf(read.mail, read.deliveries)');
    }
  });
});

// ── the endings ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));
const APPENDED = { ok: true, kind: 'appended', record: {} } as unknown as AuthorityAppend;
const appender: AuthorityAppender = { appendInTx: () => APPENDED };
const GEN_A = '11111111-2222-3333-4444-555555555555';
const GEN_B = '66666666-7777-8888-9999-000000000000';
const BODY_B = 'overlord-brisk-heron';
const SET_X = { pools: ['pool-b', 'pool-a'], untagged: true };

describe('how a held report ends (and how it does not)', () => {
  it('8a. THE BOUND SESSION ACKS IT (markAcked, the one writer): the delivery is acked, and is typed never', async () => {
    const { h, coord, w } = await primed([emptyBox]);
    designate(coord, ID);
    const { id } = queueReport(coord);
    await sweepMany(w, 3);
    expect(rowOf(coord, id).state).toBe('queued');
    expect(coord.markAcked(id, Date.now())).toEqual({ ok: true, state: 'acked' });
    expect(rowOf(coord, id)).toMatchObject({ state: 'acked', toId: ID });
    await sweepMany(w, 3);
    expect(rowOf(coord, id).state).toBe('acked');
    expect(sendCalls(h.calls)).toEqual([]);
  });

  it('8b. THE OPERATOR REBINDS THE DESIGNATION to a new session (go-live repoints outstanding mail to the role): the delivery names the new session, still queued, still held, still untyped', async () => {
    const { h, coord, w } = await primed([emptyBox]);
    expect(coord.designatePending(appender, { sessionId: ID, deadlineAt: NOW + 60_000, model: 'fable', accountPools: SET_X, actor: OPERATOR, at: NOW, opKey: 'op-1' }).ok).toBe(true);
    expect(coord.goLive(appender, ID, GEN_A, NOW + 1)).toMatchObject({ ok: true, changed: true, term: 1 });
    const { id } = queueReport(coord, ID);
    await sweepFar(w);
    expect(rowOf(coord, id).toId).toBe(ID);
    expect(coord.rebindPending({ sessionId: BODY_B, deadlineAt: NOW + 90_000, actor: OPERATOR, at: NOW + 2 })).toEqual({ ok: true, changed: true });
    expect(coord.goLive(appender, BODY_B, GEN_B, NOW + 3)).toMatchObject({ ok: true, changed: true, term: 2, previous: ID });
    const after = rowOf(coord, id);
    expect(after).toMatchObject({ toId: BODY_B, state: 'queued', attempts: 0, lastGate: null, deliveredAt: null });
    await sweepMany(w, 5);
    expect(rowOf(coord, id)).toEqual(after);
    expect(sendCalls(h.calls)).toEqual([]);
    expect(coord.outstandingMailFor(BODY_B, 50).map((m) => m.id)).toContain(id);
  });

  it('8c. THE OPERATOR RETIRES THE DESIGNATION: the delivery is untouched, still queued and held, still naming the old body', async () => {
    const { h, coord, w } = await primed([emptyBox]);
    expect(coord.designatePending(appender, { sessionId: ID, deadlineAt: NOW + 60_000, model: 'fable', accountPools: SET_X, actor: OPERATOR, at: NOW, opKey: 'op-1' }).ok).toBe(true);
    expect(coord.goLive(appender, ID, GEN_A, NOW + 1)).toMatchObject({ ok: true, changed: true });
    const { id } = queueReport(coord, ID);
    const before = rowOf(coord, id);
    expect(coord.retire(appender, { actor: OPERATOR, at: NOW + 2, opKey: 'retire-1' })).toMatchObject({ ok: true, changed: true });
    expect(coord.designationRead().kind).toBe('not-designated');
    await sweepMany(w, 5);
    expectUntouched(coord, id, before);
    expect(rowOf(coord, id).toId).toBe(ID);
    expect(sendCalls(h.calls)).toEqual([]);
  });

  it('8d. THE REQUEST IT NAMES CLOSES (its state set to a terminal one): the delivery is untouched, still queued and held', async () => {
    const { h, coord, w } = await primed([emptyBox]);
    designate(coord, ID);
    const { id, mailId } = queueReport(coord);
    coord.db.prepare("INSERT INTO overlord_requests (id, origin, summary, owner, state, openedAt) VALUES (7, 'operator', 'a request', 'lane-b', 'active', ?)").run(NOW);
    coord.db.prepare('UPDATE mail SET requestId = 7 WHERE id = ?').run(mailId);
    const before = rowOf(coord, id);
    coord.db.prepare('UPDATE overlord_requests SET state = ?, closedAt = ? WHERE id = 7').run(TERMINAL_REQUEST_STATES[0]!, NOW + 1);
    await sweepMany(w, 5);
    expectUntouched(coord, id, before);
    expect(sendCalls(h.calls)).toEqual([]);
  });

  it('8e. THE SENDER\'S SESSION ENDS (its registry row removed): the delivery is untouched, still queued and held', async () => {
    const { h, coord, w } = await primed([emptyBox]);
    designate(coord, ID);
    seedRegistry(h.home, PEER, 4343, 'b'.repeat(36));
    const { id } = queueReport(coord, ID, PEER);
    const before = rowOf(coord, id);
    await sweepFar(w);
    const { rmSync } = await import('node:fs');
    for (const f of ['wrapper', 'project', 'workdir', 'uuid', 'started', 'hookstate.json']) rmSync(path.join(h.home, '.cc-sessions', `${PEER}.${f}`), { force: true });
    await sweepMany(w, 5);
    expectUntouched(coord, id, before);
    expect(sendCalls(h.calls)).toEqual([]);
  });

  it('8f. NO OVERLORD EVER READS IT: it is outstanding for good, still queued and held after 30 sweeps', async () => {
    const { h, coord, w } = await primed([emptyBox]);
    designate(coord, ID);
    const { id } = queueReport(coord);
    const before = rowOf(coord, id);
    await sweepMany(w, 30);
    expectUntouched(coord, id, before);
    expect(sendCalls(h.calls)).toEqual([]);
    expect(coord.outstandingMailFor(ID, 50).map((m) => m.id)).toContain(id);
  });
});

describe('the held report is outstanding mail for the session it names', () => {
  it('9. outstandingMailFor lists it and mailHoldsSleep answers true for it (today it holds that session awake)', async () => {
    const { coord, w } = await primed([emptyBox]);
    designate(coord, ID);
    const { id, mailId } = queueReport(coord);
    await sweepMany(w, 3);
    const rows = coord.outstandingMailFor(ID, 50);
    const mine = rows.find((m) => m.id === mailId || (m as unknown as { deliveryId?: number }).deliveryId === id);
    expect(mine, JSON.stringify(rows.map((r) => r.id))).toBeDefined();
    expect(mailHoldsSleep(mine!)).toBe(true);
    expect(rows.some(mailHoldsSleep)).toBe(true);
    // once acked it no longer holds the session awake
    coord.markAcked(id, Date.now());
    expect(coord.outstandingMailFor(ID, 50).some(mailHoldsSleep)).toBe(false);
  });
});
