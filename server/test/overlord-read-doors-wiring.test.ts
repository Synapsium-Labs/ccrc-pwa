// Overlord W1 (sequence C and board B2): the composition root's wiring of the Overlord's two read doors, through the REAL server.
// Every route suite registers `GET /api/overlord/sequence` or `GET /api/overlord/board` itself, with stubbed readers, so nothing
// pinned what `buildServer` hands each door: a restore binding replaced by a constant, a sequence reader pointed at another handle,
// or a board reading its own project-walk cache instead of the server's stayed green everywhere. Here `buildServer` is built over
// a fixture HOME, a real `CoordStore` over the restore rig's migrated database, the rig's real journal, authority guard and restore
// state, a real `OperatorModelStore`, and the Overlord designated by the real writers, and both doors are called through the
// server's own gate, read runner and answer hook.
//
// THE MOCK STANDS FOR ONE WORD ONLY. The gate's step 2 reads the server's advertised words, and production does not advertise
// `overlord-v1` until the overlord-v1 piece ships, so in production both doors answer `capability-missing`. This file mocks
// `shared/api.ts`'s `SERVER_CAPS` for the one array the server reads per call (the real words, copied, as
// `overlord-gate-doors.test.ts` does) and adds that word, and nothing else; no source changes. The gate is NOT skipped: every
// other step runs for real, over real fixtures: the caller's registry row (step 1), the designation and its incarnation, the
// authority guard, the ladder's rows and composition, the live generation and its card read, and a case below removes the word
// again to show step 2 refusing. The one injected fact is the ladder's seven condition readers (all lifted), whose real readers
// need a launch profile's loads report that this file does not stage.
//
// What this file pins: the sequence door serves a page of the lines in the SERVER'S coord.db with the restore state's counter
// (7, a value no stub suite uses); the board answers from the server's own store, walks the projects root once for two reads and
// shares the projects route's own walk cache; the board's answer is masked by the server's answer hook. What it does not pin: the
// `deps.coord === undefined` arm of the sequence reader. A server with no coordination store has no designation (the gate's step 1
// reads `unmeasured` and refuses), so that arm is unreachable through the gate; the last case of each door says so by pinning the
// refusal. Fixture HOMEs and neutral names only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { SecretMasker } from '../src/accounts/mask.js';
import { issueActKey } from '../src/continuity/actKeyStore.js';
import type { GenRow, MintInput } from '../src/continuity/continuityStore.js';
import { CoordStore } from '../src/coord/store.js';
import { sequenceAfter, stampSequenceInTx } from '../src/coord/overlordSequenceStore.js';
import { tx } from '../src/coord/tx.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { buildServer, MASKED_GET_ROUTES, answerMasked, type Deps } from '../src/server.js';
import type { OverlordBoardAnswer } from '../../shared/overlordBoard.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { fakeTime } from './fakeTime.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { confirm, designateLive, restoreRigHooks, rig, rung, type Rig } from './overlordRestoreRig.js';
import { mkTmp } from './tmpHelpers.js';

// The server reads `SERVER_CAPS` per call through one imported binding. This mock hands it ONE array this file edits (the real
// words, copied), so a case can add `overlord-v1` and remove it again.
const { CAPS } = vi.hoisted(() => ({ CAPS: [] as string[] }));
vi.mock('../../shared/api.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../shared/api.js')>();
  CAPS.push(...m.SERVER_CAPS);
  return { ...m, SERVER_CAPS: CAPS };
});
const WORD = 'overlord-v1';
const withWord = (on: boolean): void => {
  const at = CAPS.indexOf(WORD);
  if (on && at < 0) CAPS.push(WORD);
  if (!on && at >= 0) CAPS.splice(at, 1);
};

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
restoreRigHooks();

const NOW = 1_800_000_000_000;
const BODY = 'lane-o-project-a';          // the Overlord's session id
const OTHER = 'lane-a-project-a';          // any other session
const INC = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const RESTORE_N = 7;                        // the fixture restore counter: not 0, and not the stub suites' 2
const H = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const uuidOf = (id: string): string => `u-${id}`;
const START_UUID = '11111111-2222-3333-4444-555555555555';
const issuer = (): PrivacyIssuer => {
  let last = 0;
  return { kind: 'ready', issue: (high) => { last = Math.max(high ?? 0, last) + 1; return { ok: true, id: last }; } };
};

