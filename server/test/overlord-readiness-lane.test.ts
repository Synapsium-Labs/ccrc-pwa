// Overlord W1 readiness, plan `w1-readiness.md` Task 3 Step 1: the delivery lane (`overlordReadinessLane.ts`) on a fake
// port with controllable wall and monotonic clocks, over a coord db opened through the real migrations. The end-to-end
// operator_items cases (the last describe blocks) run against the real item store: the lane calls the readiness store itself.
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { ReadinessLane, type ReadinessLanePort, type ReadinessTick } from '../src/coord/overlordReadinessLane.js';
import type { ReadinessPush } from '../src/coord/overlordReadiness.js';
import type { MessageFacts } from '../src/coord/overlordInbox.js';
import { itemBoundOf, type SenderDeps } from '../src/pushSender.js';
import type { ItemReachOf } from '../src/coord/pushOutboxStore.js';
import type { ResponseStamp } from '../../shared/responses.js';
import { fakeTime } from './fakeTime.js';
import { pushSeam } from './pushSeam.js';
import { itemById, moveItemInTx } from '../src/coord/ledgersStore.js';
import { OVERLORD_ITEM_PROGRAMME } from '../../shared/overlord-sequence.js';
import { readinessNow, recordReadiness } from '../src/coord/overlordReadinessStore.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import type { FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { Candidates } from '../src/accountLoad.js';
import { READINESS_DEAF_MS, READINESS_RESTART_BOUND_MS } from '../../shared/overlord-readiness.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-readiness-lane-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-readiness-lane-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};

const W0 = 1_800_000_000_000;
const A = 'cc-overlord-a';

const view = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: { sessionId: A, generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus' as DesignationView['model'],
  accountPools: [] as unknown as DesignationView['accountPools'], pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [], ...over,
});
const designated = (): DesignationRead => ({ kind: 'designated', sessionId: A, term: 1, row: view() });
const notDesignated: DesignationRead = { kind: 'not-designated', row: null };

const session = (over: Record<string, unknown> = {}): FleetSession =>
  ({ id: A, presence: 'alive', lifecycle: null, status: 'idle', unmeasured: [], dialogPending: false, ...over } as unknown as FleetSession);
const record = (): SessionRecord => ({ id: A, stranded: null, swapBlocked: null } as unknown as SessionRecord);
const tickOf = (s: FleetSession | null, listed = true): ReadinessTick =>
  ({ listed: true, sessions: s === null ? [] : [s], records: [record()], listedIds: new Set(listed ? [A] : []), names: ['x'] });
const UP = (): ReadinessTick => tickOf(session());

const genRow = (over: Partial<GenRow> = {}): GenRow =>
  ({ id: 1, identity: A, sessionId: A, n: 1, state: 'active', proven: true, startReportedAt: W0 - 100_000, deadlineAt: null, ...over } as unknown as GenRow);
const twoYes: Candidates = { kind: 'candidates', list: [
  { id: 'lane-a', limits: undefined, serves: 'yes' }, { id: 'lane-b', limits: undefined, serves: 'yes' }] };

/** Each reader returns the value the test sets in `s`; the acts record their calls. */
function harness(db: DatabaseSync = openDb()) {
  const s = {
    wall: W0, mono: 5_000,
    designation: designated() as DesignationRead,
    ladderThrows: false, unsettledThrows: false, designationThrows: false,
    inbox: [] as MessageFacts[],
    holds: { kind: 'not-wired' } as ReturnType<ReadinessLanePort['holds']>,
    gen: genRow() as GenRow | null,
    restarts: 0,
    candidates: twoYes as Candidates,
    served: W0 - 1_000 as number | 'none',
    identityThrows: false,
    turnGate: null as Promise<void> | null,
    hookGate: null as Promise<void> | null,
  };
  const calls = { liveGeneration: [] as string[], restartsSince: [] as string[] };
  const pushes: ReadinessPush[] = [];
  const logs: string[] = [];
  const port: ReadinessLanePort = {
    db,
    clock: { wall: () => s.wall, mono: () => s.mono },
    designation: () => { if (s.designationThrows) throw new Error('designation boom'); return s.designation; },
    ladder: () => { if (s.ladderThrows) throw new Error('ladder boom'); return { kind: 'read', operatorRung: 'on' as never }; },
    mailDisabled: (names) => (names === null ? 'unmeasurable' : 'clear'),
    identityOf: (id) => { if (s.identityThrows) throw new Error('identity boom'); return id; },
    liveGeneration: (identity) => { calls.liveGeneration.push(identity); return { ok: true, row: s.gen }; },
    effective: (r) => ({ state: r.state, deadlineAt: r.deadlineAt }),
    restartsSince: (identity) => { calls.restartsSince.push(identity); return { ok: true, count: s.restarts }; },
    candidates: () => s.candidates,
    resets: () => ({ ok: true, value: {} }),
    turnMark: async () => { const gate = s.turnGate; s.turnGate = null; if (gate !== null) await gate; return { ok: false, reason: 'absent' }; },
    hookState: async () => { const gate = s.hookGate; s.hookGate = null; if (gate !== null) await gate; return { ok: false, reason: 'no-state' }; },
    strandUnreadable: () => false,
    unsettled: () => { if (s.unsettledThrows) throw new Error('inbox boom'); return { kind: 'measured', value: s.inbox }; },
    lastServedReadAt: () => ({ kind: 'measured', value: s.served }),
    lastContinuityRead: () => ({ ok: true, at: null }),
    holds: () => s.holds,
    push: (p) => { pushes.push(p); },
    log: (l) => { logs.push(l); },
  };
  const lane = new ReadinessLane(port);
  /** A pass, then `ms` later on both clocks. */
  const pass = async (tick: ReadinessTick, advanceMs = 10_000) => {
    const r = await lane.pass(tick);
    s.wall += advanceMs; s.mono += advanceMs;
    return r;
  };
  const advance = (ms: number) => { s.wall += ms; s.mono += ms; };
  /** Boot pass, then one measured pass over a healthy body: the word is `ready`. */
  const warm = async () => { await pass(UP()); const r = await pass(UP()); expect(r?.word).toBe('ready'); };
  const words = () => (db.prepare('SELECT word, why FROM overlord_readiness ORDER BY id').all() as { word: string; why: string | null }[]);
  return { db, s, port, lane, pushes, logs, calls, pass, advance, warm, words };
}

