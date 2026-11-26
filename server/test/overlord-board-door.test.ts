// Overlord W1, PR B2 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md` Task 6; spec §5.2 C10, C44, Table
// 11.1e): the board door, `GET /api/overlord/board?byId&byUuid`, through the REAL gate runner over a fixture `coord.db`, the REAL
// read runner and a real `OperatorModelStore` on a fixture file, with a gatherer built from fakes. Every fake reader counts its
// calls, so a case can say "nothing was gathered". Fixture names only; temp databases only; no live HOME is touched.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { SecretMasker } from '../src/accounts/mask.js';
import { issueActKey } from '../src/continuity/actKeyStore.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { openCoordDb } from '../src/coord/db.js';
import { overlordGateRun, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import { actKeyFact, advanceCounterGuarded, recordFenceRefusal } from '../src/coord/overlordGateStore.js';
import { registerOverlordBoardRoutes } from '../src/coord/overlordBoardRoutes.js';
import type { BoardGatherPorts, BoardStore } from '../src/coord/overlordBoardRead.js';
import { runOverlordRead } from '../src/coord/overlordRead.js';
import { createRunVerdicts } from '../src/coord/runVerdicts.js';
import { CoordStore } from '../src/coord/store.js';
import { localIOFor } from '../src/io.js';
import { ProjectWalkCache } from '../src/lifecycle.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { BOARD_PARTS, type OverlordBoardAnswer } from '../../shared/overlordBoard.js';
import type { ReadDoor } from '../../shared/operatorMessages.js';
import { READ_CEILINGS } from '../../shared/overlordInbox.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { loadConfig } from '../src/config.js';
import { seedRoster } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const TOKEN = 'a'.repeat(64);
const BODY = 'lane-a-overlord';            // the Overlord's session id
const OTHER = 'lane-b-project-a';          // any other session
const COORD_A = 'lane-a-prog-a-coordinator';
const COORD_B = 'lane-b-prog-b-coordinator';
const INC = 'inc-1';
const DESIGNATED: DesignationRead = {
  kind: 'designated', sessionId: BODY, term: 1,
  row: { bound: { sessionId: BODY, generation: INC }, pending: null, term: 1, designatedTerm: 1 },
} as unknown as DesignationRead;
const issuer = (): PrivacyIssuer => {
  let last = 0;
  return { kind: 'ready', issue: (high) => { last = Math.max(high ?? 0, last) + 1; return { ok: true, id: last }; } };
};

let s: CoordStore;
let seq = 0;
beforeAll(() => { s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-board-door-'), '.ccrc', 'coord.db'))); });
afterAll(removeTmpFixtures);
const apps: FastifyInstance[] = [];
const dbs: DatabaseSync[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  await Promise.all(apps.splice(0).map((a) => a.close()));
  s.db.exec('DELETE FROM overlord_fence_refusals');
});

/** Mint the Overlord identity's next generation, active, with an act key (the sequence door suite's own fixture). */
function fresh(): GenRow {
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
  s.db.prepare("UPDATE continuity_generations SET state = 'active', deadlineAt = NULL WHERE id = ?").run(m.id);
  const after = s.liveGenerations();
  if (!after.ok) throw new Error(after.detail);
  const gen = after.rows.find((g) => g.id === m.id)!;
  const issued = issueActKey(s.db, { generationId: gen.id, nonceSha256: createHash('sha256').update(`n-${seq}`).digest('hex'),
    keySha256: createHash('sha256').update(`key-${seq}`, 'utf8').digest('hex'), issuedAt: NOW });
  if (!issued.ok) throw new Error('key not issued');
  return gen;
}

// ── the gatherer's fakes ────────────────────────────────────────────────────────────────────────────────────────────
// What the fixture store holds; `*Fixture` text is sentinel text (C44) the board must never carry.
const SENT = {
  why: 'SENTINEL-ITEM-WHY-7f3a', how: 'SENTINEL-ITEM-HOW-91bc', answer: 'SENTINEL-ITEM-ANSWER-c4d2', note: 'SENTINEL-ITEM-NOTE-0e8f',
  mod: 'SENTINEL-MODIFICATION-TEXT-52aa', timer: 'SENTINEL-TIMER-NOTE-b7c1',
} as const;

const programme = (slug: string, title: string, coordinator: string) => ({
  slug, title, currentWave: 1, waveOf: 3, claimedBy: coordinator, coordinator, coordinatorLine: null, lifecycle: null,
  waves: { working: 1, waiting: 0, queued: 1, done: 0, failed: 0 }, stuck: 0, lastMoveAt: NOW - 1_000, ending: null,
});
const item = (id: number, program: string, title: string) => ({
  id, program, runId: null, raisedBy: 'lane-a-coordinator', kind: 'decide', title, why: SENT.why, how: [SENT.how], options: null, neededBy: 'soon',
  soonLabel: null, secretSlot: null, state: 'open', answer: SENT.answer, note: SENT.note, raisedAt: NOW - 5_000, tickedAt: null, closedAt: null,
  recommended: null, recommendedWhy: null, action: null, heldUntil: null, revision: 0,
});

interface Fixture {
  programmes: ReturnType<typeof programme>[];
  items: Record<string, ReturnType<typeof item>[]>;
  /** The store members that throw when called. */
  throws: ReadonlySet<keyof BoardStore>;
  /** Goal text the pin carries (it is the board's own "In short", so it may appear). */
  inShort: string | null;
}
const defaultFixture = (): Fixture => ({
  programmes: [programme('prog-a', 'Programme A', COORD_A), programme('prog-b', 'Programme B', COORD_B)],
  items: { 'prog-a': [item(11, 'prog-a', 'Decide the naming')], 'prog-b': [] },
  throws: new Set(),
  inShort: 'Ship programme A',
});

interface Gathered {
  ports: BoardGatherPorts;
  /** How many times any reader of the gatherer was called (the store's members, the listing, the thunks, the directory reads). */
  touched: () => number;
}
function gatherer(f: Fixture): Gathered {
  let n = 0;
  const hit = (): void => { n += 1; };
  const guard = <T>(name: keyof BoardStore, v: () => T): T => { hit(); if (f.throws.has(name)) throw new Error(`a fixture fault in ${name}`); return v(); };
  const store = {
    readProgrammes: () => guard('readProgrammes', () => ({ ok: true, programmes: f.programmes, closedToday: { operator: 0, sweep: 0, coordinator: 0 } })),
    goalsFor: (slug: string) => guard('goalsFor', () => ({
      program: slug, specPath: null, inShort: f.inShort, inShortAt: NOW, doneWhen: ['Done when programme A ships'],
      modifications: [{ id: 1, at: NOW, text: SENT.mod, ruling: null, itemId: null, pr: null, merged: false }],
    })),
    itemsFor: (slug: string) => guard('itemsFor', () => ({ open: f.items[slug] ?? [], cleared: [] })),
    stallObservationsSince: () => guard('stallObservationsSince', () => ({ ok: true, rows: [] })),
    caps: () => guard('caps', () => ({ maxConcurrentWorkers: 3 })),
    capsUsage: () => guard('capsUsage', () => ({ running: 1 })),
    pendingTimers: () => guard('pendingTimers', () => ({
      ok: true, rows: [{ id: 1, setter: COORD_A, dueAt: NOW + 60_000, note: SENT.timer }, { id: 2, setter: COORD_A, dueAt: NOW + 30_000, note: SENT.timer }],
    })),
  } as unknown as BoardStore;
  const home = mkTmp('ccrc-board-door-home-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home });
  const io = localIOFor(home);
  const countingIo = { ...io, readdir: (...a: Parameters<typeof io.readdir>) => { hit(); return io.readdir(...a); } };
  const ports: BoardGatherPorts = {
    coord: store,
    verdicts: () => { hit(); return createRunVerdicts(); },
    lifecycle: async (a) => { hit(); return a; },
    listing: () => { hit(); return { sessions: [{ id: COORD_A, status: 'idle' }] }; },
    projects: { io: countingIo as typeof io, cfg, cache: new ProjectWalkCache(() => NOW) },
    portfolio: () => {
      hit();
      return { at: NOW, revision: 4, programmes: f.programmes.map((p, i) => ({ slug: p.slug, title: p.title, rank: { position: i + 1, cls: 'standard', fixedDate: null },
        cls: 'standard', wip: { working: 1, waiting: 0, queued: 0 }, oldestOpenMs: null })) } as never;
    },
    ladder: () => { hit(); return { kind: 'measured', effective: { rung: 'full', operatorRung: 'full' } } as never; },
    readiness: () => { hit(); return { ok: true, wire: { word: 'unmeasured', since: NOW, why: null, until: null, questionsGo: 'no' } } as never; },
    isolation: () => { hit(); return { kind: 'measured', word: 'shared-user', cause: 'same-user' } as never; },
    now: () => NOW,
  };
  return { ports, touched: () => n };
}

// ── the rig ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Rig {
  app: FastifyInstance; gen: GenRow; store: OperatorModelStore; touched: () => number;
  lines: () => Record<string, unknown>[];
}
interface RigOpts {
  words?: readonly string[];
  fixture?: Fixture;
  ledgerFails?: boolean;
  /** Gate facts to replace (a refusal driven through the real gate). */
  gate?: Partial<OverlordGateDeps>;
}
async function rig(o: RigOpts = {}): Promise<Rig> {
  const gen = fresh();
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-board-door-store-')));
  dbs.push(db);
  const store = new OperatorModelStore(db, issuer());
  const gateDeps: OverlordGateDeps = {
    identity: {
      session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: { kind: 'session', subject: sessionId } as never }),
      incarnation: async () => ({ kind: 'measured', incarnation: INC }) as never,
    },
    designation: () => DESIGNATED,
    authority: () => ({ kind: 'coherent' }),
    ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [] } }),
    generations: () => s.liveGenerations(),
    continuityLive: () => true,
    cardRead: () => ({ ok: true, read: { current: true } as never }),
    actKey: (g, k) => actKeyFact(s.db, g, k),
    counter: (g, c) => advanceCounterGuarded(s.db, g, c),
    witness: () => ({ kind: 'witnessed', witnessId: 7 }),
    recordWitness: () => true,
    recordFenceRefusal: (r) => { recordFenceRefusal(s.db, r); },
    serverWords: () => o.words ?? ['overlord-v1'],
    now: () => NOW,
    ...o.gate,
  };
  const ledger = o.ledgerFails === true
    ? { servedReadsSince: (d: ReadDoor, t: number) => store.servedReadsSince(d, t), recordRead: () => ({ ok: false as const, error: 'write-failed' as const, detail: 'a fixture write failure' }) }
    : store;
  const g = gatherer(o.fixture ?? defaultFixture());
  const app = Fastify({ logger: false });
  apps.push(app);
  registerOverlordBoardRoutes(app, {
    mailToken: () => TOKEN, gate: overlordGateRun(gateDeps),
    readRunner: runOverlordRead({ ledger, turn: async () => 'done', now: () => NOW }),
    board: g.ports,
  });
  await app.ready();
  return {
    app, gen, store, touched: g.touched,
    lines: () => db.prepare('SELECT door, caller, scope, count, outcome FROM read_ledger ORDER BY id').all() as never,
  };
}