/** The ladder's seven condition readers, every one lifted: the real readers need a launch profile's loads report and a sandbox
 *  check, which this file does not stage (the ladder's own suites hold them). The rows and the composition stay the real ones. */
const LIFTED: NonNullable<Deps['ladderInputs']> = {
  'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted',
  'load-past-95': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted',
};

let app: FastifyInstance | undefined;
const opened: DatabaseSync[] = [];
beforeEach(() => { withWord(true); });
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  for (const db of opened.splice(0)) if (db.isOpen) db.close();
  withWord(true);
  vi.restoreAllMocks();
});

interface World {
  app: FastifyInstance; r: Rig; coord: CoordStore; home: string; projectsRoot: string;
  /** Rows of the private store's read ledger, in order. */
  ledger: () => { door: string; caller: string; scope: string; count: number; outcome: string }[];
  /** How many times the server listed the projects root. */
  walks: () => number;
}

/** The Overlord's generation, active, with a card read of the newest snapshot (so step 8 reads current), over `coord`. */
function liveGeneration(coord: CoordStore): GenRow {
  const r0 = coord.insertStart({ sessionId: BODY, reportId: 'rr-1', uuid: START_UUID, source: 'startup', model: 'claude-opus-5-5',
    rowIncarnation: null, reportedAt: NOW, receivedAt: NOW, doorNonceSha256: null });
  if (!r0.ok) throw new Error('start not recorded');
  const mint: MintInput = { identity: 'overlord', sessionId: BODY, role: 'coordinator', term: 1, rowIncarnation: null, startId: r0.id,
    startReportedAt: NOW, resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000,
    proc: 'p1', now: NOW };
  const m = coord.mintGeneration(mint, null, true);
  if (!m.ok) throw new Error('not minted');
  coord.db.prepare("UPDATE continuity_generations SET state = 'active', deadlineAt = NULL WHERE id = ?").run(m.id);
  const live = coord.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const gen = live.rows.find((g) => g.id === m.id)!;
  if (!issueActKey(coord.db, { generationId: gen.id, nonceSha256: createHash('sha256').update('n-1').digest('hex'),
    keySha256: createHash('sha256').update('key-1', 'utf8').digest('hex'), issuedAt: NOW }).ok) throw new Error('key not issued');
  const hash = 'c'.repeat(64);
  if (!coord.insertSnapshot({ id: 'snap-1', sessionId: BODY, at: NOW, facts: '{}', hash }).ok) throw new Error('snapshot');
  if (!coord.insertCardRead({ sessionId: BODY, uuid: START_UUID, snapshotId: 'snap-1', hash, pages: 1, at: NOW + 1 }).ok) throw new Error('card read');
  return gen;
}