describe('the read', () => {
  it('serves unmeasured/boot before the first pass, even over a stored ready row from an earlier process', () => {
    const h = harness();
    expect(recordReadiness(h.db, { word: 'ready', why: null, until: null, strandCause: null, restartable: false, sessionId: A }, W0 - 5_000).ok).toBe(true);
    const r = h.lane.read();
    expect(r.ok && r.wire).toMatchObject({ word: 'unmeasured', why: 'boot' });
  });

  it('serves the stored word within 30 s of the last pass and stale past it, by the monotonic clock', async () => {
    const h = harness();
    await h.warm();
    h.advance(-10_000); // back to the moment right after the last pass
    h.advance(29_000);
    const fresh = h.lane.read();
    expect(fresh.ok && fresh.wire.word).toBe('ready');
    h.advance(2_000);
    const stale = h.lane.read();
    expect(stale.ok && stale.wire).toMatchObject({ word: 'unmeasured', why: 'stale' });
  });
});

describe('the first passes and the listing', () => {
  it('the first pass writes unmeasured with why boot, and the next writes the measured word', async () => {
    const h = harness();
    const a = await h.pass(UP());
    expect(a).toMatchObject({ word: 'unmeasured', why: 'boot' });
    const b = await h.pass(UP());
    expect(b?.word).toBe('ready');
    expect(h.words()).toEqual([{ word: 'unmeasured', why: 'boot' }, { word: 'ready', why: null }]);
  });

  // Plan: "a failed listing writes `unmeasured` with `why: registry`". The port's contract is that `mailDisabled` answers
  // `unmeasurable` on a null listing, and the decider's row 3 reads `off` before `registry`.
  it('a pass with { listed: false } after the first writes unmeasured with why registry', async () => {
    const h = harness();
    await h.warm();
    const r = await h.pass({ listed: false });
    expect(r).toMatchObject({ word: 'unmeasured', why: 'registry' });
    expect(h.words().at(-1)).toEqual({ word: 'unmeasured', why: 'registry' });
  });
});

describe('no designation', () => {
  it('writes absent once and settles every open record retired, end to end', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = { kind: 'candidates', list: [{ id: 'lane-a', limits: undefined, serves: 'yes' }] };
    await h.pass(UP()); // the count item
    h.s.candidates = { kind: 'candidates', list: [] };
    await h.pass(UP()); // the stranded item (set-admits-none), and the count item settled by it
    const open = h.db.prepare('SELECT id, itemId, item FROM overlord_readiness_items WHERE settledAt IS NULL ORDER BY id').all() as { id: number; itemId: number; item: string }[];
    expect(open.map((r) => r.item)).toEqual(['stranded']);
    h.s.designation = notDesignated;
    const a = await h.pass(UP());
    expect(a?.word).toBe('absent');
    await h.pass(UP());
    expect(h.words().filter((w) => w.word === 'absent')).toHaveLength(1);
    for (const r of open) {
      expect(itemById(h.db, r.itemId)).toMatchObject({ state: 'done' });
      expect(h.db.prepare("SELECT actor, note FROM operator_item_events WHERE itemId = ? AND act = 'settle'").all(r.itemId))
        .toEqual([{ actor: 'ccrc', note: 'retired' }]);
    }
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM overlord_readiness_items WHERE settledAt IS NULL').get()).toEqual({ n: 0 });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM overlord_readiness_items WHERE closedBy = 'lane'").get()).toEqual({ n: 2 });
  });
});