const HEADERS = { 'x-ccrc-mail-token': TOKEN };
const board = (r: Rig, who = BODY, headers: Record<string, string> = HEADERS): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'GET', url: `/api/overlord/board?byId=${who}&byUuid=u-1`, headers });
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
const served = (count: number) => ({ door: 'board', caller: 'overlord', scope: 'fleet', count, outcome: 'rows' });
/** The door's refusal left nothing behind: nothing was gathered and no ledger line was written. */
const untouched = (r: Rig): void => { expect([r.touched(), r.lines()]).toEqual([0, []]); };

describe('GET /api/overlord/board: the gate first, nothing gathered before every refusal has had its turn', () => {
  it('no box token, or a wrong one, is 401 unauthenticated; a missing pair is 400: nothing gathered, no line', async () => {
    const r = await rig();
    const none = await board(r, BODY, {});
    expect(none.statusCode).toBe(REFUSAL_STATUS.unauthenticated);
    expect(json(none)).toMatchObject({ ok: false, error: 'unauthenticated' });
    expect((await board(r, BODY, { 'x-ccrc-mail-token': 'b'.repeat(64) })).statusCode).toBe(REFUSAL_STATUS.unauthenticated);
    const bare = await r.app.inject({ method: 'GET', url: '/api/overlord/board', headers: HEADERS });
    expect(bare.statusCode).toBe(400);
    expect(json(bare)).toMatchObject({ ok: false, error: 'bad-request' });
    untouched(r);
  });

  it('a session that is not the designated one is refused not-the-overlord: nothing gathered, no line', async () => {
    const r = await rig();
    const res = await board(r, OTHER);
    expect(res.statusCode).toBe(REFUSAL_STATUS['not-the-overlord']);
    expect(json(res)).toMatchObject({ ok: false, error: 'not-the-overlord' });
    untouched(r);
  });

  it('without the overlord-v1 word in the gate\'s server words: capability-missing, nothing gathered, no line', async () => {
    const r = await rig({ words: ['continuity-v1'] });
    const res = await board(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['capability-missing']);
    expect(json(res)).toMatchObject({ error: 'capability-missing' });
    untouched(r);
  });

  it.each([
    ['card-unread', 'an unread card', (): Partial<OverlordGateDeps> => ({ cardRead: () => ({ ok: true, read: null }) })],
    ['overlord-off', "the operator's rung off", (): Partial<OverlordGateDeps> => ({ ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'off', binding: [], readBy: [] } }) as never })],
  ] as const)('%s (%s) is refused: nothing gathered, no line', async (word, _what, gate) => {
    const r = await rig({ gate: gate() });
    const res = await board(r);
    expect([res.statusCode, json(res)['error']], res.body).toEqual([REFUSAL_STATUS[word], word]);
    untouched(r);
  });

  it('renewing (the generation draining) is refused: nothing gathered, no line', async () => {
    const r = await rig();
    s.db.prepare("UPDATE continuity_generations SET state = 'draining' WHERE id = ?").run(r.gen.id);
    const res = await board(r);
    expect([res.statusCode, json(res)['error']], res.body).toEqual([REFUSAL_STATUS.renewing, 'renewing']);
    untouched(r);
  });

  // Call 1590 (slug history-and-board-reads-attributed-not-proven): the board row is not a write, so the door runs no fence.
  it('the designated id with no act key and no fence headers is served: the row is not fenced, so the read is attributed, not proven', async () => {
    const r = await rig();
    const res = await board(r);
    expect(res.statusCode, res.body).toBe(200);
    expect(r.touched()).toBeGreaterThan(0);
    expect(r.lines()).toEqual([served(2)]);
  });
});

