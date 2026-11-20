// Overlord W1, designation C, plan Tasks 8 and 9: the two Settings doors, `POST /api/overlord/model` and `POST
// /api/overlord/account-set` (`coord/overlordRoutes.ts`), and their deciders (`modelClassVerdict`, `setWidens`,
// `accountSetVerdict`, run here against the real module; the cases live in `sim/designationSets.ts` for the mutation floors
// too). The doors run over a real `CoordStore` on a migrated coord db, a FAKE gate, a FAKE body and the fake clock and
// entropy, with either a fake journal (the refusals, the record's order and `from`) or the REAL authority journal on its
// own file, its guard driven into each state that answers `row-only` (X3, X3b).
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as m from '../src/coord/overlordDesignation.js';
import {
  registerOverlordRoutes,
  type BodyAnswer, type OverlordBody, type OverlordRouteDeps,
} from '../src/coord/overlordRoutes.js';
import type { AuthorityAppender } from '../src/coord/overlordDesignationStore.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt, type AuthorityAppend, type AuthorityAppendError } from '../src/coord/overlordAuthorityJournal.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import type { OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import type { AccountGate, AccountGateAsk } from '../src/accounts/gate.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { refuseRoute } from '../src/refuse.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import type { PoolSet } from '../../shared/poolset.js';
import { fakeTime } from './fakeTime.js';
import { ROSTER, limit, modelClassVerdictCases, setWidensCases, accountSetVerdictCases } from './sim/designationSets.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

describe('the deciders', () => {
  describe('modelClassVerdict', () => { for (const [name, fn] of Object.entries(modelClassVerdictCases(m))) it(name, fn); });
  describe('setWidens', () => { for (const [name, fn] of Object.entries(setWidensCases(m))) it(name, fn); });
  describe('accountSetVerdict', () => { for (const [name, fn] of Object.entries(accountSetVerdictCases(m))) it(name, fn); });
});

// Opening a coord db replays every migration: migrate ONE template, and copy it for each test.
let template = '';
const opened: DatabaseSync[] = [];
const apps: FastifyInstance[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-overlord-settings-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } }
});
afterAll(() => removeTmpFixtures());

const HEALTHY = Object.fromEntries(
  ['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-pay'].map((id) => [id, limit()]).concat([['lane-off', limit({ disabled: true })]]));
/** pool-b holds lane-b, pool-a lane-a and lane-c (lane-pay is an API-key lane, lane-off is switched off). */
const SET_BA: PoolSet = { pools: ['pool-b', 'pool-a'], untagged: false };
const SET_AB: PoolSet = { pools: ['pool-a', 'pool-b'], untagged: false };
const SET_A: PoolSet = { pools: ['pool-a'], untagged: false };
const SET_B: PoolSet = { pools: ['pool-b'], untagged: false };
const GEN = '11111111-2222-3333-4444-555555555555';
const FABLE_ROSTER = { ...ROSTER, accounts: ROSTER.accounts.map((a) => ({ ...a, fableBilling: 'included' as const })) };
const BOUND = 'overlord-aaaaaaaa';
const PENDING = 'overlord-bbbbbbbb';
const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const OPERATOR = identity.operator(gateActorOf('device-a', 'abcdef0123456789'));

// ── the fakes ───────────────────────────────────────────────────────────────────────────────────────────────────────

type GateMode = 'pass' | 'auth-off' | 'step-up-required';
interface FakeGate extends AccountGate { asks: AccountGateAsk[]; mode: GateMode; onAsk: (() => void) | null }
function fakeGate(): FakeGate {
  const g = ((_req, reply, ask) => {
    g.asks.push(ask);
    g.onAsk?.();
    if (g.mode !== 'pass') { void refuseRoute(reply, g.mode); return { pass: false }; }
    return { pass: true, actor: gateActorOf('device-a', 'abcdef0123456789'), sessionIdHash: 'abcdef0123456789' };
  }) as FakeGate;
  g.asks = []; g.mode = 'pass'; g.onAsk = null;
  return g;
}