describe('the body', () => {
  it('a listed id with no assembled session reads unmeasured; only an id absent from listedIds reads dead absent', async () => {
    const h = harness();
    await h.warm();
    const listedNoSession: ReadinessTick = { listed: true, sessions: [], records: [], listedIds: new Set([A]), names: ['x'] };
    const u = await h.pass(listedNoSession);
    expect(u?.word).toBe('unmeasured');
    expect(u?.why).toMatch(/not assembled/);
    const gone = await h.pass({ listed: true, sessions: [], records: [], listedIds: new Set(), names: ['x'] });
    expect(gone).toMatchObject({ word: 'dead', why: 'absent' });
  });

  it('a body down then up within the bound reads restarting then not dead; with proof missing it reads unproved', async () => {
    const h = harness();
    await h.warm();
    const down = tickOf(session({ lifecycle: 'restarting' }));
    const r1 = await h.pass(down, 5_000);
    expect(r1?.word).toBe('restarting');
    h.s.served = 'none';
    const r2 = await h.pass(UP());
    expect(r2?.word).not.toBe('dead');
    expect(r2?.word).toBe('unproved');
  });

  it('down past 9,100 ms of wall time reads dead, pushing once without Restart; no second push on a later pass or a new lane', async () => {
    const h = harness();
    await h.warm();
    const down = tickOf(session({ lifecycle: 'restarting' }));
    expect((await h.pass(down, 9_100))?.word).toBe('restarting'); // the first sighting
    expect((await h.pass(down, 1))?.word).toBe('restarting'); // exactly the bound is not past it
    const dead = await h.pass(down, 5_000);
    expect(dead).toMatchObject({ word: 'dead', why: 'restart-bound', restartable: false });
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]).toMatchObject({ title: 'The Overlord has stopped', tag: 'overlord-readiness', url: '/', actions: [],
      body: 'Questions go to you as usual. It is restarting repeatedly: open the Overlord place.' });
    await h.pass(down);
    await h.pass(down);
    expect(h.pushes).toHaveLength(1);

    // A server restart: a new lane over the same database, boot first, then dead again once its own sighting is past the bound.
    const lane2 = new ReadinessLane(h.port);
    expect((await lane2.pass(down))?.word).toBe('unmeasured');
    h.advance(9_101);
    expect((await lane2.pass(down))?.word).toBe('dead');
    expect(h.pushes).toHaveLength(1);
  });

  it('three completed restarts with the body up and a proven generation read dead at once', async () => {
    const h = harness();
    await h.warm();
    h.s.restarts = 3;
    const r = await h.pass(UP());
    expect(r).toMatchObject({ word: 'dead', why: 'third-restart' });
    expect(h.pushes).toHaveLength(1);
  });

  it('an asleep body reads dead with the push carrying Restart', async () => {
    const h = harness();
    await h.warm();
    const r = await h.pass(tickOf(session({ presence: 'asleep' })));
    expect(r).toMatchObject({ word: 'dead', why: 'asleep', restartable: true });
    expect(h.pushes).toEqual([{ title: 'The Overlord has stopped', body: 'Questions go to you as usual. Restart it from the Overlord place.',
      tag: 'overlord-readiness', url: '/', actions: [{ action: 'overlord-restart', title: 'Restart' }], dedupeKey: expect.stringMatching(/^overlord-dead:\d+$/) }]);
    const first = h.db.prepare("SELECT id FROM overlord_readiness WHERE word = 'dead' ORDER BY id LIMIT 1").get() as { id: number };
    expect(h.pushes[0]!.dedupeKey).toBe(`overlord-dead:${first.id}`);
  });
});

describe('the dialog', () => {
  it('a dialog seen on two passes 30 s apart reads dialog-open; the first sighting does not', async () => {
    const h = harness();
    await h.warm();
    const dlg = tickOf(session({ dialogPending: true }));
    expect((await h.pass(dlg, 30_000))?.word).not.toBe('dialog-open');
    expect((await h.pass(dlg))?.word).toBe('dialog-open');
  });
});

describe('a producer that throws', () => {
  it('the inbox reads unmeasured with the thrown detail, and the pass does not throw', async () => {
    const h = harness();
    await h.warm();
    h.s.unsettledThrows = true;
    const r = await h.pass(UP());
    expect(r?.word).toBe('unmeasured');
    expect(r?.why).toContain('inbox boom');
  });

  it('the ladder reads unmeasured with the thrown detail', async () => {
    const h = harness();
    await h.warm();
    h.s.ladderThrows = true;
    const r = await h.pass(UP());
    expect(r?.word).toBe('unmeasured');
    expect(r?.why).toContain('ladder boom');
  });
});

describe('a failed row write', () => {
  it('sends no push, raises nothing, logs one line, and does not move the pass mark', async () => {
    const h = harness();
    await h.warm();
    const rowsBefore = h.words().length;
    h.db.exec("CREATE TRIGGER refuse_readiness BEFORE INSERT ON overlord_readiness BEGIN SELECT RAISE(ABORT, 'refused'); END");
    h.s.candidates = { kind: 'candidates', list: [] }; // would raise a stranded item beside a dead push
    const asleep = tickOf(session({ presence: 'asleep' })); // would push
    // The last good pass was 10 s ago (warm advanced the clocks); three failing passes carry the age past 30 s.
    expect(await h.pass(asleep)).toBeNull();
    expect(await h.pass(asleep)).toBeNull();
    expect(await h.pass(asleep, 1_000)).toBeNull();
    expect(h.pushes).toEqual([]);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM overlord_readiness_items').get()).toEqual({ n: 0 });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toContain('could not record');
    expect(h.words()).toHaveLength(rowsBefore);
    const r = h.lane.read();
    expect(r.ok && r.wire).toMatchObject({ word: 'unmeasured', why: 'stale' });
  });
});

