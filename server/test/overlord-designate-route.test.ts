// Overlord W1, designation A, plan Task 5: the three doors (`GET /api/overlord/designation`, `POST` and `DELETE
// /api/overlord/designate`, `coord/overlordRoutes.ts`) over a real `CoordStore` on a migrated in-memory-sized coord db, a FAKE
// gate, a FAKE body (the port the later adapter implements), a FAKE host, a fake journal and the fake clock and entropy. The
// swap route's side of the same task is in `swap-route-pool.test.ts` and `pools.test.ts`.
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  drainOwedStops, registerOverlordRoutes,
  type BodyAnswer, type CreateAnswer, type KeepAwakeAnswer, type OverlordBody, type OverlordRouteDeps, type StopAnswer,
} from '../src/coord/overlordRoutes.js';
import type { AuthorityAppender } from '../src/coord/overlordDesignationStore.js';
import type { AuthorityAppend, AuthorityAppendError } from '../src/coord/overlordAuthorityJournal.js';
import type { OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import type { AccountGate, AccountGateAsk } from '../src/accounts/gate.js';
import { actorOf } from '../src/accounts/audit.js';
import { refuseRoute } from '../src/refuse.js';
import type { DeliverResult } from '../src/continuity/sessionHost.js';
import { DESIGNATE_CCD_WORDS } from '../../shared/overlord-designation.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { STATE_DEADLINE_S } from '../../shared/continuity.js';
import { fakeTime } from './fakeTime.js';
import { ROSTER, limit } from './sim/designationSets.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

// Opening a coord db replays every migration, which is slow under load: migrate ONE template, and copy it for each test.
let template = '';
const opened: DatabaseSync[] = [];
const apps: FastifyInstance[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-overlord-route-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } }
});
afterAll(() => removeTmpFixtures());

const PAYLOAD = { model: 'opus', accountPools: { pools: ['pool-a', 'pool-b'], untagged: false } };
const GEN = '11111111-2222-3333-4444-555555555555';
const PROMPT = 'overlord-first-prompt';
const HEALTHY = Object.fromEntries(
  ['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-pay'].map((id) => [id, limit()]).concat([['lane-off', limit({ disabled: true })]]));

// ── the fakes ───────────────────────────────────────────────────────────────────────────────────────────────────────

type GateMode = 'pass' | 'auth-off' | 'step-up-required';
interface FakeGate extends AccountGate { asks: AccountGateAsk[]; mode: GateMode }
function fakeGate(): FakeGate {
  const g = ((_req, reply, ask) => {
    g.asks.push(ask);
    if (g.mode !== 'pass') { void refuseRoute(reply, g.mode); return { pass: false }; }
    return { pass: true, actor: actorOf('device-a', 'abcdef0123456789'), sessionIdHash: 'abcdef0123456789' };
  }) as FakeGate;
  g.asks = [];
  g.mode = 'pass';
  return g;
}

interface Call { op: string; id?: string; extra?: unknown }
const ANSWER = {
  kind: 'answer', answer: { side: 'set:pool-a', verdict: 'serve', poolSide: 'account', poolState: 'untagged', crossing: 'none', account: 'lane-a' },
} as const;

/** A body that records every call, keeps the set of sessions that "exist" (a create that may have happened adds one, a stop
 *  removes it) and answers what a test sets. */
