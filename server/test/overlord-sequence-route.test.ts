// Overlord W1, sequence C (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Task 7; spec §10.4, Table
// 11.1e): the two read doors. `GET /api/overlord/sequence`, the Overlord's cursor read, through the REAL gate runner over a real
// fixture `coord.db` (as `overlord-inbox-routes.test.ts` stands it up), the REAL read runner and a real `OperatorModelStore` on a
// fixture file; and `GET /api/overlord/invariants`, the operator's read of the monitor's last pass and its record, through
// `registerOverlordRoutes`, and through `buildServer` for the session gate. Fixture names only; temp databases only.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { issueActKey } from '../src/continuity/actKeyStore.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { openCoordDb } from '../src/coord/db.js';
import { findingCounts, findingRows, recordFinding } from '../src/coord/invariantFindingsStore.js';
import { INVARIANT_NAMES, type InvariantName, type InvariantVerdict } from '../src/coord/invariants.js';
import { overlordGateRun, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import { actKeyFact, advanceCounterGuarded, recordFenceRefusal } from '../src/coord/overlordGateStore.js';
import { runOverlordRead, type OverlordReadDeps } from '../src/coord/overlordRead.js';
import { registerOverlordRoutes, type OverlordRouteDeps } from '../src/coord/overlordRoutes.js';
import { registerOverlordSequenceRoutes } from '../src/coord/overlordSequenceRoutes.js';
import { pruneSequenceThrough, sequenceAfter, stampSequenceInTx, type SequenceLineInput } from '../src/coord/overlordSequenceStore.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { hashLine } from '../src/auth/secret.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { buildServer } from '../src/server.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { SEQUENCE_PAGE_MAX } from '../../shared/overlord-sequence.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const TOKEN = 'a'.repeat(64);
const BODY = 'lane-a-overlord';            // the Overlord's session id
const OTHER = 'lane-b-project-a';          // any other session
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
beforeAll(() => { s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-sequence-route-'), '.ccrc', 'coord.db'))); });
afterAll(removeTmpFixtures);
const apps: FastifyInstance[] = [];
const dbs: DatabaseSync[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** Mint the Overlord identity's next generation, active, with an act key (the inbox suite's own fixture). */
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
  s.db.prepare('UPDATE continuity_generations SET state = ?, deadlineAt = NULL WHERE id = ?').run('active', m.id);
  const after = s.liveGenerations();
  if (!after.ok) throw new Error(after.detail);
  const gen = after.rows.find((g) => g.id === m.id)!;
  const issued = issueActKey(s.db, { generationId: gen.id, nonceSha256: createHash('sha256').update(`n-${seq}`).digest('hex'),
    keySha256: createHash('sha256').update(`key-${seq}`, 'utf8').digest('hex'), issuedAt: NOW });
  if (!issued.ok) throw new Error('key not issued');
  return gen;
}

/** A sequence database of its own for each rig: `lines` stamped in order (seq 1, 2, …), then pruned through `prune`. */
function sequenceDb(lines: readonly Partial<SequenceLineInput>[], prune: number | null = null): DatabaseSync {
  const db = openCoordDb(path.join(mkTmp('ccrc-sequence-route-seq-'), '.ccrc', 'coord.db'));
  dbs.push(db);
  for (const l of lines) {
    const r = tx(db, () => stampSequenceInTx(db, { kind: 'ladder-rung', id: 'operator', state: 'chat', actor: 'server', actorKind: 'server', at: NOW, ...l }));
    if (!r.ok) throw new Error(`stamp refused: ${r.error}`);
  }
  if (prune !== null) expect(pruneSequenceThrough(db, prune, [])).toMatchObject({ pruned: expect.any(Number) });
  return db;
}

interface SeqRig {
  app: FastifyInstance; lines: () => Record<string, unknown>[];
  /** How many times the door read the sequence. */
  reads: () => number;
}
interface SeqOpts {
  db?: DatabaseSync; words?: readonly string[]; unreadable?: boolean; ledgerFails?: boolean;
  restore?: () => { kind: 'measured'; n: number } | { kind: 'unmeasured' };
}
async function seqRig(o: SeqOpts = {}): Promise<SeqRig> {
  fresh();
  const storeDb = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-sequence-route-store-')));
  dbs.push(storeDb);
  const store = new OperatorModelStore(storeDb, issuer());
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
  };
  const ledger: OverlordReadDeps['ledger'] = o.ledgerFails === true
    ? { servedReadsSince: (d, t) => store.servedReadsSince(d, t), recordRead: () => ({ ok: false, error: 'write-failed', detail: 'a fixture write failure' }) }
    : store;
  const db = o.db ?? sequenceDb([]);
  let reads = 0;
  const app = Fastify({ logger: false });
  apps.push(app);
  registerOverlordSequenceRoutes(app, {
    mailToken: () => TOKEN, gate: overlordGateRun(gateDeps),
    readRunner: runOverlordRead({ ledger, turn: async () => 'done', now: () => NOW }),
    sequence: (after: number, limit: number) => {
      reads += 1;
      return o.unreadable === true ? { kind: 'unmeasured', why: 'the sequence could not be read: a fixture fault' } : sequenceAfter(db, after, limit);
    },
    restoreGeneration: o.restore ?? (() => ({ kind: 'measured', n: 2 })),
  });
  await app.ready();
  return {
    app, reads: () => reads,
    lines: () => storeDb.prepare('SELECT door, caller, scope, count, outcome FROM read_ledger ORDER BY id').all() as never,
  };
}

const HEADERS = { 'x-ccrc-mail-token': TOKEN };
const read = (r: SeqRig, query = '', who = BODY): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'GET', url: `/api/overlord/sequence?byId=${who}&byUuid=u-1${query}`, headers: HEADERS });
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
const line = (over: Record<string, unknown>) => ({ door: 'sequence', caller: 'overlord', count: 0, ...over });