/** The item rows end to end: the lane raises through the real item store, on the Overlord's programme, raised by ccrc. */
const items = (db: DatabaseSync) => db.prepare('SELECT id, program, raisedBy, kind, title, neededBy, state FROM operator_items ORDER BY id').all() as
  { id: number; program: string; raisedBy: string; kind: string; title: string; neededBy: string; state: string }[];
const records = (db: DatabaseSync) => db.prepare('SELECT id, item, key, itemId, settledAt, closedBy FROM overlord_readiness_items ORDER BY id').all() as
  { id: number; item: string; key: string; itemId: number; settledAt: number | null; closedBy: string | null }[];
const ONE_YES: Candidates = { kind: 'candidates', list: [{ id: 'lane-a', limits: undefined, serves: 'yes' }] };

describe('the stranded and count items, end to end', () => {
  it('an empty candidate list raises the stranded item set-admits-none, soon (F2), and not the count item', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = { kind: 'candidates', list: [] };
    const r = await h.pass(UP());
    expect(r).toMatchObject({ word: 'stranded', strandCause: 'set-admits-none' });
    expect(items(h.db)).toEqual([{ id: expect.any(Number), program: OVERLORD_ITEM_PROGRAMME, raisedBy: 'ccrc', kind: 'do',
      title: 'The Overlord cannot run: its set admits no account that can serve it', neededBy: 'soon', state: 'open' }]);
    expect(records(h.db)).toMatchObject([{ item: 'stranded', key: 'set-admits-none', settledAt: null, closedBy: null }]);
    await h.pass(UP());
    expect(items(h.db)).toHaveLength(1); // a standing cause raises once
  });

  it('one candidate that serves raises the count item, later, with the figure in its why', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = ONE_YES;
    const r = await h.pass(UP());
    expect(r?.word).toBe('ready');
    expect(items(h.db)).toMatchObject([{ program: 'overlord', raisedBy: 'ccrc', title: 'The Overlord has fewer than two accounts', neededBy: 'later' }]);
    const why = (h.db.prepare('SELECT why FROM operator_items').get() as { why: string }).why;
    expect(why).toMatch(/It counts 1 account that can serve it\.$/);
    expect(records(h.db)).toMatchObject([{ item: 'count', key: 'count' }]);
  });

  it('when the cause clears the lane settles the item with the note cleared, by ccrc, and stamps the record lane', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = ONE_YES;
    await h.pass(UP());
    h.s.candidates = twoYes;
    await h.pass(UP());
    const [it1] = items(h.db);
    expect(it1!.state).toBe('done');
    expect(h.db.prepare("SELECT actor, note FROM operator_item_events WHERE itemId = ? AND act = 'settle'").all(it1!.id)).toEqual([{ actor: 'ccrc', note: 'cleared' }]);
    expect(records(h.db)).toMatchObject([{ closedBy: 'lane', settledAt: expect.any(Number) }]);
    await h.pass(UP());
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM operator_item_events WHERE act = 'settle'").get()).toEqual({ n: 1 }); // settled once
  });

  it('a set-admits-none strand takes the count item\'s place: the standing count item is settled and not raised again', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = ONE_YES;
    await h.pass(UP());
    h.s.candidates = { kind: 'candidates', list: [] };
    await h.pass(UP());
    expect(items(h.db).map((i) => [i.title, i.state])).toEqual([
      ['The Overlord has fewer than two accounts', 'done'],
      ['The Overlord cannot run: its set admits no account that can serve it', 'open'],
    ]);
  });

  it('dismiss then recur: the operator dismisses, the cause stands, the next pass closes the record and raises a new item', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = { kind: 'candidates', list: [] };
    await h.pass(UP());
    const [first] = items(h.db);
    const moved = moveItemInTx(h.db, first!.id, 'dismiss', 'operator', {}, W0, { programmeHasOpenRun: false });
    expect(moved.ok).toBe(true);
    await h.pass(UP());
    const all = items(h.db);
    expect(all.map((i) => i.state)).toEqual(['dismissed', 'open']);
    expect(all[1]!.id).not.toBe(first!.id);
    expect(records(h.db)).toMatchObject([{ itemId: first!.id, closedBy: 'operator' }, { itemId: all[1]!.id, closedBy: null, settledAt: null }]);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM operator_item_events WHERE itemId = ? AND act = 'settle'").get(first!.id)).toEqual({ n: 0 });
  });

  it('a dismissed item whose cause then clears is closed by the operator and never settled', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = ONE_YES;
    await h.pass(UP());
    const [it1] = items(h.db);
    moveItemInTx(h.db, it1!.id, 'dismiss', 'operator', {}, W0, { programmeHasOpenRun: false });
    h.s.candidates = twoYes;
    await h.pass(UP());
    expect(itemById(h.db, it1!.id)).toMatchObject({ state: 'dismissed' });
    expect(records(h.db)).toMatchObject([{ closedBy: 'operator' }]);
  });

  it('a stranded raise writes no push-outbox row: the item is soon, not blocking, and the pass takes no reach (F2)', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = { kind: 'candidates', list: [] };
    await h.pass(UP());
    expect(items(h.db)).toMatchObject([{ neededBy: 'soon' }]);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM push_outbox').get()).toEqual({ n: 0 });
    expect(h.pushes).toEqual([]);
  });
});