class FakeBody implements OverlordBody {
  readonly log: Call[] = [];
  readonly alive = new Set<string>();
  ensure: BodyAnswer = { ok: true };
  createAnswer: (id: string) => CreateAnswer = () => ({ ok: true, generation: GEN });
  setAnswer: BodyAnswer = { ok: true };
  keepAwakeAnswer: (state: 'on' | 'off') => KeepAwakeAnswer = () => ({ ok: true, foreign: null });
  stopAnswer: (id: string) => StopAnswer = () => ({ ok: true, absent: false });
  probe: Awaited<ReturnType<OverlordBody['poolAnswer']>> = ANSWER;
  /** Held by a test to freeze `create` mid-flight. */
  gate: Promise<void> | null = null;
  async ensureProject() { this.log.push({ op: 'ensureProject' }); return this.ensure; }
  async create(slug: string, id: string, wrapper: string, route: Record<string, string | undefined>) {
    this.log.push({ op: 'create', id, extra: { slug, wrapper, route } });
    if (this.gate !== null) await this.gate;
    const a = this.createAnswer(id);
    if (a.ok || a.created !== 'no') this.alive.add(id);
    return a;
  }
  async writeSet(id: string, set: { poolset: string; acctorder: string }) { this.log.push({ op: 'writeSet', id, extra: set }); return this.setAnswer; }
  async clearProfile(id: string) { this.log.push({ op: 'clearProfile', id }); return { ok: true } as const; }
  async poolAnswer(id: string) { this.log.push({ op: 'poolAnswer', id }); return this.probe; }
  async keepAwake(id: string, state: 'on' | 'off') { this.log.push({ op: `keepAwake-${state}`, id }); return this.keepAwakeAnswer(state); }
  async stop(id: string) {
    this.log.push({ op: 'stop', id });
    const a = this.stopAnswer(id);
    if (a.ok) this.alive.delete(id);
    return a;
  }
  ops(): string[] { return this.log.map((c) => c.op); }
  count(op: string): number { return this.log.filter((c) => c.op === op).length; }
}

interface FakeJournal extends AuthorityAppender { seen: OverlordAuthorityMove[]; refuse: AuthorityAppendError | null }
function fakeJournal(): FakeJournal {
  const j: FakeJournal = {
    seen: [], refuse: null,
    appendInTx(_db, entry): AuthorityAppend {
      j.seen.push(entry);
      return j.refuse === null ? ({ ok: true, kind: 'appended', record: {} } as unknown as AuthorityAppend) : { ok: false, error: j.refuse, detail: `refused: ${j.refuse}` };
    },
  };
  return j;
}

class FakeHost {
  readonly delivered: string[] = [];
  answer: DeliverResult = { kind: 'sent' };
  async deliver(id: string, prompt: string): Promise<DeliverResult> { this.delivered.push(`${id}:${prompt}`); return this.answer; }
}

interface Rig {
  app: FastifyInstance; db: DatabaseSync; coord: CoordStore; gate: FakeGate; body: FakeBody; journal: FakeJournal; host: FakeHost;
  facts: { ccdWords: string[] | null; builds: 'agreed' | 'skewed' | 'unknown' }; serialRuns: { n: number };
  time: ReturnType<typeof fakeTime>;
}