describe('GET /api/overlord/sequence: the gate first', () => {
  it('a session that is not the designated one is refused not-the-overlord: no read, no ledger line', async () => {
    const r = await seqRig({ db: sequenceDb([{}, {}]) });
    const res = await read(r, '', OTHER);
    expect(res.statusCode).toBe(REFUSAL_STATUS['not-the-overlord']);
    expect(json(res)).toMatchObject({ ok: false, error: 'not-the-overlord' });
    expect([r.reads(), r.lines()]).toEqual([0, []]);
  });

  it('without the overlord-v1 word: capability-missing, no read, no ledger line', async () => {
    const r = await seqRig({ words: ['continuity-v1'] });
    const res = await read(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['capability-missing']);
    expect(json(res)).toMatchObject({ error: 'capability-missing' });
    expect([r.reads(), r.lines()]).toEqual([0, []]);
  });

  it('a bad cursor from another session still reads not-the-overlord: the query is parsed after the gate', async () => {
    const r = await seqRig();
    expect((await read(r, '&after=-1', OTHER)).statusCode).toBe(REFUSAL_STATUS['not-the-overlord']);
  });

  it('no box token, or a wrong one, is 401 before the gate; a missing pair is 400', async () => {
    const r = await seqRig();
    expect((await r.app.inject({ method: 'GET', url: `/api/overlord/sequence?byId=${BODY}&byUuid=u-1` })).statusCode).toBe(REFUSAL_STATUS.unauthenticated);
    expect((await r.app.inject({ method: 'GET', url: `/api/overlord/sequence?byId=${BODY}&byUuid=u-1`, headers: { 'x-ccrc-mail-token': 'b'.repeat(64) } })).statusCode)
      .toBe(REFUSAL_STATUS.unauthenticated);
    expect((await r.app.inject({ method: 'GET', url: '/api/overlord/sequence', headers: HEADERS })).statusCode).toBe(400);
    expect([r.reads(), r.lines()]).toEqual([0, []]);
  });
});