describe('a raise or settle the store refuses', () => {
  it('logs once per kind across passes, never throws, and writes no item', async () => {
    const h = harness();
    await h.warm();
    h.db.exec("CREATE TRIGGER refuse_record BEFORE INSERT ON overlord_readiness_items BEGIN SELECT RAISE(ABORT, 'refused'); END");
    h.s.candidates = { kind: 'candidates', list: [] };
    expect((await h.pass(UP()))?.word).toBe('stranded');
    expect((await h.pass(UP()))?.word).toBe('stranded');
    expect(items(h.db)).toEqual([]);
    expect(h.logs.filter((l) => l.includes('could not raise an item'))).toHaveLength(1);
  });

  it('a settle that is refused logs once, writes nothing and leaves the item open for the next pass', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = ONE_YES;
    await h.pass(UP());
    h.db.exec("CREATE TRIGGER refuse_stamp BEFORE UPDATE ON overlord_readiness_items BEGIN SELECT RAISE(ABORT, 'refused'); END");
    h.s.candidates = twoYes;
    await h.pass(UP());
    await h.pass(UP());
    expect(h.logs.filter((l) => l.includes('could not settle an item'))).toHaveLength(1);
    expect(items(h.db).map((i) => i.state)).toEqual(['open']);
    expect(records(h.db)).toMatchObject([{ settledAt: null, closedBy: null }]);
  });
});

describe('the store as the lane leaves it', () => {
  it('records the newest word readable through readinessNow', async () => {
    const h = harness();
    await h.warm();
    const n = readinessNow(h.db);
    expect(n.ok && n.now !== 'none' && n.now.word).toBe('ready');
  });
});

// ── The fix round of review 3922 ────────────────────────────────────────────────────────────────────────────────────────

const downTick = (extra: Record<string, unknown> = {}): ReadinessTick => tickOf(session({ lifecycle: 'restarting', ...extra }));

describe('a third restart is under way until its generation is minted (F1)', () => {
  it('down (third in progress), back up with no new generation, then the minted one: dead throughout, one push', async () => {
    const h = harness();
    await h.warm();
    h.s.restarts = 2; // two restarts already counted in the hour, the live generation started 100 s before W0
    const down = await h.pass(downTick(), 1_000);
    expect(down).toMatchObject({ word: 'dead', why: 'third-restart' });
    expect(h.pushes).toHaveLength(1);

    // The body is back up, but the generations lane has not minted its generation yet: restartsSince still reads 2.
    const up = await h.pass(UP(), 1_000);
    expect(up).toMatchObject({ word: 'dead', why: 'third-restart' });
    expect(h.pushes).toHaveLength(1);

    // The generation is minted after the down sighting, and restartsSince now counts the restart itself.
    h.s.gen = genRow({ n: 2, startReportedAt: h.s.wall });
    h.s.restarts = 3;
    const minted = await h.pass(UP(), 1_000);
    expect(minted).toMatchObject({ word: 'dead', why: 'third-restart' });
    expect(h.pushes).toHaveLength(1);
    expect(h.words().filter((w) => w.word === 'dead')).toHaveLength(1);
  });

  it('with a generation minted after the down sighting and only two counted, the body up is not dead', async () => {
    const h = harness();
    await h.warm();
    h.s.restarts = 1;
    expect((await h.pass(downTick(), 1_000))?.word).toBe('restarting'); // the second in progress
    h.s.gen = genRow({ n: 2, startReportedAt: h.s.wall });
    h.s.restarts = 2;
    const up = await h.pass(UP(), 1_000);
    expect(up?.word).not.toBe('dead');
    expect(h.pushes).toEqual([]);
  });
});

describe('the first pass is recorded before the lane counts itself booted (F3)', () => {
  const seedReady = (h: ReturnType<typeof harness>) =>
    expect(recordReadiness(h.db, { word: 'ready', why: null, until: null, strandCause: null, restartable: false, sessionId: A }, W0 - 5_000).ok).toBe(true);

  it('a refused first row leaves the next pass reading boot, not the stored pre-restart ready word', async () => {
    const h = harness();
    seedReady(h);
    h.db.exec("CREATE TRIGGER refuse_first BEFORE INSERT ON overlord_readiness BEGIN SELECT RAISE(ABORT, 'refused'); END");
    expect(await h.pass(UP())).toBeNull();
    h.db.exec('DROP TRIGGER refuse_first');
    const next = await h.pass(UP());
    expect(next).toMatchObject({ word: 'unmeasured', why: 'boot' });
  });

  it('a refused sequence stamp is the same: the next pass still reads boot', async () => {
    const h = harness();
    seedReady(h);
    h.db.exec("CREATE TRIGGER refuse_stamp_first BEFORE INSERT ON overlord_sequence BEGIN SELECT RAISE(ABORT, 'refused'); END");
    expect(await h.pass(UP())).toBeNull();
    expect(h.logs.some((l) => l.includes('(stamp)'))).toBe(true);
    h.db.exec('DROP TRIGGER refuse_stamp_first');
    expect(await h.pass(UP())).toMatchObject({ word: 'unmeasured', why: 'boot' });
  });
});