async function rig(opts: { serial?: 'real' | 'off' } = {}): Promise<Rig> {
  const dir = path.join(mkTmp('ccrc-overlord-route-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  const coord = new CoordStore(db);
  const gate = fakeGate(); const body = new FakeBody(); const journal = fakeJournal(); const host = new FakeHost();
  const time = fakeTime();
  const facts = { ccdWords: [...DESIGNATE_CCD_WORDS] as string[] | null, builds: 'agreed' as 'agreed' | 'skewed' | 'unknown' };
  const serialRuns = { n: 0 };
  let tail: Promise<unknown> = Promise.resolve();
  const serial: OverlordRouteDeps['serial'] = opts.serial === 'off'
    ? (fn) => fn()
    : (fn) => { serialRuns.n += 1; const run = tail.then(fn, fn); tail = run.catch(() => undefined); return run; };
  const app = Fastify({ logger: false });
  registerOverlordRoutes(app, {
    gate, serial, coord, journal, body, host: host as unknown as OverlordRouteDeps['host'],
    clock: time.ports.clock, entropy: time.ports.entropy, dec: () => null,
    facts: {
      ccdWords: () => facts.ccdWords, serverWords: ['continuity-v1'], builds: () => facts.builds, roster: () => ROSTER,
      limits: async () => HEALTHY, shares: async () => ({ kind: 'absent' }),
    },
  });
  await app.ready();
  apps.push(app);
  return { app, db, coord, gate, body, journal, host, facts, serialRuns, time };
}

const post = (r: Rig, payload: unknown = PAYLOAD) => r.app.inject({ method: 'POST', url: '/api/overlord/designate', payload: payload as object });
const del = (r: Rig) => r.app.inject({ method: 'DELETE', url: '/api/overlord/designate' });
const get = (r: Rig) => r.app.inject({ method: 'GET', url: '/api/overlord/designation' });
const rowOf = (r: Rig): Record<string, unknown> | undefined => r.db.prepare('SELECT * FROM overlord_designation').get() as Record<string, unknown> | undefined;
const items = (r: Rig): { title: string; why: string }[] => r.db.prepare('SELECT title, why FROM operator_items').all() as { title: string; why: string }[];
const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 5));
async function until(pred: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) { if (pred()) return; await tick(); }
  throw new Error(`timed out waiting for ${what}`);
}
const view = (r: Rig) => { const x = r.coord.designationRead(); return x.kind === 'unmeasured' ? null : x.row; };
/** Everything a refused start must leave untouched: no row, no create-side call, no record, no prompt, no item. */
function expectNothingWritten(r: Rig): void {
  expect(rowOf(r)).toBeUndefined();
  expect(r.body.ops().filter((o) => o !== 'poolAnswer')).toEqual([]);
  expect(r.journal.seen).toEqual([]);
  expect(r.host.delivered).toEqual([]);
  expect(items(r)).toEqual([]);
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the gate comes first', () => {
  for (const mode of ['auth-off', 'step-up-required'] as const) {
    it(`${mode} answers before anything is read, on all three doors`, async () => {
      const r = await rig();
      r.gate.mode = mode;
      for (const res of [await post(r), await del(r), await get(r)]) {
        expect(res.statusCode).toBe(REFUSAL_STATUS[mode]);
        expect(res.json()).toMatchObject({ ok: false, error: mode });
      }
      expect(r.body.log).toEqual([]);
      expect(r.serialRuns.n).toBe(0);
      expect(rowOf(r)).toBeUndefined();
      expect(r.journal.seen).toEqual([]);
    });
  }

  it('the writes ask for a step-up and no ccd word; the read asks for neither', async () => {
    const r = await rig();
    await post(r); await del(r); await get(r);
    expect(r.gate.asks).toEqual([{ cap: null, stepUp: true }, { cap: null, stepUp: true }, { cap: null }]);
  });

  it('both writes run on the coordination serialiser; the read does not', async () => {
    const r = await rig();
    await get(r);
    expect(r.serialRuns.n).toBe(0);
    await post(r); await del(r);
    expect(r.serialRuns.n).toBe(2);
  });
});