describe('GET /api/overlord/sequence: the answers, each with its ledger line', () => {
  it('a page: the lines above the cursor, at most the limit, next and head, the restore generation; one served line', async () => {
    const r = await seqRig({ db: sequenceDb([{}, { state: 'advise' }, { state: 'full' }]) });
    const res = await read(r, '&after=1&limit=1');
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({
      ok: true, kind: 'page', next: 2, head: 3, restoreGeneration: 2,
      lines: [{ seq: 2, at: NOW, kind: 'ladder-rung', id: 'operator', state: 'advise', actor: 'server', actorKind: 'server', known: true }],
    });
    expect(r.lines()).toEqual([line({ scope: 'after=1', count: 1, outcome: 'rows' })]);
  });

  it('no cursor keys: from the start, a full page', async () => {
    const r = await seqRig({ db: sequenceDb([{}, {}]) });
    const res = await read(r);
    expect(json(res)).toMatchObject({ kind: 'page', next: 2, head: 2 });
    expect(r.lines()).toEqual([line({ scope: 'after=0', count: 2, outcome: 'rows' })]);
  });

  it('a caught-up reader: a page with no lines and its cursor unmoved, still one line', async () => {
    const r = await seqRig({ db: sequenceDb([{}]) });
    expect(json(await read(r, '&after=1'))).toMatchObject({ kind: 'page', lines: [], next: 1, head: 1 });
    expect(r.lines()).toEqual([line({ scope: 'after=1', count: 0, outcome: 'rows' })]);
  });

  it('a line this build cannot name is served opaque with known false, never dropped', async () => {
    const db = sequenceDb([{}]);
    db.prepare("INSERT INTO overlord_sequence (kind, id, state, actor, actorKind, at) VALUES ('drill', 'd-1', 'marked', 'server', 'server', ?)").run(NOW);
    const r = await seqRig({ db });
    const body = json(await read(r, '&after=1'));
    expect(body).toMatchObject({ kind: 'page', lines: [{ seq: 2, kind: 'drill', state: 'marked', known: false }] });
    expect(r.lines()).toEqual([line({ scope: 'after=1', count: 1, outcome: 'rows' })]);
  });

  it('a cursor below the prune floor answers gap, naming the floor, never an empty page; its line says gap', async () => {
    const r = await seqRig({ db: sequenceDb([{}, {}, {}, {}], 2) });
    const res = await read(r, '&after=1');
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, kind: 'gap', after: 1, prunedThrough: 2, head: 4, restoreGeneration: 2 });
    expect(r.lines()).toEqual([line({ scope: 'after=1', outcome: 'gap' })]);
  });

  it('a cursor past the head answers ahead, never an empty page; its line says ahead', async () => {
    const r = await seqRig({ db: sequenceDb([{}, {}]) });
    const res = await read(r, '&after=9');
    expect(json(res)).toEqual({ ok: true, kind: 'ahead', after: 9, head: 2, restoreGeneration: 2 });
    expect(r.lines()).toEqual([line({ scope: 'after=9', outcome: 'ahead' })]);
  });

  it('the restore generation is the counter\'s reader\'s answer: unmeasured stays unmeasured, a throw reads unmeasured, never zero', async () => {
    const un = await seqRig({ restore: () => ({ kind: 'unmeasured' }) });
    expect(json(await read(un))).toMatchObject({ kind: 'page', restoreGeneration: 'unmeasured' });
    const thrown = await seqRig({ restore: () => { throw new Error('a fixture fault'); } });
    expect(json(await read(thrown))).toMatchObject({ kind: 'page', restoreGeneration: 'unmeasured' });
    const zero = await seqRig({ restore: () => ({ kind: 'measured', n: 0 }) });
    expect(json(await read(zero))).toMatchObject({ kind: 'page', restoreGeneration: 0 });
  });

  it('an unreadable sequence is 503 unavailable with its unmeasured line, never an empty page', async () => {
    const r = await seqRig({ unreadable: true });
    const res = await read(r, '&after=4');
    expect(res.statusCode).toBe(REFUSAL_STATUS.unavailable);
    expect(json(res)).toMatchObject({ ok: false, error: 'unavailable', detail: 'the sequence could not be read: a fixture fault' });
    expect(r.lines()).toEqual([line({ scope: 'after=4', outcome: 'unmeasured' })]);
  });

  it('a ledger line that could not be written refuses the read: nothing of the sequence is sent', async () => {
    const r = await seqRig({ db: sequenceDb([{}]), ledgerFails: true });
    const res = await read(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['write-failed']);
    expect(json(res)).toMatchObject({ ok: false, error: 'write-failed' });
    expect(res.body).not.toContain('ladder-rung');
  });

  it('a bad cursor, limit or key after a passing gate is 400 bad-request, with no read and no ledger line', async () => {
    const r = await seqRig({ db: sequenceDb([{}]) });
    for (const q of ['&after=-1', '&after=01', '&after=x', '&limit=0', `&limit=${SEQUENCE_PAGE_MAX + 1}`, '&cursor=2', '&after=1&after=2']) {
      const res = await read(r, q);
      expect(res.statusCode, q).toBe(400);
      expect(json(res), q).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect([r.reads(), r.lines()]).toEqual([0, []]);
  });
});

// ------------------------------------------------------------------------------------------------------------ the operator's read

const verdicts = (over: Partial<Record<InvariantName, InvariantVerdict>> = {}): Map<InvariantName, InvariantVerdict> =>
  new Map(INVARIANT_NAMES.map((n) => [n, over[n] ?? { kind: 'holds' } as InvariantVerdict]));