describe('GET /api/overlord/board: one line a read past the gates', () => {
  it('a served read answers 200 { ok, at, board } with every part, and writes exactly one line; two reads write two', async () => {
    const r = await rig();
    const res = await board(r);
    expect(res.statusCode, res.body).toBe(200);
    const body = json(res) as unknown as OverlordBoardAnswer;
    expect(body.ok).toBe(true);
    expect(body.at).toBe(NOW);
    expect(Object.keys(body.board).sort()).toEqual([...BOARD_PARTS].sort());
    expect(body.board.identity).toMatchObject({ state: 'measured', programmes: [{ slug: 'prog-a' }, { slug: 'prog-b' }] });
    expect(body.board.capacity).toEqual({ state: 'measured', maxConcurrentWorkers: 3, running: 1 });
    expect(r.lines()).toEqual([served(2)]);
    expect((await board(r)).statusCode).toBe(200);
    expect(r.lines()).toEqual([served(2), served(2)]);
  });

  it('the board asks each per-programme reader once for each programme, and the others once', async () => {
    const f = defaultFixture();
    const calls: string[] = [];
    const r = await rig({ fixture: { ...f, items: new Proxy(f.items, { get: (t, k) => { if (typeof k === 'string') calls.push(k); return t[k as string]; } }) } });
    expect((await board(r)).statusCode).toBe(200);
    expect(calls.sort()).toEqual(['prog-a', 'prog-b']);
  });

  it('a store reader that throws (caps) is that part unmeasured threw, never a 5xx: still 200 and exactly one line', async () => {
    const r = await rig({ fixture: { ...defaultFixture(), throws: new Set(['caps']) } });
    const res = await board(r);
    expect(res.statusCode, res.body).toBe(200);
    const b = (json(res) as unknown as OverlordBoardAnswer).board;
    expect(b.capacity).toEqual({ state: 'unmeasured', reason: 'threw' });
    expect(b.identity.state).toBe('measured');
    expect(Object.keys(b).sort()).toEqual([...BOARD_PARTS].sort());
    expect(r.lines()).toEqual([served(2)]);
  });

  it('the programmes read that throws leaves identity, goals, work and timers unmeasured threw, the rest measured; the line counts 0', async () => {
    const r = await rig({ fixture: { ...defaultFixture(), throws: new Set(['readProgrammes']) } });
    const res = await board(r);
    expect(res.statusCode, res.body).toBe(200);
    const b = (json(res) as unknown as OverlordBoardAnswer).board;
    for (const part of ['identity', 'goals', 'work', 'timers'] as const) expect(b[part], part).toEqual({ state: 'unmeasured', reason: 'threw' });
    expect(b.capacity).toMatchObject({ state: 'measured' });
    expect(b.portfolio).toMatchObject({ state: 'measured' });
    expect(res.body).not.toContain('a fixture fault');
    expect(r.lines()).toEqual([served(0)]);
  });

  it('every store reader throwing at once is still a 200 board of closed words and one line', async () => {
    const all = new Set<keyof BoardStore>(['readProgrammes', 'goalsFor', 'itemsFor', 'stallObservationsSince', 'caps', 'capsUsage', 'pendingTimers']);
    const r = await rig({ fixture: { ...defaultFixture(), throws: all } });
    const res = await board(r);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('a fixture fault');
    expect(Object.keys((json(res) as unknown as OverlordBoardAnswer).board).sort()).toEqual([...BOARD_PARTS].sort());
    expect(r.lines()).toEqual([served(0)]);
  });

  it('a ledger whose write fails answers 503 write-failed and sends no board', async () => {
    const r = await rig({ ledgerFails: true });
    const res = await board(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['write-failed']);
    expect(json(res)).toMatchObject({ ok: false, error: 'write-failed' });
    expect(res.body).not.toContain('prog-a');
    expect(res.body).not.toContain('"board"');
  });
});