// ── the refusals ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('every refusal reaches the wire with its status, and writes nothing', () => {
  it('a bad body is 400 bad-request, before the probe', async () => {
    const r = await rig();
    for (const bad of [null, {}, { model: 'sonnet', accountPools: PAYLOAD.accountPools }, { model: 'opus' }, { ...PAYLOAD, extra: 1 }]) {
      const res = await post(r, bad);
      expect(res.statusCode).toBe(REFUSAL_STATUS['bad-request']);
      expect(res.json()).toMatchObject({ error: 'bad-request' });
    }
    expect(r.body.log).toEqual([]);
    expectNothingWritten(r);
  });

  it('capability-missing: ccd words absent (501, naming them), and a probe that did not run', async () => {
    const r = await rig();
    r.facts.ccdWords = null;
    const a = await post(r);
    expect(a.statusCode).toBe(REFUSAL_STATUS['capability-missing']);
    expect(a.json()).toMatchObject({ error: 'capability-missing', needs: expect.arrayContaining(['pool-set', 'keep-awake-v1']) });
    r.facts.ccdWords = [...DESIGNATE_CCD_WORDS];
    r.body.probe = { kind: 'not-run' };
    const b = await post(r);
    expect(b.statusCode).toBe(501);
    expect(b.json()).toMatchObject({ error: 'capability-missing', needs: ['pool-set'] });
    expectNothingWritten(r);
  });

  it('launch-profile-unmet under build skew, and under an unmeasured agreement: 409, nothing created, no digest sent', async () => {
    const r = await rig();
    for (const builds of ['skewed', 'unknown'] as const) {
      r.facts.builds = builds;
      const res = await post(r);
      expect(res.statusCode).toBe(REFUSAL_STATUS['launch-profile-unmet']);
      expect(res.json()).toMatchObject({ error: 'launch-profile-unmet', detail: builds === 'skewed' ? 'skewed' : 'unmeasured' });
    }
    expect(r.body.count('create')).toBe(0);
    expectNothingWritten(r);
  });

  it('an unspellable set is the caller\'s 400, and a set with one counted account is overlord-single-account 409', async () => {
    const r = await rig();
    const unspellable = await post(r, { model: 'opus', accountPools: { pools: ['Not A Pool'], untagged: false } });
    expect(unspellable.statusCode).toBe(400);
    expect(unspellable.json()).toMatchObject({ error: 'bad-request', detail: 'accountPools' });
    const single = await post(r, { model: 'opus', accountPools: { pools: ['pool-b'], untagged: false } });
    expect(single.statusCode).toBe(REFUSAL_STATUS['overlord-single-account']);
    expect(single.json()).toMatchObject({ error: 'overlord-single-account', count: 1 });
    const empty = await post(r, { model: 'opus', accountPools: { pools: [], untagged: false } });
    expect(empty.statusCode).toBe(409);
    expect(empty.json()).toMatchObject({ count: 0 });
    expectNothingWritten(r);
  });

  it('a row it cannot narrow is 503 unavailable, never "nobody is designated"', async () => {
    const r = await rig();
    expect((await post(r)).statusCode).toBe(200);
    r.db.exec("UPDATE overlord_designation SET accountPools = 'nope'");
    const before = r.body.log.length;
    const res = await post(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS.unavailable);
    expect(res.json()).toMatchObject({ error: 'unavailable', detail: 'the designation row could not be read' });
    expect(r.body.log.slice(before).map((c) => c.op)).toEqual(['poolAnswer']);
    expect((await del(r)).statusCode).toBe(503);
    expect((await get(r)).statusCode).toBe(503);
  });

  it('overlord-exists for a bound row and for a pending one', async () => {
    const r = await rig();
    expect((await post(r)).statusCode).toBe(200);
    const second = await post(r);
    expect(second.statusCode).toBe(REFUSAL_STATUS['overlord-exists']);
    expect(second.json()).toMatchObject({ error: 'overlord-exists' });
    const id = view(r)!.pending!.sessionId;
    expect(r.coord.goLive(r.journal, id, GEN, r.time.ports.clock.wall())).toMatchObject({ ok: true, changed: true });
    const third = await post(r);
    expect(third.statusCode).toBe(409);
    expect(third.json()).toMatchObject({ error: 'overlord-exists' });
    expect(r.body.count('create')).toBe(1);
  });
});