function invariantsApp(o: { db?: DatabaseSync; last?: { at: number; mode: 'shadow' | 'live'; verdicts: Map<InvariantName, InvariantVerdict> } | null; mode?: 'shadow' | 'live' }): FastifyInstance {
  const db = o.db ?? sequenceDb([]);
  const app = Fastify({ logger: false });
  apps.push(app);
  registerOverlordRoutes(app, {
    coord: new CoordStore(db), facts: {}, serial: async (f: () => unknown) => f(),
    gate: () => { throw new Error('the invariants read must not ask the account gate'); },
    invariants: {
      mode: () => o.mode ?? 'shadow', last: () => o.last ?? null,
      open: (limit: number) => findingRows(db, 'open', limit), resolved: (limit: number) => findingRows(db, 'resolved', limit),
      counts: () => findingCounts(db),
    },
  } as unknown as OverlordRouteDeps);
  return app;
}

describe('GET /api/overlord/invariants: the operator\'s read of the monitor', () => {
  it('before the first pass: no-pass-yet with the mode, never an empty list', async () => {
    const res = await invariantsApp({ last: null }).inject({ method: 'GET', url: '/api/overlord/invariants' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, kind: 'no-pass-yet', mode: 'shadow' });
  });

  it('after a pass: the mode, every verdict in the table\'s order, the open and resolved findings of both modes, and the counts', async () => {
    const db = sequenceDb([]);
    const f = (subject: string) => ({ invariant: 'I17' as const, subject, seq: null, message: 'a fixture message' });
    recordFinding(db, f('timer:1'), 'shadow', null, NOW);
    const two = recordFinding(db, f('timer:2'), 'shadow', null, NOW + 1);
    if (!two.ok) throw new Error('fixture');
    db.prepare('UPDATE overlord_invariant_findings SET resolvedAt = ? WHERE id = ?').run(NOW + 2, two.id);
    const v = verdicts({ I17: { kind: 'violated', findings: [{ ...f('timer:1') }], unmeasured: [] }, I9: { kind: 'simulator-only' } });
    const res = await invariantsApp({ db, mode: 'live', last: { at: NOW + 3, mode: 'shadow', verdicts: v } }).inject({ method: 'GET', url: '/api/overlord/invariants' });
    expect(res.statusCode).toBe(200);
    const body = json(res) as { kind: string; mode: string; lastPass: { at: number; mode: string; verdicts: { invariant: string; verdict: { kind: string } }[] };
      findings: { open: { subject: string }[]; resolved: { subject: string }[]; openCut: boolean; resolvedCut: boolean }; counts: { shadow: { total: number; open: number } } };
    expect([body.kind, body.mode, body.lastPass.mode, body.lastPass.at]).toEqual(['pass', 'live', 'shadow', NOW + 3]);
    expect(body.lastPass.verdicts.map((x) => x.invariant)).toEqual([...INVARIANT_NAMES]);
    expect(body.lastPass.verdicts.find((x) => x.invariant === 'I17')?.verdict.kind).toBe('violated');
    expect([body.findings.open.map((x) => x.subject), body.findings.resolved.map((x) => x.subject), body.findings.openCut, body.findings.resolvedCut])
      .toEqual([['timer:1'], ['timer:2'], false, false]);
    expect(body.counts.shadow).toMatchObject({ total: 2, open: 1 });
  });

  it('an unreadable findings table is 503 unavailable, never an empty list', async () => {
    const db = sequenceDb([]);
    db.exec('DROP TABLE overlord_invariant_findings');
    const res = await invariantsApp({ db, last: { at: NOW, mode: 'shadow', verdicts: verdicts() } }).inject({ method: 'GET', url: '/api/overlord/invariants' });
    expect(res.statusCode).toBe(REFUSAL_STATUS.unavailable);
    expect(json(res)).toMatchObject({ ok: false, error: 'unavailable', detail: expect.stringContaining('the open findings could not be read') });
  });

  it('the session gate when armed: refused without a session, served with one, and no box token or step-up is asked', async () => {
    const home = mkTmp('ccrc-sequence-route-auth-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine('fixture-passphrase', { n: 1024, r: 8, p: 1, keylen: 32 }, 1)}\n`);
    const base = testDeps(home);
    const coordDb = sequenceDb([]);
    const app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false }, coord: new CoordStore(coordDb) });
    apps.push(app);
    expect((await app.inject({ method: 'GET', url: '/api/overlord/invariants' })).statusCode).toBe(REFUSAL_STATUS.unauthenticated);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'user-agent': 'lane-a' }, payload: { passphrase: 'fixture-passphrase' } });
    expect(login.statusCode).toBe(204);
    const set = login.headers['set-cookie'];
    const cookie = (Array.isArray(set) ? set[0]! : String(set)).split(';')[0]!;
    const res = await app.inject({ method: 'GET', url: '/api/overlord/invariants', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ ok: true, kind: 'no-pass-yet' });
  });
});