/** The real server over a fixture HOME with the Overlord designated and every gate fact standing, unless `withCoord` is false. */
async function world(o: { withCoord?: boolean; masker?: SecretMasker } = {}): Promise<World> {
  const home = mkTmp('ccrc-read-doors-home-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  for (const id of [BODY, OTHER]) seedRow(home, id, { uuid: uuidOf(id), project: 'project-a', generation: INC });
  const base = testDeps(home, recorder().run);
  const projectsRoot = base.cfg.projectsRoot;
  mkdirSync(path.join(projectsRoot, 'project-a'), { recursive: true });
  let walkCount = 0;
  const io = { ...base.io, readdir: async (p: string, t?: number, s?: AbortSignal) => { if (p === projectsRoot) walkCount += 1; return base.io.readdir(p, t, s); } };
  const storeDb = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-read-doors-store-')));
  opened.push(storeDb);
  const operatorModel = new OperatorModelStore(storeDb, issuer());
  const r = rig();
  const coord = new CoordStore(r.db);
  let over: Partial<Deps> = {};
  if (o.withCoord !== false) {
    designateLive(r, BODY, INC);
    liveGeneration(coord);
    // The restore counter, read from the real journal: one Confirm each, after a refused witness.
    for (let i = 0; i < RESTORE_N; i += 1) { r.guard.witnessRefused('witness-epoch'); expect(confirm(r)).toMatchObject({ ok: true, restoreGeneration: i + 1 }); }
    expect(r.state.restoreGeneration()).toEqual({ kind: 'measured', n: RESTORE_N });
    // A Confirm sets the operator's rung to off (the restore's own effect); put it back to chat through the ladder's real writer.
    expect(rung(r, 'off', 'chat')).toMatchObject({ ok: true });
    over = { coord, overlordAuthority: r.journal, overlordAuthorityGuard: r.guard, overlordRestore: r.state, ladderInputs: LIFTED };
  }
  const server = await buildServer({ ...base, io, time: fakeTime({ wallMs: NOW }).ports, mailToken: ID_GATE_TOKEN, operatorModel,
    ...(o.masker === undefined ? {} : { masker: o.masker }), ...over });
  app = server;
  await server.ready();
  return {
    app: server, r, coord, home, projectsRoot, walks: () => walkCount,
    ledger: () => storeDb.prepare('SELECT door, caller, scope, count, outcome FROM read_ledger ORDER BY id').all() as never,
  };
}

const q = (id: string): string => new URLSearchParams({ byId: id, byUuid: uuidOf(id) }).toString();
const sequence = (w: World, extra = '', who = BODY): Promise<LightMyRequestResponse> =>
  w.app.inject({ method: 'GET', url: `/api/overlord/sequence?${q(who)}${extra}`, headers: H });
const board = (w: World, who = BODY): Promise<LightMyRequestResponse> =>
  w.app.inject({ method: 'GET', url: `/api/overlord/board?${q(who)}`, headers: H });
const stamp = (db: DatabaseSync, id: string, state: string): void => {
  const res = tx(db, () => stampSequenceInTx(db, { kind: 'ladder-rung', id, state, actor: 'server', actorKind: 'server', at: NOW }));
  if (!res.ok) throw new Error(`stamp refused: ${res.error}`);
};

describe('GET /api/overlord/sequence, through the real server', () => {
  it('serves a page of the lines in the server\'s own coord.db, with the restore state\'s counter', async () => {
    const w = await world();
    stamp(w.coord.db, 'prog-a-marker-1', 'advise');
    stamp(w.coord.db, 'prog-a-marker-2', 'full');
    const stored = sequenceAfter(w.coord.db, 0, 1_000);
    if (stored.kind !== 'measured') throw new Error('the fixture sequence does not read');
    expect(stored.value.lines.length).toBeGreaterThanOrEqual(2);

    const res = await sequence(w);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { ok: boolean; kind: string; lines: { seq: number; id: string; state: string }[]; next: number; head: number; restoreGeneration: unknown };
    expect(body).toMatchObject({ ok: true, kind: 'page' });
    // The lines are the store's own, in full and in order, the planted ones last.
    expect(body.lines).toEqual(stored.value.lines);
    expect(body.lines.slice(-2).map((l) => [l.id, l.state])).toEqual([['prog-a-marker-1', 'advise'], ['prog-a-marker-2', 'full']]);
    expect(body.next).toBe(body.lines.at(-1)!.seq);
    expect(body.head).toBe(body.next);
    // The counter is the restore state's, measured from its journal: not 0, not unmeasured.
    expect(body.restoreGeneration).toBe(RESTORE_N);
    // The read runner counted it in the private store.
    expect(w.ledger()).toEqual([{ door: 'sequence', caller: 'overlord', scope: 'after=0', count: body.lines.length, outcome: 'rows' }]);
  });

  it('reads the handle at the call: a line stamped after the first read is served above its cursor', async () => {
    const w = await world();
    const first = (await sequence(w)).json() as { next: number };
    stamp(w.coord.db, 'prog-a-late', 'chat');
    const res = await sequence(w, `&after=${first.next}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'page', lines: [{ id: 'prog-a-late', state: 'chat', seq: first.next + 1 }], restoreGeneration: RESTORE_N });
  });

  it('is behind the real gate: another session, and a server without overlord-v1, are refused and read nothing', async () => {
    const w = await world();
    stamp(w.coord.db, 'prog-a-marker-1', 'advise');
    const other = await sequence(w, '', OTHER);
    expect([other.statusCode, other.json().error]).toEqual([REFUSAL_STATUS['not-the-overlord'], 'not-the-overlord']);
    withWord(false);
    const noWord = await sequence(w);
    expect([noWord.statusCode, noWord.json().error]).toEqual([REFUSAL_STATUS['capability-missing'], 'capability-missing']);
    expect(w.ledger()).toEqual([]);
    withWord(true);
    expect((await sequence(w)).statusCode).toBe(200);
  });

  it('a server with no coordination store cannot reach the reader\'s no-store arm: the gate refuses at step 1', async () => {
    const w = await world({ withCoord: false });
    const res = await sequence(w);
    expect(res.statusCode, res.body).toBe(REFUSAL_STATUS.unavailable);
    expect(res.json()).toMatchObject({ ok: false, error: 'unavailable', step: '1' });
    expect(w.ledger()).toEqual([]);
  });
});

describe('GET /api/overlord/board, through the real server', () => {
  const open = (w: World, program: string, title: string): void => {
    const run = w.coord.openRun({ program, title, project: 'project-a', wave: 1, waveOf: 2, claimedBy: OTHER });
    if (!('id' in run)) throw new Error(`openRun refused: ${JSON.stringify(run)}`);
  };
  const identityOf = (res: LightMyRequestResponse): { slug: string; title: unknown }[] => {
    const b = (res.json() as OverlordBoardAnswer).board.identity;
    if (b.state !== 'measured') throw new Error(`identity is ${JSON.stringify(b)}`);
    return b.programmes as never;
  };

  it('answers from the server\'s own store: a programme opened in its coord.db is on the board, and the read is one ledger line', async () => {
    const w = await world();
    open(w, 'prog-a', 'Programme A');
    const res = await board(w);
    expect(res.statusCode, res.body).toBe(200);
    expect(identityOf(res).map((p) => p.slug)).toEqual(['prog-a']);
    const b = (res.json() as OverlordBoardAnswer).board;
    // The store-backed parts read this store, and the projects part read the fixture projects root.
    expect(b.capacity).toMatchObject({ state: 'measured' });
    expect(b.projects).toMatchObject({ state: 'measured', registry: 'listed', names: expect.arrayContaining(['project-a']) });
    expect(w.ledger()).toEqual([{ door: 'board', caller: 'overlord', scope: 'fleet', count: 1, outcome: 'rows' }]);
  });

  it('walks the projects root once for two reads, through the server\'s one walk cache', async () => {
    const w = await world();
    const before = w.walks();
    expect((await board(w)).statusCode).toBe(200);
    const afterFirst = w.walks();
    expect((await board(w)).statusCode).toBe(200);
    expect(afterFirst - before, 'the first board read lists the root once').toBe(1);
    expect(w.walks() - afterFirst, 'the second board read lists it no more').toBe(0);
  });

  it('shares the projects route\'s walk cache: a board read after GET /api/projects lists the root no more', async () => {
    const w = await world();
    const listed = await w.app.inject({ method: 'GET', url: '/api/projects' });
    expect(listed.statusCode, listed.body).toBe(200);
    const before = w.walks();
    expect(before).toBeGreaterThan(0);
    expect((await board(w)).statusCode).toBe(200);
    expect(w.walks() - before).toBe(0);
  });

  it('its answer goes out through the server\'s answer hook: the route is masked, and session-written text is masked', async () => {
    expect(MASKED_GET_ROUTES.has('/api/overlord/board')).toBe(true);
    expect(answerMasked('GET', '/api/overlord/board')).toBe(true);
    const masker = { maskDeep: (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll('prog-secret', '[masked]')) } as SecretMasker;
    const w = await world({ masker });
    open(w, 'prog-secret', 'Programme S');
    const res = await board(w);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('prog-secret');
    expect(identityOf(res).map((p) => p.slug)).toEqual(['[masked]']);
  });

  it('is behind the real gate: another session, and a server without overlord-v1, are refused and gather nothing', async () => {
    const w = await world();
    open(w, 'prog-a', 'Programme A');
    const other = await board(w, OTHER);
    expect([other.statusCode, other.json().error]).toEqual([REFUSAL_STATUS['not-the-overlord'], 'not-the-overlord']);
    withWord(false);
    const noWord = await board(w);
    expect([noWord.statusCode, noWord.json().error]).toEqual([REFUSAL_STATUS['capability-missing'], 'capability-missing']);
    expect(w.ledger()).toEqual([]);
    expect(w.walks()).toBe(0);
  });

  it('a server with no coordination store: the gate refuses at step 1, so the board gathers nothing', async () => {
    const w = await world({ withCoord: false });
    const res = await board(w);
    expect(res.statusCode, res.body).toBe(REFUSAL_STATUS.unavailable);
    expect(res.json()).toMatchObject({ ok: false, error: 'unavailable', step: '1' });
    expect(w.walks()).toBe(0);
  });
});