// ── the create ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('a create', () => {
  it('answers pending: the row, the bound generation, the set, the markers and the first prompt, in order', async () => {
    const r = await rig();
    const res = await post(r);
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j).toMatchObject({ ok: true, state: 'pending', awake: true, prompted: true, warnings: [] });
    const id: string = j.sessionId;
    expect(id).toMatch(/^overlord-[0-9a-f]{8}$/);
    expect(j.deadlineAt).toBe(r.time.ports.clock.wall() + (STATE_DEADLINE_S.clearing + STATE_DEADLINE_S.carded + STATE_DEADLINE_S.probing) * 1000);

    // The order: designatePending (the row exists before ensureProject), ensureProject, create, writeSet, keepAwake on.
    expect(r.body.ops()).toEqual(['poolAnswer', 'ensureProject', 'create', 'writeSet', 'keepAwake-on']);
    expect(r.body.log.find((c) => c.op === 'poolAnswer')!.id).toBe(id);
    const create = r.body.log.find((c) => c.op === 'create')!;
    expect(create.id).toBe(id);
    expect(create.extra).toMatchObject({ wrapper: 'lane-a', route: { class: 'opus', profile: 'overlord', profiledigest: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    // The create's route never carries the set (ccd refuses `poolset` and `acctorder` there).
    expect(Object.keys((create.extra as { route: object }).route).sort()).toEqual(['class', 'profile', 'profiledigest']);
    expect(r.body.log.find((c) => c.op === 'writeSet')!.extra).toEqual({ poolset: 'pool-a,pool-b', acctorder: 'lane-a,lane-c,lane-b' });

    const row = view(r)!;
    expect(row.bound).toBeNull();
    expect(row.pending).toMatchObject({ sessionId: id, kind: 'designate', generation: GEN, deadlineAt: j.deadlineAt, actor: 'device-a abcdef01' });
    expect(row.term).toBe(0);
    // The set and the class are journalled with the designate; the go-live record is the settle step's, not the door's.
    expect(r.journal.seen.map((e) => e.kind)).toEqual(['authority-account-set', 'authority-model-class']);
    expect(r.host.delivered).toEqual([`${id}:${PROMPT}`]);
    expect(items(r)).toEqual([]);
  });

  it('warns `unknown-pool` for a set name no account carries', async () => {
    const r = await rig();
    const res = await post(r, { model: 'opus', accountPools: { pools: ['pool-a', 'pool-b', 'pool-zz'], untagged: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual([{ warning: 'unknown-pool', pool: 'pool-zz' }]);
  });

  it('a first prompt that is not delivered answers prompted: false and keeps the attempt pending', async () => {
    for (const answer of [{ kind: 'refused', reason: 'draft-present' }, { kind: 'unreachable', detail: 'gone' }] as DeliverResult[]) {
      const r = await rig();
      r.host.answer = answer;
      const res = await post(r);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'pending', prompted: false, awake: true });
      expect(view(r)!.pending).not.toBeNull();
      expect(r.host.delivered).toHaveLength(1);
      expect(r.body.count('stop')).toBe(0);
    }
  });
});

// ── a failure after the row ─────────────────────────────────────────────────────────────────────────────────────────

describe('a failure after the row is written ends the attempt, owes the stop of what may exist, drains it and answers 502', () => {
  const failed = async (r: Rig) => {
    const res = await post(r);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'fleetFailed' });
    const row = view(r)!;
    expect(row.pending).toBeNull();
    expect(row.bound).toBeNull();
    expect(row.lastAttempt).toMatchObject({ outcome: 'create-failed', sessionId: res.json().sessionId });
    expect(row.stopsOwed).toEqual([]);                 // drained
    return { id: res.json().sessionId as string, detail: res.json().detail as string };
  };

  it('ensureProject failing: ccd made nothing, so no stop is owed and none runs', async () => {
    const r = await rig();
    r.body.ensure = { ok: false, detail: 'the listing failed' };
    const { detail } = await failed(r);
    expect(detail).toBe('the listing failed');
    expect(r.body.ops()).toEqual(['poolAnswer', 'ensureProject']);
    expect(r.host.delivered).toEqual([]);
  });

  it('create failing with created: no owes nothing; yes and unknown owe the stop and run it', async () => {
    const no = await rig();
    no.body.createAnswer = () => ({ ok: false, detail: 'ccd refused', created: 'no' });
    await failed(no);
    expect(no.body.count('stop')).toBe(0);
    for (const created of ['yes', 'unknown'] as const) {
      const r = await rig();
      r.body.createAnswer = () => ({ ok: false, detail: `lost: ${created}`, created });
      const { id, detail } = await failed(r);
      expect(detail).toBe(`lost: ${created}`);
      expect(r.body.log.filter((c) => c.op === 'stop').map((c) => c.id)).toEqual([id]);
      expect(r.body.alive.size).toBe(0);
    }
  });

  it('a failed generation read (a made session with no incarnation) is created: yes', async () => {
    const r = await rig();
    r.body.createAnswer = () => ({ ok: false, detail: 'the generation could not be read', created: 'yes' });
    const { id } = await failed(r);
    expect(r.body.log.filter((c) => c.op === 'stop').map((c) => c.id)).toEqual([id]);
  });

  it('a failed writeSet owes and runs the stop, and clears the set and the markers on the way', async () => {
    const r = await rig();
    r.body.setAnswer = { ok: false, detail: 'route write refused' };
    const { id } = await failed(r);
    expect(r.body.ops().slice(3)).toEqual(['writeSet', 'writeSet', 'clearProfile', 'keepAwake-off', 'stop']);
    expect(r.body.log.filter((c) => c.op === 'writeSet').at(-1)).toMatchObject({ id, extra: { poolset: '', acctorder: '' } });
    expect(r.body.alive.size).toBe(0);
    expect(r.host.delivered).toEqual([]);
  });

  it('a failed keep-awake fails the create (slug keep-awake-failure-fails-the-create): no prompt, the stop drained', async () => {
    const r = await rig();
    r.body.keepAwakeAnswer = (s) => (s === 'on' ? { ok: false, detail: 'unreadable marker' } : { ok: true, foreign: null });
    const { id, detail } = await failed(r);
    expect(detail).toBe('unreadable marker');
    expect(r.host.delivered).toEqual([]);
    expect(r.body.log.filter((c) => c.op === 'stop').map((c) => c.id)).toEqual([id]);
    expect(items(r)).toEqual([]);
  });

  it('a refused bind (the attempt is gone) fails the attempt too, and the session is stopped', async () => {
    const r = await rig();
    // The create's own answer retires the attempt behind the door's back, as a retire without the serialiser would.
    r.body.createAnswer = (id) => { r.coord.retire(r.journal, { actor: 'x', at: 1, opKey: 'r' }); r.body.alive.add(id); return { ok: true, generation: GEN }; };
    const res = await post(r);
    expect(res.statusCode).toBe(502);
    expect(res.json().detail).toContain('no longer pending');
    expect(r.body.alive.size).toBe(0);
    expect(view(r)!.stopsOwed).toEqual([]);
  });

  it('a stop that fails stays owed, and the next retire drains it', async () => {
    const r = await rig();
    r.body.setAnswer = { ok: false, detail: 'route write refused' };
    r.body.stopAnswer = () => ({ ok: false, detail: 'tmux is busy' });
    const res = await post(r);
    expect(res.statusCode).toBe(502);
    const id = res.json().sessionId as string;
    expect(view(r)!.stopsOwed).toEqual([id]);
    expect(r.body.alive.has(id)).toBe(true);
    r.body.stopAnswer = () => ({ ok: true, absent: false });
    const again = await del(r);
    expect(again.json()).toEqual({ ok: true, changed: false, stopped: [id], owed: [] });
    expect(view(r)!.stopsOwed).toEqual([]);
    expect(r.body.alive.size).toBe(0);
  });
});