/** Only the two route writes the Settings doors make are expected; every other call is recorded so a test can say none ran. */
class FakeBody implements OverlordBody {
  readonly log: { op: string; id: string; extra?: unknown }[] = [];
  answer: BodyAnswer = { ok: true };
  async writeClass(id: string, cls: string) { this.log.push({ op: 'writeClass', id, extra: cls }); return this.answer; }
  async writeSet(id: string, set: { poolset: string; acctorder: string }) { this.log.push({ op: 'writeSet', id, extra: set }); return this.answer; }
  async ensureProject() { this.log.push({ op: 'ensureProject', id: '' }); return { ok: true } as const; }
  async create(_s: string, id: string) { this.log.push({ op: 'create', id }); return { ok: true, generation: GEN } as const; }
  async clearProfile(id: string) { this.log.push({ op: 'clearProfile', id }); return { ok: true } as const; }
  async poolAnswer(id: string) { this.log.push({ op: 'poolAnswer', id }); return { kind: 'not-run' } as const; }
  async keepAwake(id: string) { this.log.push({ op: 'keepAwake', id }); return { ok: true, foreign: [] } as const; }
  async stop(id: string) { this.log.push({ op: 'stop', id }); return { ok: true, absent: false } as const; }
  ops(): string[] { return this.log.map((c) => `${c.op}:${c.id}`); }
}

/** A journal that records each move with the row's own value AT the append, so a test can say the record came first. */
interface FakeJournal extends AuthorityAppender { seen: { entry: OverlordAuthorityMove; rowModel: unknown; rowPools: unknown }[]; refuse: AuthorityAppendError | null; rowOnly: boolean }
function fakeJournal(): FakeJournal {
  const j: FakeJournal = {
    seen: [], refuse: null, rowOnly: false,
    appendInTx(db, entry): AuthorityAppend {
      const row = db.prepare('SELECT model, accountPools FROM overlord_designation WHERE id = 1').get() as { model?: unknown; accountPools?: unknown } | undefined;
      j.seen.push({ entry, rowModel: row?.model, rowPools: row?.accountPools });
      if (j.refuse !== null) return { ok: false, error: j.refuse, detail: `refused: ${j.refuse}` };
      return (j.rowOnly ? { ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'witness-heads' } }
        : { ok: true, kind: 'appended', record: {} }) as unknown as AuthorityAppend;
    },
  };
  return j;
}

interface Rig {
  app: FastifyInstance; db: DatabaseSync; coord: CoordStore; gate: FakeGate; body: FakeBody; journal: AuthorityAppender;
  fake: FakeJournal; guard: OverlordAuthorityGuard | null; serialRuns: { n: number };
}