describe('two passes are ordered (F4)', () => {
  it('a pass overtaken by a newer one while it awaits a producer writes nothing and answers null', async () => {
    const h = harness();
    await h.warm();
    let release!: () => void;
    h.s.turnGate = new Promise<void>((r) => { release = r; });
    // A would read dead (asleep); it holds at the turn marker.
    const a = h.lane.pass(tickOf(session({ presence: 'asleep' })));
    h.advance(1_000);
    const b = await h.lane.pass(UP());
    expect(b?.word).toBe('ready');
    const rowsBefore = h.words().length;
    release();
    expect(await a).toBeNull();
    expect(h.words()).toHaveLength(rowsBefore);
    expect(h.words().at(-1)?.word).toBe('ready');
    expect(h.pushes).toEqual([]);
  });

  it('the hookstate await is held the same way', async () => {
    const h = harness();
    await h.warm();
    let release!: () => void;
    h.s.hookGate = new Promise<void>((r) => { release = r; });
    const a = h.lane.pass(tickOf(session({ presence: 'asleep' })));
    h.advance(1_000);
    expect((await h.lane.pass(UP()))?.word).toBe('ready');
    const rowsBefore = h.words().length;
    release();
    expect(await a).toBeNull();
    expect(h.words()).toHaveLength(rowsBefore);
  });
});

describe('the sightings reset when the thing they time ends (F6)', () => {
  it('down, up, down: the second down is a fresh sighting, restarting, though the first began past the restart bound', async () => {
    const h = harness();
    await h.warm();
    expect((await h.pass(downTick(), 9_000))?.word).toBe('restarting');
    await h.pass(UP(), 20_000);
    expect((await h.pass(downTick(), 1_000))?.word).toBe('restarting');
    expect(h.pushes).toEqual([]);
  });

  it('dialog, no dialog, dialog: the open-dialog clock restarts', async () => {
    const h = harness();
    await h.warm();
    const dlg = tickOf(session({ dialogPending: true }));
    expect((await h.pass(dlg, 30_000))?.word).not.toBe('dialog-open');
    await h.pass(UP(), 30_000);
    expect((await h.pass(dlg, 1_000))?.word).not.toBe('dialog-open');
  });

  it('a down sighting then nobody designated, then designated again: the sighting starts fresh', async () => {
    const h = harness();
    await h.warm();
    expect((await h.pass(downTick(), 20_000))?.word).toBe('restarting');
    h.s.designation = notDesignated;
    expect((await h.pass(UP(), 1_000))?.word).toBe('absent');
    h.s.designation = designated();
    expect((await h.pass(downTick(), 1_000))?.word).toBe('restarting');
  });

  it('a dialog sighting then nobody designated, then designated again: the dialog clock starts fresh', async () => {
    const h = harness();
    await h.warm();
    const dlg = tickOf(session({ dialogPending: true }));
    expect((await h.pass(dlg, 40_000))?.word).not.toBe('dialog-open');
    h.s.designation = notDesignated;
    expect((await h.pass(UP(), 1_000))?.word).toBe('absent');
    h.s.designation = designated();
    expect((await h.pass(dlg, 1_000))?.word).not.toBe('dialog-open');
  });

  it('the last down sighting is dropped too: a body up after a re-designation adds no restart in progress', async () => {
    const h = harness();
    await h.warm();
    h.s.restarts = 1;
    expect((await h.pass(downTick(), 1_000))?.word).toBe('restarting');
    h.s.designation = notDesignated;
    await h.pass(UP(), 1_000);
    h.s.designation = designated();
    h.s.restarts = 2;
    expect((await h.pass(UP(), 1_000))?.word).not.toBe('dead');
  });
});

describe('an identity the wiring cannot read (F14)', () => {
  it('reads the generation and the restarts unmeasured, never falling back to the session id', async () => {
    const h = harness();
    await h.warm();
    h.calls.liveGeneration.length = 0; h.calls.restartsSince.length = 0;
    h.s.identityThrows = true;
    const r = await h.pass(UP());
    expect(r?.word).toBe('unmeasured');
    expect(r?.why).toContain('identity boom');
    expect(h.calls.liveGeneration).toEqual([]);
    expect(h.calls.restartsSince).toEqual([]);
  });
});

describe('the daily prune (F15)', () => {
  const DAY = 24 * 3_600_000;
  const stale = (h: ReturnType<typeof harness>) => recordReadiness(h.db, { word: 'wedged', why: null, until: null, strandCause: null, restartable: false, sessionId: A }, 1);
  const staleRows = (h: ReturnType<typeof harness>) => Number((h.db.prepare('SELECT COUNT(*) AS n FROM overlord_readiness WHERE at = 1').get() as { n: number }).n);

  it('two passes within a day prune once; a pass a day later prunes again', async () => {
    const h = harness();
    expect(stale(h).ok).toBe(true);
    await h.pass(UP());                   // the first pass prunes
    expect(staleRows(h)).toBe(0);
    expect(stale(h).ok).toBe(true);
    await h.pass(UP());                   // 10 s later: no prune
    expect(staleRows(h)).toBe(1);
    h.advance(DAY);
    await h.pass(UP());                   // a day later: prunes
    expect(staleRows(h)).toBe(0);
  });
});

// ── The fix round of review 3941 ────────────────────────────────────────────────────────────────────────────────────────