// ── the authority journal refuses ───────────────────────────────────────────────────────────────────────────────────

describe('a refused authority append', () => {
  const cases: [AuthorityAppendError, string][] = [
    ['authority-rolled-back', 'authority-rolled-back'],
    ['journal-append', 'journal-unreadable'],
    // `bad-entry` is a caller's error, never a journal state; it answers `journal-unreadable` like every other word but the first.
    ['bad-entry', 'journal-unreadable'],
    ['authority-unmeasured', 'journal-unreadable'],
    ['not-in-transaction', 'journal-unreadable'],
  ];
  for (const [error, word] of cases) {
    it(`${error} answers ${word} 503 and creates nothing`, async () => {
      const r = await rig();
      r.journal.refuse = error;
      const res = await post(r);
      expect(res.statusCode).toBe(503);
      expect(res.statusCode).toBe(REFUSAL_STATUS[word as 'journal-unreadable']);
      expect(res.json()).toMatchObject({ ok: false, error: word });
      expect(rowOf(r)).toBeUndefined();
      expect(r.body.ops().filter((o) => o !== 'poolAnswer')).toEqual([]);
      expect(r.host.delivered).toEqual([]);
    });
  }

  it('a retire of a live row maps the same way and leaves the row bound', async () => {
    const r = await rig();
    await post(r);
    const id = view(r)!.pending!.sessionId;
    r.coord.goLive(r.journal, id, GEN, 1);
    for (const [error, word] of cases) {
      r.journal.refuse = error;
      const res = await del(r);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: word });
      expect(view(r)!.bound).toMatchObject({ sessionId: id });
    }
    expect(r.body.count('stop')).toBe(0);
  });
});

// ── the in-flight retire and the race ───────────────────────────────────────────────────────────────────────────────