/** `journal: 'real'` builds the authority journal on its own file beside the db, its guard told the boot verdict. */
/** `fable: false` gives the roster no account that can serve `fable` (billing unset); by default lane-a, lane-b and lane-c can. */
async function rig(opts: { journal?: 'fake' | 'real'; fable?: boolean } = {}): Promise<Rig> {
  const dir = path.join(mkTmp('ccrc-overlord-settings-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  const coord = new CoordStore(db);
  const gate = fakeGate(); const body = new FakeBody(); const fake = fakeJournal();
  const time = fakeTime();
  let journal: AuthorityAppender = fake;
  let guard: OverlordAuthorityGuard | null = null;
  if (opts.journal === 'real') {
    let real!: OverlordAuthorityJournal;
    const g = new OverlordAuthorityGuard({ healTornTail: () => real.healTornTail(db), measure: () => real.measure(db) });
    real = new OverlordAuthorityJournal(overlordAuthorityFileAt(dir), { clock: time.ports.clock }, g);
    g.bootVerdict(real.measure(db));
    expect(g.state()).toEqual({ kind: 'coherent' });
    journal = real; guard = g;
  }
  const serialRuns = { n: 0 };
  let tail: Promise<unknown> = Promise.resolve();
  const serial: OverlordRouteDeps['serial'] = (fn) => { serialRuns.n += 1; const run = tail.then(fn, fn); tail = run.catch(() => undefined); return run; };
  const app = Fastify({ logger: false });
  registerOverlordRoutes(app, {
    gate, identity, serial, coord, journal, body, host: { deliver: async () => { throw new Error('no prompt from a Settings door'); } },
    clock: time.ports.clock, entropy: time.ports.entropy, dec: () => null,
    facts: {
      ccdWords: () => [], serverWords: [], builds: () => 'agreed', roster: () => (opts.fable === false ? ROSTER : FABLE_ROSTER),
      limits: async () => HEALTHY,
      shares: async () => ({ kind: 'reading', finishedAtS: Math.floor(time.ports.clock.wall() / 1000),
        byAccount: { 'lane-a': 5, 'lane-b': 5, 'lane-c': 5 } }),
    },
  });
  await app.ready();
  apps.push(app);
  return { app, db, coord, gate, body, journal, fake, guard, serialRuns };
}

/** The row as a Start leaves it: pending, then bound when `live`, through the store's own writers and this rig's journal. */
function seed(r: Rig, over: { model?: 'opus' | 'fable'; accountPools?: PoolSet; state: 'live' | 'pending' | 'unbound' }): void {
  const p = r.coord.designatePending(r.journal, { sessionId: over.state === 'pending' ? PENDING : BOUND, deadlineAt: 10_000, model: over.model ?? 'opus',
    accountPools: over.accountPools ?? SET_BA, actor: OPERATOR, at: 1, opKey: 'designate-seed' });
  expect(p.ok).toBe(true);
  if (over.state === 'pending') return;
  expect(r.coord.bindPendingGeneration(BOUND, GEN, 2).ok).toBe(true);
  if (over.state === 'live') { expect(r.coord.goLive(r.journal, BOUND, GEN, 3)).toMatchObject({ ok: true, changed: true }); return; }
  expect(r.coord.failPending(BOUND, 'create-failed', 3, false).ok).toBe(true);
}
const quiet = (r: Rig): void => { r.fake.seen.length = 0; r.gate.asks.length = 0; };

const postModel = (r: Rig, payload: unknown) => r.app.inject({ method: 'POST', url: '/api/overlord/model', payload: payload as object });
const postSet = (r: Rig, payload: unknown) => r.app.inject({ method: 'POST', url: '/api/overlord/account-set', payload: payload as object });
const rowOf = (r: Rig): Record<string, unknown> | undefined => r.db.prepare('SELECT * FROM overlord_designation').get() as Record<string, unknown> | undefined;
const view = (r: Rig) => { const x = r.coord.designationRead(); if (x.kind === 'unmeasured' || x.row === null) throw new Error('no row'); return x.row; };

// ── the model class door (Task 8) ──────────────────────────────────────────────────────────────────────────────────

describe('POST /api/overlord/model (C45)', () => {
  it('fable asks the step-up, opus does not, and a bad body asks it before its 400', async () => {
    const r = await rig();
    seed(r, { state: 'live' });
    await postModel(r, { model: 'fable' });
    await postModel(r, { model: 'opus' });
    const bad = await postModel(r, { model: 'haiku' });
    expect(bad.statusCode).toBe(400);
    expect(r.gate.asks).toEqual([{ cap: null, stepUp: true }, { cap: null, stepUp: false }, { cap: null, stepUp: true }]);
  });

  for (const mode of ['auth-off', 'step-up-required'] as const) {
    it(`the gate's ${mode} answers first and nothing is written`, async () => {
      const r = await rig();
      seed(r, { state: 'live' }); quiet(r);
      const before = rowOf(r);
      r.gate.mode = mode;
      const res = await postModel(r, { model: 'fable' });
      expect(res.statusCode).toBe(REFUSAL_STATUS[mode]);
      expect(r.serialRuns.n).toBe(0);
      expect(rowOf(r)).toEqual(before);
      expect(r.fake.seen).toEqual([]);
      expect(r.body.log).toEqual([]);
    });
  }

  it('with no row, not-found, and nothing is written', async () => {
    const r = await rig();
    const res = await postModel(r, { model: 'fable' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-found' });
    expect(rowOf(r)).toBeUndefined();
    expect(r.fake.seen).toEqual([]);
    expect(r.body.log).toEqual([]);
  });

  it('an unreadable row answers unavailable and writes nothing', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    r.db.prepare("UPDATE overlord_designation SET accountPools = 'not json' WHERE id = 1").run();
    const res = await postModel(r, { model: 'fable' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'unavailable' });
    expect(r.fake.seen).toEqual([]);
    expect(r.body.log).toEqual([]);
  });

  it('the authority record comes first, with the row\'s own class as its from; then the row, then the route write', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    const res = await postModel(r, { model: 'fable' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, changed: true, model: 'fable', journalled: true, warnings: [], route: 'written',
      written: [{ sessionId: BOUND, ok: true }] });
    expect(r.fake.seen).toHaveLength(1);
    expect(r.fake.seen[0]!.entry).toMatchObject({ kind: 'authority-model-class', from: 'opus', to: 'fable' });
    expect(r.fake.seen[0]!.rowModel).toBe('opus'); // the row was not yet written when the record was asked for
    expect(view(r).model).toBe('fable');
    expect(view(r).actor).toBe(gateActorOf('device-a', 'abcdef0123456789').toString());
    expect(r.body.log).toEqual([{ op: 'writeClass', id: BOUND, extra: 'fable' }]);
  });

  it('the from duty: each move states the row\'s value read in its own transaction', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    await postModel(r, { model: 'fable' });
    await postModel(r, { model: 'opus' });
    expect(r.fake.seen.map((s) => [s.entry.kind === 'authority-model-class' ? s.entry.from : null, s.rowModel])).toEqual([['opus', 'opus'], ['fable', 'fable']]);
  });

  it('the same class answers changed: false, with no record and no write', async () => {
    const r = await rig();
    seed(r, { state: 'live', model: 'fable' }); quiet(r);
    const res = await postModel(r, { model: 'fable' });
    expect(res.json()).toEqual({ ok: true, changed: false, model: 'fable' });
    expect(r.fake.seen).toEqual([]);
    expect(r.body.log).toEqual([]);
  });

  for (const [error, word] of [['authority-rolled-back', 'authority-rolled-back'], ['authority-unmeasured', 'journal-unreadable'],
    ['journal-append', 'journal-unreadable'], ['not-in-transaction', 'journal-unreadable']] as const) {
    it(`a refused append (${error}) answers ${word} and writes no row and no route`, async () => {
      const r = await rig();
      seed(r, { state: 'live' }); quiet(r);
      r.fake.refuse = error;
      const res = await postModel(r, { model: 'fable' });
      expect(res.statusCode).toBe(REFUSAL_STATUS[word]);
      expect(res.json()).toMatchObject({ ok: false, error: word });
      expect(view(r).model).toBe('opus');
      expect(r.body.log).toEqual([]);
    });
  }

  it('a row-only answer writes the row and says journalled: false', async () => {
    const r = await rig();
    seed(r, { state: 'live', model: 'fable' }); quiet(r);
    r.fake.rowOnly = true;
    const res = await postModel(r, { model: 'opus' });
    expect(res.json()).toMatchObject({ ok: true, changed: true, journalled: false });
    expect(view(r).model).toBe('opus');
  });

  it('a failed route write is reported in the answer, route: failed at the top (review 2410 F1); the row stands', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    r.body.answer = { ok: false, detail: 'route exited 1' };
    const res = await postModel(r, { model: 'fable' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ changed: true, route: 'failed', written: [{ sessionId: BOUND, ok: false, detail: 'route exited 1' }] });
    expect(view(r).model).toBe('fable');
  });

  it('a pending body takes the class too; a row that binds nothing is saved with no route write', async () => {
    const p = await rig();
    seed(p, { state: 'pending' }); quiet(p);
    expect((await postModel(p, { model: 'fable' })).json()).toMatchObject({ changed: true, written: [{ sessionId: PENDING, ok: true }] });
    const u = await rig();
    seed(u, { state: 'unbound' }); quiet(u);
    expect((await postModel(u, { model: 'fable' })).json()).toMatchObject({ changed: true, route: 'written', written: [] });
    expect(view(u).model).toBe('fable');
    expect(u.body.log).toEqual([]);
  });

  it('C56 under the new class (model-door-recounts-c56): fewer than two serving refuses while bound and while pending, writing nothing', async () => {
    for (const state of ['live', 'pending'] as const) {
      const r = await rig({ fable: false });
      seed(r, { state }); quiet(r);
      const res = await postModel(r, { model: 'fable' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ ok: false, error: 'overlord-single-account', count: 0 });
      expect(view(r).model).toBe('opus');
      expect(r.fake.seen).toEqual([]);
      expect(r.body.log).toEqual([]);
    }
  });

  it('C56 under the new class: with no body the class is saved for the next Start, with the warning', async () => {
    const r = await rig({ fable: false });
    seed(r, { state: 'unbound' }); quiet(r);
    expect((await postModel(r, { model: 'fable' })).json()).toMatchObject({ ok: true, changed: true,
      warnings: [{ warning: 'overlord-single-account', count: 0 }], written: [] });
    expect(view(r).model).toBe('fable');
  });

  it('a move to opus narrows: fewer than two serving only warns, bound or pending, and the class lands (review 2410 F2)', async () => {
    for (const state of ['live', 'pending'] as const) {
      const r = await rig();
      seed(r, { state, model: 'fable', accountPools: SET_B }); quiet(r);
      const res = await postModel(r, { model: 'opus' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, changed: true, model: 'opus', warnings: [{ warning: 'overlord-single-account', count: 1 }],
        route: 'written', written: [{ sessionId: state === 'live' ? BOUND : PENDING, ok: true }] });
      expect(view(r).model).toBe('opus');
      expect(r.fake.seen).toHaveLength(1);
    }
  });

  it('the writer called with the row\'s own class answers changed: false, appends nothing and writes no row (review 2410 F5)', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    const before = rowOf(r);
    expect(r.coord.setModelClass(r.journal, { model: 'opus', actor: identity.operator(gateActorOf('device-b', '0123456789abcdef')), at: 99_999, opKey: 'k' })).toEqual({ ok: true, changed: false });
    expect(r.coord.setAccountSet(r.journal, { accountPools: SET_BA, actor: identity.operator(gateActorOf('device-b', '0123456789abcdef')), at: 99_999, opKey: 'k' })).toEqual({ ok: true, changed: false });
    expect(r.fake.seen).toEqual([]);
    expect(rowOf(r)).toEqual(before);
  });

  it('the renewal path is never called: no prompt, no create, no stop, no keep-awake; only the class write', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    expect((await postModel(r, { model: 'fable' })).statusCode).toBe(200);
    expect(r.body.ops()).toEqual([`writeClass:${BOUND}`]);
  });
});