describe('GET /api/overlord/board: the read ceiling', () => {
  const line = (r: Rig, door: ReadDoor, at = NOW - 60_000): void => {
    const w = r.store.recordRead({ at, door, caller: 'overlord', scope: door === 'board' ? 'fleet' : 'all', count: 1, outcome: 'rows', generation: null, generationRead: 'unmeasured', turnState: 'done' });
    if (!w.ok) throw new Error(`fixture line refused: ${w.detail}`);
  };

  it('with the ceiling\'s worth of served board lines in the window, the next read is read-ceiling with retryAfterS, and nothing is gathered', async () => {
    const r = await rig();
    for (let i = 0; i < READ_CEILINGS.board.perHour; i += 1) line(r, 'board');
    const res = await board(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['read-ceiling']);
    expect(json(res)).toMatchObject({ ok: false, error: 'read-ceiling', retryAfterS: expect.any(Number) });
    expect(r.touched()).toBe(0);
    expect(res.body).not.toContain('prog-a');
  });

  it('lines of other doors do not count against the board\'s ceiling', async () => {
    const r = await rig();
    for (const door of ['history', 'sequence', 'messages', 'inbox'] as const) for (let i = 0; i < READ_CEILINGS[door].perHour + 5; i += 1) line(r, door);
    for (let i = 0; i < READ_CEILINGS.board.perHour - 1; i += 1) line(r, 'board');
    const res = await board(r);
    expect(res.statusCode, res.body).toBe(200);
    expect(r.touched()).toBeGreaterThan(0);
    // that read was the ceiling's last: the next one is refused
    expect((await board(r)).statusCode).toBe(REFUSAL_STATUS['read-ceiling']);
  });

  it('board lines older than the window do not count', async () => {
    const r = await rig();
    for (let i = 0; i < READ_CEILINGS.board.perHour; i += 1) line(r, 'board', NOW - 3_600_001);
    expect((await board(r)).statusCode).toBe(200);
  });
});

