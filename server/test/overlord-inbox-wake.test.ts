// Overlord W1, inbox piece, Task 4 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`, questions 7, 9 and 16): the
// coalesced wake lane, `coord/overlordInboxWake.ts#createInboxWakeLane`, over a real fixture `coord.db`, a real fixture private
// store, and the REAL read gate (`overlordGateRun.ts#overlordReadGate`) over fake gate-fact ports. Fixture names only.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { genExpectOf, openRound, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { openCoordDb } from '../src/coord/db.js';
import { overlordReadGate, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import { createInboxWakeLane, type InboxWakeInput } from '../src/coord/overlordInboxWake.js';
import { CoordStore } from '../src/coord/store.js';
import type { WatcherCoordPort } from '../src/coord/ports.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { INBOX_WAKE_SUBJECT, readInboxWakeBody } from '../../shared/overlordInbox.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const BODY = 'lane-a-overlord';
const INC = 'inc-1';
const MSG_TEXT = 'MSG-MARKER do the thing in project-a';
const QUESTION = 'Q-MARKER which thread is open?';
const EXPECTED = 'EXPECTED-MARKER none';
const DESIGNATED: DesignationRead = {
  kind: 'designated', sessionId: BODY, term: 1,
  row: { bound: { sessionId: BODY, generation: INC }, pending: null, term: 1, designatedTerm: 1 },
} as unknown as DesignationRead;
const NOT_DESIGNATED: DesignationRead = { kind: 'not-designated', row: null };
const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
const issuer = (): PrivacyIssuer => {
  let last = 0;
  return { kind: 'ready', issue: (high) => { last = Math.max(high ?? 0, last) + 1; return { ok: true, id: last }; } };
};

let s: CoordStore;
let seq = 0;
beforeAll(() => { s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-inbox-wake-'), '.ccrc', 'coord.db'))); });
afterAll(removeTmpFixtures);
const dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  s.db.exec('DELETE FROM continuity_probes; DELETE FROM mail_deliveries; DELETE FROM mail');
});

/** Mint the Overlord identity's next generation, standing in `state`. */
function fresh(state: 'active' | 'draining' = 'active'): GenRow {
  seq += 1;
  const r0 = s.insertStart({ sessionId: BODY, reportId: `rr-${seq}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'startup',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: NOW + seq, receivedAt: NOW + seq, doorNonceSha256: null });
  if (!r0.ok) throw new Error('start not recorded');
  const live = s.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const old = live.rows.find((g) => g.identity === 'overlord');
  const mint: MintInput = { identity: 'overlord', sessionId: BODY, role: 'coordinator', term: 1, rowIncarnation: null, startId: r0.id,
    startReportedAt: NOW + seq, resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000 + seq,
    proc: `p${seq}`, now: NOW };
  const m = s.mintGeneration(mint, old === undefined ? null : genExpectOf(old), true);
  if (!m.ok) throw new Error('not minted');
  s.db.prepare('UPDATE continuity_generations SET state = ?, deadlineAt = NULL WHERE id = ?').run(state, m.id);
  const after = s.liveGenerations();
  if (!after.ok) throw new Error(after.detail);
  return after.rows.find((g) => g.id === m.id)!;
}

/** A round of `n` questions in the generation (its text and answers are markers). */
function openProbe(gen: GenRow, roundId: string, kind: 'compaction' | 'start' | 'spot' = 'compaction', n = 2): void {
  const r = openRound(s.db, {
    roundId, sessionId: BODY, generationId: gen.id, kind, snapshotId: null, depthTokens: null, modelClass: null,
    roundUnmeasured: false, askedAt: NOW - 5_000, supersedes: null,
    questions: Array.from({ length: n }, (_, i) => ({ qid: `p${i}`, cls: 'thread' as const, question: `${QUESTION} ${i}`, choices: null, expected: EXPECTED })),
  });
  if (!r.ok) throw new Error(`round not opened: ${r.kind}`);
}
const closeRounds = (): void => { s.db.prepare('UPDATE continuity_probes SET answeredAt = ? WHERE answeredAt IS NULL').run(NOW); };

interface Opts {
  designation?: DesignationRead; words?: readonly string[]; operatorRung?: string; authority?: OverlordGateDeps['authority'];
  readBy?: readonly unknown[]; card?: 'read-current' | 'none'; storeUp?: boolean; gate?: 'read' | 'none';
  /** An unreadable private store. */
  storeBroken?: boolean;
}
interface Rig {
  lane: ReturnType<typeof createInboxWakeLane>; logs: string[]; store: OperatorModelStore; gateCalls: () => number;
  pass: (input?: InboxWakeInput) => Promise<void>;
  record: (text?: string) => number;
}
function rig(o: Opts = {}, coord: WatcherCoordPort = s as unknown as WatcherCoordPort): Rig {
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-inbox-wake-store-')));
  dbs.push(db);
  const store = new OperatorModelStore(db, issuer());
  const designation = o.designation ?? DESIGNATED;
  const withDesignation = new Proxy(coord, {
    get(target, prop, recv) {
      if (prop === 'designationRead') return () => designation;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  let gateCalls = 0;
  const gateDeps: OverlordGateDeps = {
    identity: {
      session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: { kind: 'session', subject: sessionId } as never }),
      incarnation: async () => ({ kind: 'measured', incarnation: INC }) as never,
    },
    designation: () => { gateCalls += 1; return designation; },
    authority: o.authority ?? (() => ({ kind: 'coherent' })),
    ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: o.operatorRung ?? 'full', binding: [], readBy: o.readBy ?? [] } as never }),
    generations: () => s.liveGenerations(),
    continuityLive: () => true,
    cardRead: () => ({ ok: true, read: o.card === 'none' ? null : ({ current: true } as never) }),
    actKey: () => ({ kind: 'unmeasured', why: 'a read door reads no key' }),
    counter: () => 'unmeasured',
    witness: () => ({ kind: 'unmeasured', why: 'a read door reads no witness' }),
    recordWitness: () => { throw new Error('the wake records no witness'); },
    recordFenceRefusal: () => { throw new Error('the wake records no fence refusal'); },
    serverWords: () => o.words ?? ['overlord-v1'],
    now: () => NOW,
  };
  const readGate = overlordReadGate(gateDeps);
  const logs: string[] = [];
  const broken = { unsettledFacts: () => ({ kind: 'unmeasured' as const, why: 'fixture: the private store could not be read' }) };
  const lane = createInboxWakeLane({
    coord: withDesignation as WatcherCoordPort,
    operatorModel: o.storeUp === false ? undefined : o.storeBroken === true ? broken : store,
    gate: () => (o.gate === 'none' ? undefined : readGate),
    log: (l) => logs.push(l),
  });
  let n = 0;
  return {
    lane, logs, store, gateCalls: () => gateCalls,
    pass: (input = { mailDisabled: 'clear' }) => lane.pass(input, NOW),
    record: (text = MSG_TEXT) => {
      n += 1;
      const r = store.recordMessage({ at: NOW - 100_000 + n, sessionId: BODY, term: 1, actor: ACTOR, text, mark: false, composedKey: null });
      if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
      return r.value.id;
    },
  };
}

const wakes = (): { id: number; subject: string; body: string; toId: string; fromId: string }[] =>
  s.db.prepare("SELECT id, subject, body, toId, fromId FROM mail WHERE subject = 'inbox-wake' ORDER BY id").all() as never;
/** The wake's delivery, delivered and acked as the mail lane does on the first delivery. */
function settleWake(): void {
  const rows = s.db.prepare("SELECT d.id AS id FROM mail_deliveries d JOIN mail m ON m.id = d.mailId WHERE m.subject = 'inbox-wake' ORDER BY d.id").all() as { id: number }[];
  for (const r of rows) s.markAcked(r.id, NOW);
}

describe('what wakes the Overlord', () => {
  it('an active generation with a new compaction round queues one wake whose body names the round\'s key and counts the messages too', async () => {
    const gen = fresh();
    const r = rig();
    r.record(); r.record();
    openProbe(gen, 'round-7');
    await r.pass();
    const sent = wakes();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ subject: INBOX_WAKE_SUBJECT, toId: BODY, fromId: 'operator' });
    const body = readInboxWakeBody(sent[0]!.body);
    expect(body).toEqual({ ok: true, body: { keys: ['probe-round:round-7'], waiting: 3, firstDue: { kind: 'none' } } });
    expect(r.logs).toEqual([]);
  });

  it('the next pass queues nothing while the wake is undelivered, and nothing once it is delivered', async () => {
    const gen = fresh();
    const r = rig();
    openProbe(gen, 'round-7');
    await r.pass();
    await r.pass();
    expect(wakes()).toHaveLength(1);
    expect(r.logs).toEqual(['ccrc-server: the inbox wake holds: outstanding']);
    settleWake();
    await r.pass();
    expect(wakes()).toHaveLength(1);
    expect(r.logs[r.logs.length - 1]).toBe('ccrc-server: the inbox wake holds: nothing-new');
  });

  it('a new compaction round after that wakes once more', async () => {
    const gen = fresh();
    const r = rig();
    openProbe(gen, 'round-7');
    await r.pass();
    settleWake();
    closeRounds();
    openProbe(gen, 'round-8');
    await r.pass();
    const sent = wakes();
    expect(sent).toHaveLength(2);
    expect(readInboxWakeBody(sent[1]!.body)).toMatchObject({ ok: true, body: { keys: ['probe-round:round-8'] } });
  });

  it('a spot round alone, and two unsettled messages and no round, queue nothing: each has its own nudge', async () => {
    const gen = fresh();
    const spot = rig();
    openProbe(gen, 'round-spot', 'spot');
    await spot.pass();
    expect(wakes()).toEqual([]);
    expect(spot.logs).toEqual(['ccrc-server: the inbox wake holds: nothing-new']);
    closeRounds();
    const messages = rig();
    messages.record(); messages.record();
    await messages.pass();
    expect(wakes()).toEqual([]);
  });

  it('a failed send changes nothing: a lane whose mail was not queued wakes for the same round on the next pass', async () => {
    const gen = fresh();
    openProbe(gen, 'round-7');
    // An identical outstanding wake (queued by another path) makes `queueSystemMail` answer `queued: false`; the lane's own outstanding
    // read is bypassed by a lane over a store whose `hasOutstandingMail` first answers false.
    let asked = 0;
    const real = s as unknown as WatcherCoordPort;
    const flaky = new Proxy(real, {
      get(target, prop) {
        if (prop === 'hasOutstandingMail') return (...a: Parameters<WatcherCoordPort['hasOutstandingMail']>) => { asked += 1; return asked === 1 ? false : target.hasOutstandingMail(...a); };
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    });
    const lane = rig({}, flaky);
    s.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: BODY, runId: null, kind: 'status', subject: INBOX_WAKE_SUBJECT, body: 'inbox-wake v1\nwaiting: 1\nfirst-due: none\nkey: probe-round:round-7', artifacts: [] });
    s.queueDelivery(wakes()[0]!.id, BODY, 'e');
    await lane.pass();          // outstanding read false, queueSystemMail's own guard answers queued: false, woken stays empty
    expect(wakes()).toHaveLength(1);
    settleWake();
    await lane.pass();          // woken was not set, so the round is new again
    expect(wakes()).toHaveLength(2);
    expect(lane.logs).toEqual([]);
  });

  it('a fresh lane (a restart) over a round already woken for wakes once', async () => {
    const gen = fresh();
    const before = rig();
    openProbe(gen, 'round-7');
    await before.pass();
    settleWake();
    await before.pass();
    expect(wakes()).toHaveLength(1);
    const after = rig();
    await after.pass();
    expect(wakes()).toHaveLength(2);
  });
});

describe('what holds the wake, each with its word, logged once', () => {
  const holds = async (o: Opts, input?: InboxWakeInput): Promise<Rig> => {
    s.db.exec('DELETE FROM continuity_probes; DELETE FROM mail_deliveries; DELETE FROM mail');
    const gen = fresh();
    const r = rig(o);
    openProbe(gen, 'round-7');
    await r.pass(input);
    await r.pass(input);
    expect(wakes()).toEqual([]);
    return r;
  };
  const line = (word: string): string => `ccrc-server: the inbox wake holds: ${word}`;

  it('a server without overlord-v1 holds capability-missing', async () => {
    expect((await holds({ words: [] })).logs).toEqual([line('capability-missing')]);
  });
  it('the off rung holds overlord-off', async () => {
    expect((await holds({ operatorRung: 'off' })).logs).toEqual([line('overlord-off')]);
  });
  it('a rolled-back authority journal holds authority-rolled-back', async () => {
    expect((await holds({ authority: () => ({ kind: 'rolled-back', cause: 'missing' }) })).logs).toEqual([line('authority-rolled-back')]);
  });
  it('an unmet launch profile holds launch-profile-unmet', async () => {
    expect((await holds({ readBy: [{ reader: 'launch-profile-unmet', cause: 'profile', reading: 'steered' }] })).logs).toEqual([line('launch-profile-unmet')]);
  });
  it('an unread card holds card-unread', async () => {
    expect((await holds({ card: 'none' })).logs).toEqual([line('card-unread')]);
  });
  it('a renewing generation holds renewing', async () => {
    const gen = fresh('draining');
    const r = rig();
    openProbe(gen, 'round-7');
    await r.pass();
    await r.pass();
    expect(wakes()).toEqual([]);
    expect(r.logs).toEqual([line('renewing')]);
  });
  it('no designation holds not-designated, and an unmeasured designation does too', async () => {
    expect((await holds({ designation: NOT_DESIGNATED })).logs).toEqual([line('not-designated')]);
    expect((await holds({ designation: { kind: 'unmeasured', why: 'fixture' } })).logs).toEqual([line('not-designated')]);
  });
  it('mail-disabled standing holds mail-disabled; an unreadable listing holds mail-disabled-unmeasured', async () => {
    expect((await holds({}, { mailDisabled: 'set' })).logs).toEqual([line('mail-disabled')]);
    expect((await holds({}, { mailDisabled: 'unmeasurable' })).logs).toEqual([line('mail-disabled-unmeasured')]);
  });
  it('an unreadable private store, and a lane with none, hold rows-unmeasured and log it once', async () => {
    fresh();
    for (const o of [{ storeBroken: true }, { storeUp: false }] as Opts[]) {
      const r = rig(o);
      await r.pass();
      await r.pass();
      expect(r.logs).toEqual([line('rows-unmeasured')]);
    }
    expect(wakes()).toEqual([]);
  });
  it('a gate not handed over holds unmeasured; the hold word changing logs the new word', async () => {
    const gen = fresh();
    openProbe(gen, 'round-7');
    const r = rig({ gate: 'none' });
    await r.pass();
    expect(r.logs).toEqual([line('unmeasured')]);
    const live = rig({}, s as unknown as WatcherCoordPort);
    await live.pass({ mailDisabled: 'set' });
    await live.pass({ mailDisabled: 'unmeasurable' });
    await live.pass({ mailDisabled: 'unmeasurable' });
    expect(live.logs).toEqual([line('mail-disabled'), line('mail-disabled-unmeasured')]);
    await live.pass();
    expect(wakes()).toHaveLength(1);
  });
  it('the lane asks the gate before it sends: a refusing gate sends nothing even when a row is new', async () => {
    const gen = fresh();
    openProbe(gen, 'round-7');
    const r = rig({ words: [] });
    await r.pass();
    expect(wakes()).toEqual([]);
    expect(r.gateCalls()).toBeGreaterThan(0);
  });
});

describe('the lane records nothing and carries no words', () => {
  it('the subject, the body and every log line hold no message text and no question text, and no read-ledger line or fence row is written', async () => {
    const gen = fresh();
    const r = rig();
    r.record();
    openProbe(gen, 'round-7');
    await r.pass();
    await r.pass();
    const sent = wakes();
    expect(sent).toHaveLength(1);
    for (const text of [sent[0]!.subject, sent[0]!.body, ...r.logs]) {
      expect(text).not.toContain('MARKER');
      expect(text).not.toContain(EXPECTED);
    }
    expect((s.db.prepare('SELECT count(*) AS c FROM overlord_fence_refusals').get() as { c: number }).c).toBe(0);
  });
});