describe('an unreadable designation keeps every sighting (R1)', () => {
  const unreadable = (h: ReturnType<typeof harness>, how: 'read' | 'throws'): void => {
    if (how === 'throws') h.s.designationThrows = true;
    else h.s.designation = { kind: 'unmeasured', why: 'designation store busy' };
  };
  const readable = (h: ReturnType<typeof harness>): void => { h.s.designationThrows = false; h.s.designation = designated(); };

  for (const how of ['read', 'throws'] as const) {
    it(`a restart under way is not forgotten across a pass whose designation is unreadable (${how}): dead or unmeasured, never better, one push`, async () => {
      const h = harness();
      await h.warm();
      h.s.restarts = 2; // two restarts already counted in the hour, a proven generation that started 100 s before W0
      expect(await h.pass(downTick(), 1_000)).toMatchObject({ word: 'dead', why: 'third-restart' });
      expect(h.pushes).toHaveLength(1);

      unreadable(h, how);
      const blind = await h.pass(UP(), 1_000);
      expect(blind?.word).toBe('unmeasured'); // never better than what it was
      expect(h.pushes).toHaveLength(1);

      // Readable again, the body up, and no generation minted yet (it started before the down sighting): still the third.
      readable(h);
      expect(await h.pass(UP(), 1_000)).toMatchObject({ word: 'dead', why: 'third-restart' });
      expect(h.pushes).toHaveLength(1);

      // The mint lands: restartsSince counts the restart itself.
      h.s.gen = genRow({ n: 2, startReportedAt: h.s.wall });
      h.s.restarts = 3;
      expect(await h.pass(UP(), 1_000)).toMatchObject({ word: 'dead', why: 'third-restart' });
      expect(h.pushes).toHaveLength(1);
      // One episode across the blind pass: the first dead row carries the push mark, the second (after `unmeasured`) none.
      const marks = h.db.prepare("SELECT pushedAt FROM overlord_readiness WHERE word = 'dead' ORDER BY id").all() as { pushedAt: number | null }[];
      expect(marks.map((m) => m.pushedAt !== null)).toEqual([true, false]);
    });
  }

  it('a dialog sighting keeps its first clock across a pass whose designation is unreadable', async () => {
    const h = harness();
    await h.warm();
    const dlg = tickOf(session({ dialogPending: true }));
    expect((await h.pass(dlg, 20_000))?.word).not.toBe('dialog-open'); // the sighting
    unreadable(h, 'read');
    expect((await h.pass(dlg, 20_000))?.word).toBe('unmeasured');
    readable(h);
    // 40 s since the sighting: on the original clock it is open; with the sighting forgotten it would restart at 0.
    expect((await h.pass(dlg, 1_000))?.word).toBe('dialog-open');
  });
});

describe('the ready clock is the ready row\'s own session (R2)', () => {
  it('a designated session that became ready hears an operator message left unanswered past the deaf bound: deaf', async () => {
    const h = harness();
    await h.warm(); // ready, recorded for A at W0 + 10 s
    const ready = readinessNow(h.db);
    expect(ready.ok && ready.now !== 'none' && [ready.now.word, ready.now.readySessionId, ready.now.readySince]).toEqual(['ready', A, W0 + 10_000]);
    h.s.inbox = [{ id: 1, at: W0, term: 1, state: 'recorded', cut: false }];
    // Within the bound of the later of the arrival and readySince: not deaf yet.
    expect((await h.pass(UP(), 1_000))?.word).toBe('ready');
    h.advance(READINESS_DEAF_MS);
    expect((await h.pass(UP()))?.word).toBe('deaf');
  });
});

describe('a crash loop whose generation never proved (R3)', () => {
  it('two restarts counted over an unproved generation: restarting, then renewing, never ready; the third mint reads dead with one push', async () => {
    const h = harness();
    h.s.gen = genRow({ state: 'active', proven: false, startReportedAt: W0 - 1_000 }); // minted, never proved: read as renewing
    h.s.restarts = 2;
    await h.pass(UP());
    const seen: string[] = [];
    const note = async (t: ReadinessTick, ms: number): Promise<void> => { seen.push((await h.pass(t, ms))?.word ?? 'null'); };
    await note(UP(), 1_000);
    await note(downTick(), READINESS_RESTART_BOUND_MS + 1_000); // the first sighting
    await note(downTick(), 1_000); // down past the bound, but the generation reads renewing
    await note(UP(), 1_000);
    await note(UP(), 1_000);
    expect(seen).toEqual(['renewing', 'restarting', 'renewing', 'renewing', 'renewing']);
    expect(seen).not.toContain('ready');
    expect(seen).not.toContain('unproved');
    expect(h.pushes).toEqual([]);

    h.s.gen = genRow({ n: 3, state: 'active', proven: false, startReportedAt: h.s.wall });
    h.s.restarts = 3;
    expect(await h.pass(UP(), 1_000)).toMatchObject({ word: 'dead', why: 'third-restart' });
    expect(h.pushes).toHaveLength(1);
    expect(await h.pass(UP(), 1_000)).toMatchObject({ word: 'dead', why: 'third-restart' });
    expect(h.pushes).toHaveLength(1);
  });
});