describe('GET /api/overlord/board: the server\'s answer mask', () => {
  it('a secret the masker knows, in a programme title and its coordinator\'s id, is gone from the answer once the door\'s JSON is masked as the answer hook masks it', async () => {
    const SECRET = 'Zq7'.repeat(12);
    const mdb = openCoordDb(path.join(mkTmp('ccrc-board-door-mask-'), '.ccrc', 'coord.db'));
    dbs.push(mdb);
    const masker = new SecretMasker({ db: mdb, token: () => TOKEN, log: () => {} });
    expect(masker.ingestSecret('lane-a', SECRET)).toBe('masked');
    const f = defaultFixture();
    f.programmes = [programme('prog-a', `Programme ${SECRET} A`, SECRET), programme('prog-b', 'Programme B', COORD_B)];
    const r = await rig({ fixture: f });
    const res = await board(r);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(SECRET);   // the control: the fixture text rides the door's answer, and only the masker hides it
    // `server.ts`'s preSerialization hook is `mk.maskDeep(payload)` over the route's payload (the masker the server holds).
    const masked = JSON.stringify(masker.maskDeep(JSON.parse(res.body)));
    expect(masked).not.toContain(SECRET);
    expect(masked).toContain('prog-a');
    expect(masked).toContain('Programme B');
  });
});

describe('GET /api/overlord/board: no text a part does not carry (C44)', () => {
  it('items\' why and how, goals\' modifications and timers\' notes are in no part of the answer', async () => {
    const r = await rig();
    const res = await board(r);
    expect(res.statusCode, res.body).toBe(200);
    for (const [name, sentinel] of Object.entries(SENT)) expect(res.body, name).not.toContain(sentinel);
    // the controls: what a part does carry is there, so the absence above is the composer's and not an empty board
    expect(res.body).toContain('Decide the naming');
    expect(res.body).toContain('Ship programme A');
    const b = (json(res) as unknown as OverlordBoardAnswer).board;
    expect(b.goals).toMatchObject({ programmes: [{ goals: { modifications: 1 } }, { goals: { modifications: 1 } }] });
    expect(b.timers).toMatchObject({ programmes: [{ slug: 'prog-a', pending: 2, nextDueAt: NOW + 30_000 }, { slug: 'prog-b', pending: 0 }] });
  });
});
