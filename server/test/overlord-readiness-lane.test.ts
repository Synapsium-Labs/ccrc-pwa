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
import { itemById, moveItemInTx } from '../src/coord/ledgersStore.js';
import { itemBoundOf, type SenderDeps } from '../src/pushSender.js';
import type { ItemReachOf } from '../src/coord/pushOutboxStore.js';
import { OVERLORD_ITEM_PROGRAMME } from '../../shared/overlord-sequence.js';
import { fakeTime } from './fakeTime.js';
import { pushSeam } from './pushSeam.js';
import { readinessNow, recordReadiness } from '../src/coord/overlordReadinessStore.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import type { FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { Candidates } from '../src/accountLoad.js';
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
    ladderThrows: false, unsettledThrows: false,
    gen: genRow() as GenRow | null,
    restarts: 0,
    candidates: twoYes as Candidates,
    served: W0 - 1_000 as number | 'none',
  };
  const pushes: ReadinessPush[] = [];
  const logs: string[] = [];
  const port: ReadinessLanePort = {
    db,
    clock: { wall: () => s.wall, mono: () => s.mono },
    designation: () => s.designation,
    ladder: () => { if (s.ladderThrows) throw new Error('ladder boom'); return { kind: 'read', operatorRung: 'on' as never }; },
    mailDisabled: (names) => (names === null ? 'unmeasurable' : 'clear'),
    identityOf: (id) => id,
    liveGeneration: () => ({ ok: true, row: s.gen }),
    effective: (r) => ({ state: r.state, deadlineAt: r.deadlineAt }),
    restartsSince: () => ({ ok: true, count: s.restarts }),
    candidates: () => s.candidates,
    resets: () => ({ ok: true, value: {} }),
    turnMark: async () => ({ ok: false, reason: 'absent' }),
    hookState: async () => ({ ok: false, reason: 'no-state' }),
    strandUnreadable: () => false,
    unsettled: () => { if (s.unsettledThrows) throw new Error('inbox boom'); return { kind: 'measured', value: [] }; },
    lastServedReadAt: () => ({ kind: 'measured', value: s.served }),
    lastContinuityRead: () => ({ ok: true, at: null }),
    holds: () => ({ kind: 'not-wired' }),
    push: (p) => { pushes.push(p); },
    log: (l) => { logs.push(l); },
  };
  const lane = new ReadinessLane(port);
  /** A pass, then `ms` later on both clocks. */
  const pass = async (tick: ReadinessTick, advanceMs = 10_000, reach?: ItemReachOf) => {
    const r = await lane.pass(tick, reach);
    s.wall += advanceMs; s.mono += advanceMs;
    return r;
  };
  const advance = (ms: number) => { s.wall += ms; s.mono += ms; };
  /** Boot pass, then one measured pass over a healthy body: the word is `ready`. */
  const warm = async () => { await pass(UP()); const r = await pass(UP()); expect(r?.word).toBe('ready'); };
  const words = () => (db.prepare('SELECT word, why FROM overlord_readiness ORDER BY id').all() as { word: string; why: string | null }[]);
  return { db, s, port, lane, pushes, logs, pass, advance, warm, words };
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
  it('an empty candidate list raises the stranded item set-admits-none, blocking, and not the count item', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = { kind: 'candidates', list: [] };
    const r = await h.pass(UP());
    expect(r).toMatchObject({ word: 'stranded', strandCause: 'set-admits-none' });
    expect(items(h.db)).toEqual([{ id: expect.any(Number), program: OVERLORD_ITEM_PROGRAMME, raisedBy: 'ccrc', kind: 'do',
      title: 'The Overlord cannot run: its set admits no account that can serve it', neededBy: 'blocking', state: 'open' }]);
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

  it('an itemReach handed to the pass writes the item\'s bound outbox row in the raise\'s transaction', async () => {
    const h = harness();
    await h.warm();
    h.s.candidates = { kind: 'candidates', list: [] };
    const deps = { push: pushSeam().push, time: fakeTime({ wallMs: W0 }).ports } as unknown as SenderDeps;
    await h.pass(UP(), 10_000, (item) => itemBoundOf(deps, item, 'reach'));
    const [it1] = items(h.db);
    expect(h.db.prepare('SELECT sourceKind, sourceId, state FROM push_outbox').all()).toEqual([{ sourceKind: 'item', sourceId: it1!.id, state: 'pending' }]);
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