// ── the account set door (Task 9) ──────────────────────────────────────────────────────────────────────────────────

describe('POST /api/overlord/account-set (C46, C56)', () => {
  it('the step-up is asked for each widening and for no narrowing or reorder', async () => {
    const r = await rig();
    seed(r, { state: 'live', accountPools: SET_A }); quiet(r);
    await postSet(r, { accountPools: SET_AB });                               // a pool added
    await postSet(r, { accountPools: { pools: ['pool-a', 'pool-b'], untagged: true } }); // untagged turned on
    await postSet(r, { accountPools: SET_BA });                               // a narrowing (untagged off) that reorders
    await postSet(r, { accountPools: SET_AB });                               // a pure reorder
    await postSet(r, { accountPools: SET_A });                                // a narrowing
    await postSet(r, { pools: 'x' });                                         // a bad body asks it, then 400s
    expect(r.gate.asks.map((a) => a.stepUp)).toEqual([true, true, false, false, false, true]);
  });

  it('a set that changed between the gate and the serialiser cannot widen without a step-up', async () => {
    const r = await rig();
    seed(r, { state: 'live', accountPools: { pools: ['pool-a', 'pool-b', 'pool-c'], untagged: false } }); quiet(r);
    // The door reads the row and asks no step-up for a narrowing to {pool-a, pool-b}; before it reaches the serialiser, the set
    // is narrowed to {pool-a} by another act, so {pool-a, pool-b} now widens.
    r.gate.onAsk = () => { r.gate.onAsk = null; expect(r.coord.setAccountSet(r.journal, { accountPools: SET_A, actor: OPERATOR, at: 5, opKey: 'other' }).ok).toBe(true); };
    const res = await postSet(r, { accountPools: SET_AB });
    expect(r.gate.asks.map((a) => a.stepUp)).toEqual([false]);
    expect(res.statusCode).toBe(REFUSAL_STATUS['step-up-required']);
    expect(res.json()).toMatchObject({ ok: false, error: 'step-up-required' });
    expect(view(r).accountPools).toEqual(SET_A);
    expect(r.body.log).toEqual([]);
  });

  it('with no row, not-found, and nothing is written', async () => {
    const r = await rig();
    const res = await postSet(r, { accountPools: SET_AB });
    expect(res.statusCode).toBe(404);
    expect(rowOf(r)).toBeUndefined();
    expect(r.fake.seen).toEqual([]);
  });

  it('below two refuses while bound and while pending, writing nothing', async () => {
    for (const state of ['live', 'pending'] as const) {
      const r = await rig();
      seed(r, { state }); quiet(r);
      const res = await postSet(r, { accountPools: SET_B });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ ok: false, error: 'overlord-single-account', count: 1 });
      expect(res.json()).not.toHaveProperty('orgSpread');
      expect(view(r).accountPools).toEqual(SET_BA);
      expect(r.fake.seen).toEqual([]);
      expect(r.body.log).toEqual([]);
    }
  });

  it('an empty set refuses while bound, and is saved with a warning while unbound', async () => {
    const b = await rig();
    seed(b, { state: 'live' }); quiet(b);
    expect((await postSet(b, { accountPools: { pools: [], untagged: false } })).json()).toMatchObject({ error: 'overlord-single-account', count: 0 });
    const u = await rig();
    seed(u, { state: 'unbound' }); quiet(u);
    const res = await postSet(u, { accountPools: { pools: [], untagged: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, warnings: [{ warning: 'overlord-single-account', count: 0 }], written: [] });
    expect(view(u).accountPools).toEqual({ pools: [], untagged: false });
    expect(u.body.log).toEqual([]);
  });

  it('unknown names warn, never refuse; the route write carries the spelling and the new list in the set\'s order', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    const res = await postSet(r, { accountPools: { pools: ['pool-a', 'pool-z', 'pool-b'], untagged: false } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, changed: true, journalled: true, warnings: [{ warning: 'unknown-pool', pool: 'pool-z' }],
      accounts: { list: ['lane-a', 'lane-c', 'lane-b'] }, orgSpread: { kind: 'none' }, written: [{ sessionId: BOUND, ok: true }] });
    expect(r.body.log).toHaveLength(1);
    expect(r.body.log[0]).toMatchObject({ op: 'writeSet', id: BOUND, extra: { acctorder: 'lane-a,lane-c,lane-b' } });
    expect((r.body.log[0]!.extra as { poolset: string }).poolset).not.toBe('');
  });

  it('the record comes first with the row\'s own set as its from, and the row keeps the operator\'s order', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    await postSet(r, { accountPools: SET_AB });
    expect(r.fake.seen).toHaveLength(1);
    expect(r.fake.seen[0]!.entry).toMatchObject({ kind: 'authority-account-set', from: SET_BA, to: SET_AB });
    expect(JSON.parse(r.fake.seen[0]!.rowPools as string)).toEqual(SET_BA);
    expect(view(r).accountPools).toEqual(SET_AB);
  });

  it('a refused append writes no row and no route', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    r.fake.refuse = 'authority-rolled-back';
    const res = await postSet(r, { accountPools: SET_A });
    expect(res.json()).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    expect(view(r).accountPools).toEqual(SET_BA);
    expect(r.body.log).toEqual([]);
  });

  it('a failed route write answers route: failed at the top; a written one route: written (review 2410 F1)', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    expect((await postSet(r, { accountPools: SET_AB })).json()).toMatchObject({ ok: true, changed: true, route: 'written',
      written: [{ sessionId: BOUND, ok: true }] });
    r.body.answer = { ok: false, detail: 'route exited 1' };
    const res = await postSet(r, { accountPools: SET_BA });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, route: 'failed', written: [{ sessionId: BOUND, ok: false, detail: 'route exited 1' }] });
    expect(view(r).accountPools).toEqual(SET_BA);
  });

  it('a pool named twice is stored once, in first-seen order (review 2410 F3)', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    const res = await postSet(r, { accountPools: { pools: ['pool-a', 'pool-b', 'pool-a'], untagged: false } });
    expect(res.json()).toMatchObject({ ok: true, changed: true, accountPools: SET_AB });
    expect(view(r).accountPools).toEqual(SET_AB);
    expect(r.fake.seen[0]!.entry).toMatchObject({ to: SET_AB });
  });

  it('the same set re-sent answers changed: false and journals nothing', async () => {
    const r = await rig();
    seed(r, { state: 'live' }); quiet(r);
    expect((await postSet(r, { accountPools: SET_BA })).json()).toMatchObject({ ok: true, changed: false });
    expect(r.fake.seen).toEqual([]);
    expect(r.body.log).toEqual([]);
  });
});