describe('a retire while the create is in flight (review F5)', () => {
  it('with the serialiser, the retire waits, then cancels the attempt and stops its body', async () => {
    const r = await rig();
    let release!: () => void;
    r.body.gate = new Promise<void>((res) => { release = res; });
    const designate = post(r);
    await until(() => r.body.count('create') === 1, 'the create call');
    const retire = del(r);
    await tick(); await tick();
    // Nothing of the retire has run: the attempt is still pending and no stop was asked.
    expect(view(r)!.pending).not.toBeNull();
    expect(r.body.count('stop')).toBe(0);
    release();
    const [d, rr] = await Promise.all([designate, retire]);
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({ state: 'pending' });
    const id = d.json().sessionId as string;
    expect(rr.json()).toMatchObject({ ok: true, changed: true, term: 0, stopped: [id], owed: [] });
    expect(view(r)!.lastAttempt).toMatchObject({ outcome: 'retired', sessionId: id });
    expect(r.body.alive.size).toBe(0);
    expect(r.body.log.at(-1)).toMatchObject({ op: 'stop', id });
  });

  it('without it, the bind refuses, the designate fails the attempt and owes the stop: nothing runs with no row', async () => {
    const r = await rig({ serial: 'off' });
    let release!: () => void;
    r.body.gate = new Promise<void>((res) => { release = res; });
    // The first stop meets no session yet (ccd has made none): it answers absent, which reads as stopped.
    r.body.stopAnswer = () => ({ ok: true, absent: true });
    const designate = post(r);
    await until(() => r.body.count('create') === 1, 'the create call');
    const retired = await del(r);
    expect(retired.json()).toMatchObject({ ok: true, changed: true, owed: [] });
    expect(view(r)!.pending).toBeNull();
    r.body.stopAnswer = () => ({ ok: true, absent: false });
    release();
    const d = await designate;
    expect(d.statusCode).toBe(502);
    expect(d.json().detail).toContain('no longer pending');
    expect(r.body.alive.size).toBe(0);
    const row = view(r)!;
    expect(row.pending).toBeNull();
    expect(row.bound).toBeNull();
    expect(row.stopsOwed).toEqual([]);
  });
});

describe('two concurrent designates', () => {
  it('one is pending and one is overlord-exists, and ccd creates once', async () => {
    const r = await rig();
    const [a, b] = await Promise.all([post(r), post(r)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect([a, b].find((x) => x.statusCode === 409)!.json()).toMatchObject({ error: 'overlord-exists' });
    expect(r.body.count('create')).toBe(1);
    expect(r.body.count('keepAwake-on')).toBe(1);
    expect(r.host.delivered).toHaveLength(1);
  });
});

// ── retire ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('retire', () => {
  it('on no row, or a row that binds nothing, is { ok: true, changed: false } and writes nothing', async () => {
    const r = await rig();
    expect((await del(r)).json()).toEqual({ ok: true, changed: false });
    await post(r);
    await del(r);                                  // now a row with no binding and a drained stop
    r.journal.seen.length = 0;
    const before = r.body.log.length;
    expect((await del(r)).json()).toEqual({ ok: true, changed: false });
    expect(r.body.log.length).toBe(before);
    expect(r.journal.seen).toEqual([]);
  });

  it('on a pending-only row cancels the attempt (outcome retired), raises no term, appends nothing, and stops its body', async () => {
    const r = await rig();
    const id = (await post(r)).json().sessionId as string;
    r.journal.seen.length = 0;
    const res = await del(r);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, changed: true, term: 0, stopped: [id], owed: [] });
    expect(r.journal.seen).toEqual([]);
    expect(view(r)).toMatchObject({ term: 0, pending: null, bound: null, lastAttempt: { outcome: 'retired', sessionId: id }, stopsOwed: [] });
    // The drain: the set cleared, the profile digest cleared, the markers off, the stop.
    expect(r.body.ops().slice(-4)).toEqual(['writeSet', 'clearProfile', 'keepAwake-off', 'stop']);
    expect(r.body.log.filter((c) => c.op === 'writeSet').at(-1)).toMatchObject({ id, extra: { poolset: '', acctorder: '' } });
    expect(r.body.alive.size).toBe(0);
  });

  it('on a live row appends authority-retire naming the bound session, raises the term and stops the body', async () => {
    const r = await rig();
    const id = (await post(r)).json().sessionId as string;
    expect(r.coord.goLive(r.journal, id, GEN, 5)).toMatchObject({ ok: true, term: 1 });
    r.journal.seen.length = 0;
    const res = await del(r);
    expect(res.json()).toEqual({ ok: true, changed: true, term: 2, stopped: [id], owed: [] });
    expect(r.journal.seen).toHaveLength(1);
    expect(r.journal.seen[0]).toMatchObject({ kind: 'authority-retire', term: 2, previousSessionId: id });
    expect(view(r)).toMatchObject({ term: 2, bound: null, pastIds: [id] });
    expect(r.coord.designationRead()).toMatchObject({ kind: 'not-designated' });
    expect(r.body.alive.size).toBe(0);
  });

  it('a failed stop stays owed and the answer names it; a stop that finds no session reads as stopped', async () => {
    const r = await rig();
    const id = (await post(r)).json().sessionId as string;
    r.body.stopAnswer = () => ({ ok: false, detail: 'tmux is busy' });
    const res = await del(r);
    expect(res.json()).toEqual({ ok: true, changed: true, term: 0, stopped: [], owed: [id] });
    expect(view(r)!.stopsOwed).toEqual([id]);
    r.body.stopAnswer = () => ({ ok: true, absent: true });
    const next = await del(r);
    expect(next.json()).toEqual({ ok: true, changed: false, stopped: [id], owed: [] });
    expect(view(r)!.stopsOwed).toEqual([]);
  });

  it('drainOwedStops drains each id once, however many times it is named', async () => {
    const r = await rig();
    const id = (await post(r)).json().sessionId as string;
    r.coord.retire(r.journal, { actor: 'x', at: 1, opKey: 'k' });
    expect(view(r)!.stopsOwed).toEqual([id]);
    const out = await drainOwedStops({ body: r.body, coord: r.coord }, [id, id]);
    expect(out).toEqual({ stopped: [id], owed: [] });
    expect(r.body.count('stop')).toBe(1);
  });
});