describe('an item raised with the push outbox reach (R4)', () => {
  /** The watcher's item reach, as `pushSender.ts#itemBoundOf` builds it: a push service that records, a stamp for the response record. */
  const reachRig = () => {
    const seam = pushSeam();
    const stamp: ResponseStamp = { boot: { kind: 'measured', epoch: 3 }, restore: { kind: 'unmeasured' } };
    const deps: SenderDeps = { push: seam.push, time: fakeTime({ wallMs: W0 }).ports, responseStamp: () => stamp };
    const itemReach: ItemReachOf = (item) => itemBoundOf(deps, item, 'reach');
    return { seam, itemReach };
  };
  const outbox = (db: DatabaseSync) => db.prepare('SELECT sourceKind, sourceId, state, silentWhy, tag FROM push_outbox ORDER BY id').all();
  const waiting = (db: DatabaseSync) => db.prepare("SELECT refKind, refId FROM operator_responses WHERE kind = 'waiting' ORDER BY id").all();
  const reachStamp = (db: DatabaseSync, id: number) => (db.prepare('SELECT reachedOperatorAt AS r FROM operator_items WHERE id = ?').get(id) as { r: number | null }).r;

  const cases: { kind: 'stranded' | 'count' | 'hold'; neededBy: string; arrange: (h: ReturnType<typeof harness>) => void }[] = [
    { kind: 'stranded', neededBy: 'soon', arrange: (h) => { h.s.candidates = { kind: 'candidates', list: [] }; } },
    { kind: 'count', neededBy: 'later', arrange: (h) => { h.s.candidates = ONE_YES; } },
    { kind: 'hold', neededBy: 'later', arrange: (h) => { h.s.holds = { kind: 'read', lanes: ['lane-a'] }; } },
  ];
  for (const c of cases) {
    it(`a ${c.kind} raise writes its reach (stamp, response record, one silent outbox row) in the raise, is not blocking and sends nothing`, async () => {
      const h = harness();
      const { seam, itemReach } = reachRig();
      await h.warm();
      c.arrange(h);
      await h.lane.pass(UP(), itemReach);
      const its = items(h.db);
      expect(its).toMatchObject([{ neededBy: c.neededBy, state: 'open' }]);
      expect(records(h.db)).toMatchObject([{ item: c.kind, settledAt: null }]);
      const id = its[0]!.id;
      expect(reachStamp(h.db, id)).not.toBeNull();
      expect(outbox(h.db)).toEqual([{ sourceKind: 'item', sourceId: id, state: 'silent', silentWhy: 'level', tag: `item-${id}` }]);
      expect(waiting(h.db)).toEqual([{ refKind: 'item', refId: id }]);
      expect(seam.sent).toEqual([]);
      expect(h.pushes).toEqual([]);
      // A standing cause raises once and still sends nothing on the next pass.
      await h.lane.pass(UP(), itemReach);
      expect(items(h.db)).toHaveLength(1);
      expect(outbox(h.db)).toHaveLength(1);
      expect(seam.sent).toEqual([]);
    });
  }

  it('the pass given no reach (a script, a test) still raises the item and writes no outbox row', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = { kind: 'candidates', list: [] };
    await h.pass(UP());
    expect(items(h.db)).toHaveLength(1);
    expect(outbox(h.db)).toEqual([]);
  });
});

describe('the holds (renewal readings PR H): read once a pass, into the candidates, the word and the items', () => {
  it('the holds are read once a pass and handed to the candidates as the list\'s holds', async () => {
    const h = harness();
    await h.warm();
    let reads = 0;
    const handed: unknown[] = [];
    h.s.holds = { kind: 'read', lanes: ['lane-a'] };
    const holds = h.port.holds;
    (h.port as { holds: ReadinessLanePort['holds'] }).holds = () => { reads += 1; return holds(); };
    (h.port as { candidates: ReadinessLanePort['candidates'] }).candidates = (_d, held) => { handed.push(held); return h.s.candidates; };
    await h.pass(UP());
    expect(reads).toBe(1);
    expect(handed).toEqual([{ ok: true, lanes: ['lane-a'] }]);
  });

  it('holds that cannot be read reach the word as unmeasured, never as no holds, and the candidates as unread', async () => {
    const h = harness();
    await h.warm();
    const handed: unknown[] = [];
    (h.port as { candidates: ReadinessLanePort['candidates'] }).candidates = (_d, held) => { handed.push(held); return h.s.candidates; };
    h.s.holds = { kind: 'unmeasured' };
    const r = await h.pass(UP());
    expect([r?.word, r?.why]).toEqual(['unmeasured', 'stranded: holds unread']);
    expect(handed).toEqual([{ ok: false, detail: 'the holds could not be read' }]);
  });

  it('a holds read that throws reads as unmeasured too', async () => {
    const h = harness();
    await h.warm();
    (h.port as { holds: ReadinessLanePort['holds'] }).holds = () => { throw new Error('holds boom'); };
    const r = await h.pass(UP());
    expect([r?.word, r?.why]).toEqual(['unmeasured', 'stranded: holds unread']);
  });

  it('a hold that leaves only an account at its ceiling reaches the word as stranded (limited)', async () => {
    const h = harness();
    await h.warm();
    h.s.holds = { kind: 'read', lanes: ['lane-a'] };
    // the list the wiring builds with lane-a held out leaves lane-b, at its ceiling
    h.s.candidates = { kind: 'candidates', list: [{ id: 'lane-b', limits: undefined, serves: 'at-ceiling' }] };
    const r = await h.pass(UP());
    expect([r?.word, r?.why]).toEqual(['stranded', 'limited']);
  });
});