// ── the real journal: each state that answers row-only (X3, X3b) ────────────────────────────────────────────────────

describe('over the real authority journal', () => {
  it('coherent: a class change and a pure reorder each append, from the row\'s own value', async () => {
    const r = await rig({ journal: 'real' });
    seed(r, { state: 'live' });
    expect((await postSet(r, { accountPools: SET_AB })).json()).toMatchObject({ changed: true, journalled: true });
    expect(view(r).accountPools).toEqual(SET_AB);
    expect((await postModel(r, { model: 'fable' })).json()).toMatchObject({ changed: true, journalled: true });
  });

  const states: [string, (g: OverlordAuthorityGuard) => void, string][] = [
    ['rolled-back', (g) => g.witnessRefused('witness-heads'), 'authority-rolled-back'],
    ['unmeasured', (g) => g.writerFailed('journal-unreadable'), 'journal-unreadable'],
  ];
  for (const [name, drive, refusal] of states) {
    it(`${name}: opus, a narrowing and a reorder write their row only (journalled: false); fable and a widening refuse ${refusal}`, async () => {
      const r = await rig({ journal: 'real' });
      seed(r, { state: 'live', model: 'fable' });
      drive(r.guard!);
      const narrowClass = await postModel(r, { model: 'opus' });
      expect(narrowClass.json()).toMatchObject({ ok: true, changed: true, journalled: false, written: [{ sessionId: BOUND, ok: true }] });
      expect(view(r).model).toBe('opus');
      const widenClass = await postModel(r, { model: 'fable' });
      expect(widenClass.statusCode).toBe(REFUSAL_STATUS[refusal as 'authority-rolled-back']);
      expect(widenClass.json()).toMatchObject({ ok: false, error: refusal });
      expect(view(r).model).toBe('opus');
      expect((await postSet(r, { accountPools: SET_AB })).json()).toMatchObject({ ok: true, changed: true, journalled: false });
      expect((await postSet(r, { accountPools: SET_A })).json()).toMatchObject({ ok: true, changed: true, journalled: false });
      expect(view(r).accountPools).toEqual(SET_A);
      const widenSet = await postSet(r, { accountPools: SET_AB });
      expect(widenSet.json()).toMatchObject({ ok: false, error: refusal });
      expect(view(r).accountPools).toEqual(SET_A);
    });
  }
});