// ── the keep-awake marker ───────────────────────────────────────────────────────────────────────────────────────────

describe('a foreign keep-awake marker', () => {
  it('succeeds, and raises exactly one operator item that names the marker', async () => {
    const r = await rig();
    r.body.keepAwakeAnswer = (s) => (s === 'on' ? { ok: true, foreign: 'overlord-x.no-roll (written by another tool)' } : { ok: true, foreign: null });
    const res = await post(r);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'pending', awake: true, prompted: true });
    expect(view(r)!.pending).not.toBeNull();
    const rows = items(r);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.why).toContain('overlord-x.no-roll (written by another tool)');
    expect(rows[0]!.title).toContain(res.json().sessionId);
    expect(r.body.count('stop')).toBe(0);
  });

  it('a plain keep-awake raises no item', async () => {
    const r = await rig();
    await post(r);
    expect(items(r)).toEqual([]);
  });
});

// ── the read ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('GET /api/overlord/designation', () => {
  it('with no row answers { ok: true, designation: null }', async () => {
    const r = await rig();
    const res = await get(r);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, designation: null });
  });

  it('answers the view, the list and the counted accounts under the row\'s set and class, and unknown-pool warnings', async () => {
    const r = await rig();
    await post(r, { model: 'opus', accountPools: { pools: ['pool-a', 'pool-b', 'pool-zz'], untagged: true } });
    const res = await get(r);
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.ok).toBe(true);
    expect(j.designation).toMatchObject({ model: 'opus', accountPools: { pools: ['pool-a', 'pool-b', 'pool-zz'], untagged: true }, bound: null });
    expect(j.designation.pending).toMatchObject({ kind: 'designate' });
    // pool order first (pool-a: lane-a, lane-c; pool-b: lane-b), the untagged lane after; the API-key and the switched-off lanes never.
    expect(j.accounts.list).toEqual(['lane-a', 'lane-c', 'lane-b', 'lane-d']);
    expect(j.accounts.counted).toEqual(['lane-a', 'lane-c', 'lane-b', 'lane-d']);
    expect(j.accounts.unmeasured).toEqual([]);
    expect(j.warnings).toEqual([{ warning: 'unknown-pool', pool: 'pool-zz' }]);
  });

  it('an unreadable fact read is 503 unavailable, never an empty list', async () => {
    const r = await rig();
    await post(r);
    r.coord.accountPoolEdges = () => { throw new Error('coord.db is locked'); };
    const res = await get(r);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'unavailable', detail: 'coord.db is locked' });
  });
});
