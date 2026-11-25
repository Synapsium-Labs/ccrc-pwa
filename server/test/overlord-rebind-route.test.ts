// Overlord W1, designation B, plan Tasks 6 and 7: `POST /api/overlord/rebind` and `POST /api/overlord/restart`
// (`coord/overlordRoutes.ts`) over a real `CoordStore` on a migrated coord db, a FAKE gate, a FAKE body (the `OverlordBody` port,
// `ensure` included), a FAKE host, a fake journal and the fake clock and entropy. Every case binds a live Overlord first (a
// designate, then `goLive` through the store, as `overlord-designate-route.test.ts` does).
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  registerOverlordRoutes,
  type BodyAnswer, type CreateAnswer, type KeepAwakeAnswer, type OverlordBody, type OverlordRouteDeps, type StopAnswer,
} from '../src/coord/overlordRoutes.js';
import type { AuthorityAppender } from '../src/coord/overlordDesignationStore.js';
import type { AuthorityAppend, AuthorityAppendError } from '../src/coord/overlordAuthorityJournal.js';
import type { AuthorityState } from '../src/coord/overlordAuthorityCoherence.js';
import type { OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import type { OldBodyState, OverlordBodyState } from '../src/coord/overlordDesignation.js';
import type { AccountGate, AccountGateAsk } from '../src/accounts/gate.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
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
  template = path.join(mkTmp('ccrc-overlord-rebind-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } }
});
afterAll(() => removeTmpFixtures());

const PAYLOAD = { model: 'opus', accountPools: { pools: ['pool-a', 'pool-b'], untagged: false } };
const GEN = '11111111-2222-3333-4444-555555555555';
const NEW_GEN = '99999999-2222-3333-4444-555555555555';
/** The fixture roster with fable billing included on every lane. */
const FABLE_ROSTER: typeof ROSTER = { ...ROSTER, accounts: ROSTER.accounts.map((a) => ({ ...a, fableBilling: 'included' as const })) };
const PROMPT = 'overlord-first-prompt';
const PENDING_MS = (STATE_DEADLINE_S.clearing + STATE_DEADLINE_S.carded + STATE_DEADLINE_S.probing) * 1000;
const HEALTHY = Object.fromEntries(
  ['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-pay'].map((id) => [id, limit()]).concat([['lane-off', limit({ disabled: true })]]));

// ── the fakes (the designate test's, with `ensure` for Restart) ──────────────────────────────────────────────────────

type GateMode = 'pass' | 'auth-off' | 'step-up-required';
interface FakeGate extends AccountGate { asks: AccountGateAsk[]; mode: GateMode }
function fakeGate(): FakeGate {
  const g = ((_req, reply, ask) => {
    g.asks.push(ask);
    if (g.mode !== 'pass') { void refuseRoute(reply, g.mode); return { pass: false }; }
    return { pass: true, actor: gateActorOf('device-a', 'abcdef0123456789'), sessionIdHash: 'abcdef0123456789' };
  }) as FakeGate;
  g.asks = [];
  g.mode = 'pass';
  return g;
}

interface Call { op: string; id?: string; extra?: unknown }
const ANSWER = {
  kind: 'answer', answer: { side: 'set:pool-a', verdict: 'serve', poolSide: 'account', poolState: 'untagged', crossing: 'none', account: 'lane-a' },
} as const;

class FakeBody implements OverlordBody {
  readonly log: Call[] = [];
  readonly alive = new Set<string>();
  projectAnswer: BodyAnswer = { ok: true };
  ensureAnswer: BodyAnswer = { ok: true };
  createAnswer: (id: string) => CreateAnswer = () => ({ ok: true, generation: NEW_GEN });
  setAnswer: BodyAnswer = { ok: true };
  keepAwakeAnswer: (state: 'on' | 'off') => KeepAwakeAnswer = () => ({ ok: true, foreign: [] });
  stopAnswer: (id: string) => StopAnswer = () => ({ ok: true, absent: false });
  probe: Awaited<ReturnType<OverlordBody['poolAnswer']>> = ANSWER;
  /** Held by a test to freeze `create` mid-flight. */
  gate: Promise<void> | null = null;
  async ensureProject() { this.log.push({ op: 'ensureProject' }); return this.projectAnswer; }
  async ensure(id: string) { this.log.push({ op: 'ensure', id }); return this.ensureAnswer; }
  async create(slug: string, id: string, wrapper: string, route: Record<string, string | undefined>) {
    this.log.push({ op: 'create', id, extra: { slug, wrapper, route } });
    if (this.gate !== null) await this.gate;
    const a = this.createAnswer(id);
    if (a.ok || a.created !== 'no') this.alive.add(id);
    return a;
  }
  async writeSet(id: string, set: { poolset: string; acctorder: string }) { this.log.push({ op: 'writeSet', id, extra: set }); return this.setAnswer; }
  async clearProfile(id: string) { this.log.push({ op: 'clearProfile', id }); return { ok: true } as const; }
  async writeClass(id: string, cls: string) { this.log.push({ op: 'writeClass', id, extra: cls }); return { ok: true } as const; }
  async poolAnswer(id: string) { this.log.push({ op: 'poolAnswer', id }); return this.probe; }
  async keepAwake(id: string, state: 'on' | 'off') { this.log.push({ op: `keepAwake-${state}`, id }); return this.keepAwakeAnswer(state); }
  async stop(id: string) {
    this.log.push({ op: 'stop', id });
    const a = this.stopAnswer(id);
    if (a.ok) this.alive.delete(id);
    return a;
  }
  /** Every call but the new body's pool probe, which a refused rebind still makes. */
  ops(): string[] { return this.log.map((c) => c.op).filter((o) => o !== 'poolAnswer'); }
  count(op: string): number { return this.log.filter((c) => c.op === op).length; }
  idsOf(op: string): (string | undefined)[] { return this.log.filter((c) => c.op === op).map((c) => c.id); }
  reset(): void { this.log.length = 0; }
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

interface Facts {
  ccdWords: string[] | null; builds: 'agreed' | 'skewed' | 'unknown'; authority: AuthorityState;
  old: OldBodyState; bodyState: OverlordBodyState; oldAsked: string[]; bodyAsked: string[];
  /** Fable's share readings (a fable class counts an account only on a fresh figure and `fableBilling: included`). */
  fable: boolean;
}
interface Rig {
  app: FastifyInstance; db: DatabaseSync; coord: CoordStore; gate: FakeGate; body: FakeBody; journal: FakeJournal; host: FakeHost;
  facts: Facts; serialRuns: { n: number }; time: ReturnType<typeof fakeTime>;
  /** The bound id, and the generation `goLive` bound it with. */
  oldId: string;
}

/** A rig with a live Overlord bound (a designate, then its go-live through the store), the fakes' logs cleared. `bound: false`
 *  leaves the designation row empty; `noOldBody` and `noBodyFact` leave those two facts out of the deps, as a test server does. */
async function rig(opts: { bound?: boolean; noOldBody?: boolean; noBodyFact?: boolean } = {}): Promise<Rig> {
  const dir = path.join(mkTmp('ccrc-overlord-rebind-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  const coord = new CoordStore(db);
  const gate = fakeGate(); const body = new FakeBody(); const journal = fakeJournal(); const host = new FakeHost();
  const time = fakeTime();
  const facts: Facts = {
    ccdWords: [...DESIGNATE_CCD_WORDS], builds: 'agreed', authority: { kind: 'coherent' },
    old: 'dead', bodyState: { kind: 'gone', cause: 'absent' }, oldAsked: [], bodyAsked: [], fable: false,
  };
  const serialRuns = { n: 0 };
  let tail: Promise<unknown> = Promise.resolve();
  const serial: OverlordRouteDeps['serial'] = (fn) => { serialRuns.n += 1; const run = tail.then(fn, fn); tail = run.catch(() => undefined); return run; };
  const app = Fastify({ logger: false });
  registerOverlordRoutes(app, {
    gate, identity: attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) }),
    serial, coord, journal, body, host: host as unknown as OverlordRouteDeps['host'],
    clock: time.ports.clock, entropy: time.ports.entropy, dec: () => null,
    facts: {
      ccdWords: () => facts.ccdWords, serverWords: ['continuity-v1'], builds: () => facts.builds, roster: () => (facts.fable ? FABLE_ROSTER : ROSTER),
      limits: async () => HEALTHY,
      shares: async () => (facts.fable
        ? { kind: 'reading', finishedAtS: Math.floor(time.ports.clock.wall() / 1000), byAccount: { 'lane-a': 5, 'lane-b': 5, 'lane-c': 5 } }
        : { kind: 'absent' }), authority: () => facts.authority,
      ...(opts.noOldBody === true ? {} : { oldBody: async (id: string) => { facts.oldAsked.push(id); return facts.old; } }),
      ...(opts.noBodyFact === true ? {} : { body: (id: string) => { facts.bodyAsked.push(id); return facts.bodyState; } }),
    },
  });
  await app.ready();
  apps.push(app);
  const r: Rig = { app, db, coord, gate, body, journal, host, facts, serialRuns, time, oldId: '' };
  if (opts.bound !== false) {
    const made = await r.app.inject({ method: 'POST', url: '/api/overlord/designate', payload: PAYLOAD });
    expect(made.statusCode).toBe(200);
    r.oldId = made.json().sessionId as string;
    expect(coord.goLive(journal, r.oldId, GEN, time.ports.clock.wall())).toMatchObject({ ok: true, changed: true });
    body.reset(); journal.seen.length = 0; host.delivered.length = 0; gate.asks.length = 0; serialRuns.n = 0;
    body.alive.clear(); body.alive.add(r.oldId);
  }
  return r;
}

const rebind = (r: Rig, payload?: unknown) => r.app.inject({ method: 'POST', url: '/api/overlord/rebind', ...(payload === undefined ? {} : { payload: payload as object }) });
const restart = (r: Rig) => r.app.inject({ method: 'POST', url: '/api/overlord/restart' });
const rowOf = (r: Rig): Record<string, unknown> | undefined => r.db.prepare('SELECT * FROM overlord_designation').get() as Record<string, unknown> | undefined;
const view = (r: Rig) => { const x = r.coord.designationRead(); return x.kind === 'unmeasured' ? null : x.row; };
const items = (r: Rig): { title: string; why: string }[] => r.db.prepare('SELECT title, why FROM operator_items').all() as { title: string; why: string }[];

/** What a refused rebind or restart must leave alone: the row bytes, the journal, the prompts, and every body call. */
function snapshot(r: Rig) { return { row: rowOf(r), journal: r.journal.seen.length, delivered: r.host.delivered.length, ops: r.body.ops(), alive: [...r.body.alive] }; }

// ── POST /api/overlord/rebind ─────────────────────────────────────────────────────────────────────────────────────────

describe('POST /api/overlord/rebind: the gate and the body', () => {
  it('asks the gate with a step-up and no ccd word, runs on the serialiser, and a gate refusal answers before anything is read', async () => {
    const r = await rig();
    await rebind(r);
    expect(r.gate.asks).toEqual([{ cap: null, stepUp: true }]);
    expect(r.serialRuns.n).toBe(1);
    for (const mode of ['auth-off', 'step-up-required'] as const) {
      const g = await rig();
      g.gate.mode = mode;
      const before = snapshot(g);
      const res = await rebind(g, { force: true });
      expect(res.statusCode).toBe(REFUSAL_STATUS[mode]);
      expect(res.json()).toMatchObject({ ok: false, error: mode });
      expect(g.body.log).toEqual([]);
      expect(g.serialRuns.n).toBe(0);
      expect(snapshot(g)).toEqual(before);
    }
  });

  it('a body other than {}, {force: boolean} or none is 400 bad-request, before the probe', async () => {
    const r = await rig();
    for (const bad of [{ force: 'yes' }, { force: 1 }, { force: null }, { other: true }, { force: true, extra: 1 }, { model: 'opus' }]) {
      const res = await rebind(r, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(REFUSAL_STATUS['bad-request']);
      expect(res.json()).toMatchObject({ error: 'bad-request' });
    }
    expect(r.body.log).toEqual([]);
    expect(r.facts.oldAsked).toEqual([]);
  });

  it('a refusing gate answers before a malformed body is parsed: the gate\'s word, never 400', async () => {
    for (const mode of ['auth-off', 'step-up-required'] as const) {
      const g = await rig();
      g.gate.mode = mode;
      const res = await rebind(g, { force: 'yes' });
      expect(res.statusCode, mode).toBe(REFUSAL_STATUS[mode]);
      expect(res.json()).toMatchObject({ ok: false, error: mode });
      expect(g.body.log).toEqual([]);
    }
  });

  it('no body, {} and {force: false} are accepted (they reach the verdict: 404 with nothing bound)', async () => {
    const r = await rig({ bound: false });
    for (const payload of [undefined, {}, { force: false }, { force: true }]) {
      const res = await rebind(r, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(404);
      expect(res.json()).toMatchObject({ error: 'not-found' });
    }
  });
});

describe('POST /api/overlord/rebind: the refusals, in the plan\'s order', () => {
  it('404 not-found with no live binding (a pending-only row among them), writing and stopping nothing', async () => {
    const r = await rig({ bound: false });
    expect(rowOf(r)).toBeUndefined();
    const none = await rebind(r, { force: true });
    expect(none.statusCode).toBe(REFUSAL_STATUS['not-found']);
    expect(rowOf(r)).toBeUndefined();
    expect(r.body.ops()).toEqual([]);
    // A pending designate holds no binding either.
    expect((await r.app.inject({ method: 'POST', url: '/api/overlord/designate', payload: PAYLOAD })).statusCode).toBe(200);
    r.body.reset();
    const pendingOnly = await rebind(r, { force: true });
    expect(pendingOnly.statusCode).toBe(404);
    expect(r.body.ops()).toEqual([]);
  });

  it('409 overlord-attempt-pending with an attempt pending, even with force, and it stops nothing', async () => {
    const r = await rig();
    expect((await rebind(r)).statusCode).toBe(200);
    r.body.reset(); r.host.delivered.length = 0;
    const before = snapshot(r);
    for (const payload of [undefined, { force: true }]) {
      const res = await rebind(r, payload);
      expect(res.statusCode).toBe(REFUSAL_STATUS['overlord-attempt-pending']);
      expect(res.json()).toMatchObject({ ok: false, error: 'overlord-attempt-pending' });
    }
    expect(r.body.ops()).toEqual([]);
    expect(snapshot(r)).toEqual({ ...before, ops: [] });
  });

  it('409 overlord-body-alive for an alive and an unmeasurable old body; an absent oldBody fact reads unmeasurable', async () => {
    for (const old of ['alive', 'unmeasurable'] as const) {
      const r = await rig();
      r.facts.old = old;
      const before = snapshot(r);
      const res = await rebind(r);
      expect(res.statusCode, old).toBe(REFUSAL_STATUS['overlord-body-alive']);
      expect(res.json()).toMatchObject({ ok: false, error: 'overlord-body-alive' });
      expect(r.facts.oldAsked).toEqual([r.oldId]);
      expect(r.body.ops()).toEqual([]);
      expect(snapshot(r)).toEqual(before);
    }
    const r = await rig({ noOldBody: true });
    const res = await rebind(r, {});
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'overlord-body-alive' });
    expect(r.body.ops()).toEqual([]);
  });

  it('force lifts the old-body step only: an alive, an unmeasurable and an absent-fact body all rebind, the old stopped first', async () => {
    for (const mode of ['alive', 'unmeasurable', 'absent'] as const) {
      const r = await rig({ noOldBody: mode === 'absent' });
      if (mode !== 'absent') r.facts.old = mode;
      const res = await rebind(r, { force: true });
      expect(res.statusCode, mode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, state: 'pending', kind: 'rebind', previous: r.oldId, forced: true });
      expect(r.body.ops()).toEqual(['stop', 'ensureProject', 'create', 'writeSet', 'keepAwake-on']);
      expect(r.body.log.find((c) => c.op === 'stop')!.id).toBe(r.oldId);
    }
  });

  it('a refused rebind, WITH force, stops nothing, creates nothing and changes no row', async () => {
    const cases: [string, (r: Rig) => void][] = [
      ['capability-missing', (r) => { r.facts.ccdWords = null; }],
      ['a missing fresh-pick word', (r) => { r.facts.ccdWords = DESIGNATE_CCD_WORDS.filter((w) => w !== 'fresh-pick-v1'); }],
      ['launch-profile-unmet (skewed builds)', (r) => { r.facts.builds = 'skewed'; }],
      ['launch-profile-unmet (unknown builds)', (r) => { r.facts.builds = 'unknown'; }],
      ['a probe that did not run', (r) => { r.body.probe = { kind: 'not-run' }; }],
    ];
    for (const [name, arrange] of cases) {
      const r = await rig();
      arrange(r);
      const before = snapshot(r);
      const res = await rebind(r, { force: true });
      expect(res.statusCode, name).toBeGreaterThanOrEqual(409);
      expect(res.json(), name).toMatchObject({ ok: false });
      expect(r.body.count('stop'), name).toBe(0);
      expect(r.body.count('create'), name).toBe(0);
      expect(r.body.ops(), name).toEqual([]);
      expect(snapshot(r), name).toEqual(before);
      expect(r.body.alive.has(r.oldId), name).toBe(true);
      expect(view(r)!.pending, name).toBeNull();
    }
    const cap = await rig();
    cap.facts.ccdWords = null;
    expect((await rebind(cap, { force: true })).json()).toMatchObject({ error: 'capability-missing' });
  });

  it('a forced rebind whose stop fails answers 409 overlord-body-alive naming the forced stop, and creates nothing', async () => {
    const r = await rig();
    r.body.stopAnswer = () => ({ ok: false, detail: 'tmux is busy' });
    const before = rowOf(r);
    const res = await rebind(r, { force: true });
    expect(res.statusCode).toBe(REFUSAL_STATUS['overlord-body-alive']);
    expect(res.json()).toMatchObject({ ok: false, error: 'overlord-body-alive' });
    expect(res.json().detail).toContain('forced stop');
    expect(res.json().detail).toContain('tmux is busy');
    expect(r.body.ops()).toEqual(['stop']);
    expect(r.body.count('create')).toBe(0);
    expect(r.body.count('ensureProject')).toBe(0);
    expect(view(r)!.pending).toBeNull();
    expect(rowOf(r)).toEqual(before);
    expect(r.host.delivered).toEqual([]);
    expect(r.journal.seen).toEqual([]);
  });

  it('the authority journal guard: rolled-back or unmeasured refuses before any stop or create, with force too', async () => {
    const r = await rig();
    const before = snapshot(r);
    r.facts.authority = { kind: 'rolled-back', cause: 'behind' };
    const a = await rebind(r, { force: true });
    expect(a.statusCode).toBe(REFUSAL_STATUS['authority-rolled-back']);
    expect(a.json()).toMatchObject({ error: 'authority-rolled-back' });
    r.facts.authority = { kind: 'unmeasured', why: 'journal' };
    const b = await rebind(r, { force: true });
    expect(b.statusCode).toBe(REFUSAL_STATUS['journal-unreadable']);
    expect(b.json()).toMatchObject({ error: 'journal-unreadable' });
    expect(r.body.log).toEqual([]);
    expect(r.facts.oldAsked).toEqual([]);
    expect(snapshot(r)).toEqual(before);
  });

  it('the unmeasured designation row answers 503 unavailable and acts on nothing', async () => {
    const r = await rig();
    r.db.exec("UPDATE overlord_designation SET accountPools = 'nope'");
    const before = snapshot(r);
    const res = await rebind(r, { force: true });
    expect(res.statusCode).toBe(REFUSAL_STATUS.unavailable);
    expect(res.json()).toMatchObject({ error: 'unavailable', detail: 'the designation row could not be read' });
    expect(r.body.ops()).toEqual([]);
    expect(snapshot(r)).toEqual(before);
  });
});

describe('POST /api/overlord/rebind: a success', () => {
  it('answers pending beside the unchanged binding, in the create\'s order, with the row\'s class and set and no authority record', async () => {
    const r = await rig();
    const res = await rebind(r);
    expect(res.statusCode).toBe(200);
    const j = res.json();
    const id: string = j.sessionId;
    expect(id).toMatch(/^overlord-[0-9a-f]{8}$/);
    expect(id).not.toBe(r.oldId);
    expect(j).toMatchObject({ ok: true, state: 'pending', kind: 'rebind', previous: r.oldId, forced: false, awake: true, prompted: true });
    expect(j.deadlineAt).toBe(r.time.ports.clock.wall() + PENDING_MS);

    // No force: the old body is not stopped. The order is the create's.
    expect(r.facts.oldAsked).toEqual([r.oldId]);
    expect(r.body.ops()).toEqual(['ensureProject', 'create', 'writeSet', 'keepAwake-on']);
    expect(r.body.log.find((c) => c.op === 'poolAnswer')!.id).toBe(id);
    expect(r.body.log.find((c) => c.op === 'create')!.id).toBe(id);
    expect(r.body.log.find((c) => c.op === 'writeSet')).toMatchObject({ id, extra: { poolset: 'pool-a,pool-b', acctorder: 'lane-a,lane-c,lane-b' } });
    expect(r.body.log.find((c) => c.op === 'keepAwake-on')!.id).toBe(id);
    expect(r.host.delivered).toEqual([`${id}:${PROMPT}`]);

    // The row: the live binding unchanged, a pending rebind for the new id, no term change, nothing recorded at the door.
    const row = view(r)!;
    expect(row.bound).toEqual({ sessionId: r.oldId, generation: GEN });
    expect(row.pending).toMatchObject({ sessionId: id, kind: 'rebind', generation: NEW_GEN, deadlineAt: j.deadlineAt, actor: 'device-a abcdef01' });
    expect(row.term).toBe(1);
    expect(row.pastIds).toEqual([]);
    expect(row.stopsOwed).toEqual([]);
    expect(r.journal.seen).toEqual([]);
    expect(items(r)).toEqual([]);
  });

  it('the create\'s route carries the ROW\'s class, not a default, with the overlord profile', async () => {
    const r = await rig();
    r.db.exec("UPDATE overlord_designation SET model = 'fable'");
    r.facts.fable = true;
    expect(view(r)!.model).toBe('fable');
    const res = await rebind(r);
    expect(res.statusCode).toBe(200);
    const create = r.body.log.find((c) => c.op === 'create')!;
    expect(create.extra).toMatchObject({ route: { class: 'fable', profile: 'overlord', profiledigest: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(Object.keys((create.extra as { route: object }).route).sort()).toEqual(['class', 'profile', 'profiledigest']);
    expect(view(r)!.model).toBe('fable');
  });

  it('with force, stop(old) runs before create, and the answer says forced', async () => {
    const r = await rig();
    r.facts.old = 'alive';
    const res = await rebind(r, { force: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ forced: true, previous: r.oldId });
    expect(r.body.ops()).toEqual(['stop', 'ensureProject', 'create', 'writeSet', 'keepAwake-on']);
    expect(r.body.idsOf('stop')).toEqual([r.oldId]);
    expect(r.body.alive.has(r.oldId)).toBe(false);
    // The stop does not touch the row: the old binding stands until the go-live.
    expect(view(r)!.bound).toEqual({ sessionId: r.oldId, generation: GEN });
    expect(view(r)!.stopsOwed).toEqual([]);
    expect(r.journal.seen).toEqual([]);
  });

  it('a first prompt that is not delivered answers prompted: false and keeps the attempt pending', async () => {
    const r = await rig();
    r.host.answer = { kind: 'refused', reason: 'draft-present' };
    const res = await rebind(r);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'pending', kind: 'rebind', prompted: false, awake: true });
    expect(view(r)!.pending).not.toBeNull();
    expect(r.body.count('stop')).toBe(0);
  });

  it('a foreign keep-awake marker on the new body raises one item and keeps the attempt', async () => {
    const r = await rig();
    r.body.keepAwakeAnswer = (s) => (s === 'on' ? { ok: true, foreign: ['no-hibernate'] } : { ok: true, foreign: [] });
    const res = await rebind(r);
    expect(res.statusCode).toBe(200);
    expect(items(r)).toHaveLength(1);
    expect(items(r)[0]!.title).toContain(res.json().sessionId);
  });
});

describe('POST /api/overlord/rebind: a failure after the pending row', () => {
  it('a create failure fails the attempt (create-failed), owes and drains only the NEW body, keeps the old binding, answers 502', async () => {
    const r = await rig();
    r.body.createAnswer = () => ({ ok: false, detail: 'lost: yes', created: 'yes' });
    const res = await rebind(r);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'fleetFailed', detail: 'lost: yes' });
    const id = res.json().sessionId as string;
    expect(id).not.toBe(r.oldId);
    const row = view(r)!;
    expect(row.pending).toBeNull();
    expect(row.bound).toEqual({ sessionId: r.oldId, generation: GEN });
    expect(row.term).toBe(1);
    expect(row.pastIds).toEqual([]);
    expect(row.lastAttempt).toMatchObject({ outcome: 'create-failed', sessionId: id });
    expect(row.stopsOwed).toEqual([]);                       // drained
    // Only the new body was stopped, and the old one was never touched.
    expect(r.body.idsOf('stop')).toEqual([id]);
    expect(r.body.idsOf('keepAwake-off')).toEqual([id]);
    expect(r.body.alive.has(r.oldId)).toBe(true);
    expect(r.body.alive.has(id)).toBe(false);
    expect(r.host.delivered).toEqual([]);
    expect(r.journal.seen).toEqual([]);
    expect(rowOf(r)).toMatchObject({ sessionId: r.oldId });
  });

  it('created: no owes nothing; a failed writeSet and a failed keep-awake end the attempt the same way', async () => {
    const no = await rig();
    no.body.createAnswer = () => ({ ok: false, detail: 'ccd refused', created: 'no' });
    const a = await rebind(no);
    expect(a.statusCode).toBe(502);
    expect(no.body.count('stop')).toBe(0);
    expect(view(no)!.lastAttempt).toMatchObject({ outcome: 'create-failed', sessionId: a.json().sessionId });
    expect(view(no)!.bound).toEqual({ sessionId: no.oldId, generation: GEN });

    const set = await rig();
    set.body.setAnswer = { ok: false, detail: 'route write refused' };
    const b = await rebind(set);
    expect(b.statusCode).toBe(502);
    expect(set.body.idsOf('stop')).toEqual([b.json().sessionId]);
    expect(view(set)!.stopsOwed).toEqual([]);
    expect(view(set)!.bound).toEqual({ sessionId: set.oldId, generation: GEN });

    const awake = await rig();
    awake.body.keepAwakeAnswer = (s) => (s === 'on' ? { ok: false, detail: 'unreadable marker' } : { ok: true, foreign: [] });
    const c = await rebind(awake);
    expect(c.statusCode).toBe(502);
    expect(c.json().detail).toBe('unreadable marker');
    expect(awake.host.delivered).toEqual([]);
    expect(awake.body.idsOf('stop')).toEqual([c.json().sessionId]);
    expect(view(awake)!.pending).toBeNull();
  });

  it('a project that cannot be ensured fails the attempt before any create', async () => {
    const r = await rig();
    r.body.projectAnswer = { ok: false, detail: 'the listing failed' };
    const res = await rebind(r);
    expect(res.statusCode).toBe(502);
    expect(r.body.ops()).toEqual(['ensureProject']);
    expect(view(r)!.pending).toBeNull();
    expect(view(r)!.bound).toEqual({ sessionId: r.oldId, generation: GEN });
  });
});

describe('POST /api/overlord/rebind: two racing rebinds', () => {
  it('run through the serialiser: one answers pending, the other 409 overlord-attempt-pending, and ccd creates once', async () => {
    const r = await rig();
    const [a, b] = await Promise.all([rebind(r), rebind(r)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect([a, b].find((x) => x.statusCode === 409)!.json()).toMatchObject({ error: 'overlord-attempt-pending' });
    expect(r.serialRuns.n).toBe(2);
    expect(r.body.count('create')).toBe(1);
    expect(r.body.count('keepAwake-on')).toBe(1);
    expect(r.host.delivered).toHaveLength(1);
    expect(view(r)!.pending).toMatchObject({ kind: 'rebind' });
  });

  it('a second rebind while the first create is in flight waits for it, then is refused', async () => {
    const r = await rig();
    let release!: () => void;
    r.body.gate = new Promise<void>((res) => { release = res; });
    const first = rebind(r);
    for (let i = 0; i < 400 && r.body.count('create') === 0; i++) await new Promise((res) => setTimeout(res, 5));
    expect(r.body.count('create')).toBe(1);
    const second = rebind(r);
    await new Promise((res) => setTimeout(res, 20));
    expect(r.body.count('create')).toBe(1);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(409);
    expect(b.json()).toMatchObject({ error: 'overlord-attempt-pending' });
  });
});

// ── POST /api/overlord/restart ────────────────────────────────────────────────────────────────────────────────────────

describe('POST /api/overlord/restart', () => {
  it('asks the gate with NO step-up, runs on the serialiser, and a gate refusal answers before anything is read', async () => {
    const r = await rig();
    await restart(r);
    expect(r.gate.asks).toEqual([{ cap: null, stepUp: false }]);
    expect(r.serialRuns.n).toBe(1);
    for (const mode of ['auth-off', 'step-up-required'] as const) {
      const g = await rig();
      g.gate.mode = mode;
      const res = await restart(g);
      expect(res.statusCode).toBe(REFUSAL_STATUS[mode]);
      expect(g.body.log).toEqual([]);
      expect(g.facts.bodyAsked).toEqual([]);
      expect(g.serialRuns.n).toBe(0);
    }
  });

  it('404 not-found with no live binding, and the body fact is never read', async () => {
    const r = await rig({ bound: false });
    const res = await restart(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['not-found']);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-found' });
    expect(r.facts.bodyAsked).toEqual([]);
    expect(r.body.log).toEqual([]);
  });

  it('409 overlord-body-alive naming alive, restarting and unmeasured for an up, a down and an unmeasured body', async () => {
    const cases: [OverlordBodyState, string][] = [
      [{ kind: 'up' }, 'alive'],
      [{ kind: 'down', since: null }, 'restarting'],
      [{ kind: 'unmeasured', why: 'the fleet has not answered' }, 'unmeasured'],
    ];
    for (const [state, detail] of cases) {
      const r = await rig();
      r.facts.bodyState = state;
      const before = snapshot(r);
      const res = await restart(r);
      expect(res.statusCode, detail).toBe(REFUSAL_STATUS['overlord-body-alive']);
      expect(res.json(), detail).toMatchObject({ ok: false, error: 'overlord-body-alive', detail });
      expect(r.facts.bodyAsked).toEqual([r.oldId]);
      expect(r.body.log, detail).toEqual([]);
      expect(r.host.delivered).toEqual([]);
      expect(snapshot(r)).toEqual(before);
    }
  });

  it('past the attempt\'s deadline, with no lane Live, Restart ends the attempt as failed, stops its body, and starts only the bound one', async () => {
    for (const force of [false, true]) {
      const r = await rig();
      const made = await rebind(r, { force });
      expect(made.statusCode).toBe(200);
      const newId = made.json().sessionId as string;
      r.body.reset(); r.host.delivered.length = 0;
      r.facts.bodyState = { kind: 'gone', cause: 'stopped' };
      r.time.advance((made.json().deadlineAt as number) - r.time.ports.clock.wall());
      const res = await restart(r);
      expect(res.statusCode, `force ${force}`).toBe(200);
      expect(res.json()).toEqual({ ok: true, sessionId: r.oldId, awake: true, prompted: true });
      // The attempt reads failed, through the one writer of that fact; its body's stop was owed and is done.
      const row = view(r)!;
      expect(row.pending).toBeNull();
      expect(row.lastAttempt).toMatchObject({ sessionId: newId, outcome: 'deadline-passed' });
      expect(row.stopsOwed).toEqual([]);
      expect(r.coord.designationRead()).toMatchObject({ kind: 'designated', sessionId: r.oldId });
      // Exactly one body is started, the bound one; the attempt's body is stopped, never started.
      const of = (op: string) => r.body.log.filter((c) => c.op === op).map((c) => c.id);
      expect(of('ensure')).toEqual([r.oldId]);
      expect(of('create')).toEqual([]);
      expect(of('stop')).toEqual([newId]);
      // The attempt's body is stopped BEFORE the bound one is ensured.
      const at = (op: string, id: string) => r.body.log.findIndex((c) => c.op === op && c.id === id);
      expect(at('stop', newId)).toBeLessThan(at('ensure', r.oldId));
      expect(r.host.delivered).toEqual([`${r.oldId}:${PROMPT}`]);
      // The attempt is over, so Rebind opens again by itself (it now reads the body, not the slot).
      r.facts.old = 'alive';
      expect((await rebind(r)).json()).toMatchObject({ error: 'overlord-body-alive' });
    }
  });

  /** A rebind pending for the bound body's replacement, its deadline passed, the bound body gone: Restart's overdue arm. */
  const overdue = async (): Promise<{ r: Rig; newId: string }> => {
    const r = await rig();
    const made = await rebind(r);
    expect(made.statusCode).toBe(200);
    r.body.reset(); r.host.delivered.length = 0;
    r.facts.bodyState = { kind: 'gone', cause: 'stopped' };
    r.time.advance((made.json().deadlineAt as number) - r.time.ports.clock.wall());
    return { r, newId: made.json().sessionId as string };
  };

  it('past the deadline, a stop that fails starts nothing: 409 overlord-body-alive, the attempt stays ended and its id owed; the next Restart drains it and starts', async () => {
    const { r, newId } = await overdue();
    r.body.stopAnswer = () => ({ ok: false, detail: 'tmux is busy' });
    const res = await restart(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['overlord-body-alive']);
    expect(res.json()).toMatchObject({ ok: false, error: 'overlord-body-alive' });
    expect(String(res.json().detail)).toContain(newId);
    expect(r.body.count('ensure')).toBe(0);
    expect(r.body.count('keepAwake-on')).toBe(0);
    expect(r.host.delivered).toEqual([]);
    expect(view(r)).toMatchObject({ pending: null, stopsOwed: [newId], lastAttempt: { sessionId: newId, outcome: 'deadline-passed' } });
    // A retry heals: the stop is drained again, then the bound body is started.
    r.body.stopAnswer = () => ({ ok: true, absent: false });
    r.body.reset();
    const again = await restart(r);
    expect(again.statusCode).toBe(200);
    expect(r.body.idsOf('stop')).toEqual([newId]);
    expect(r.body.idsOf('ensure')).toEqual([r.oldId]);
    expect(view(r)!.stopsOwed).toEqual([]);
  });

  it('every stop the slot owes is drained before the start, not only the ended attempt\'s', async () => {
    const r = await rig();
    r.db.prepare('UPDATE overlord_designation SET stopsOwed = ?').run(JSON.stringify(['overlord-owed-otter']));
    r.facts.bodyState = { kind: 'asleep' };
    const res = await restart(r);
    expect(res.statusCode).toBe(200);
    expect(r.body.idsOf('stop')).toEqual(['overlord-owed-otter']);
    const at = (op: string) => r.body.log.findIndex((c) => c.op === op);
    expect(at('stop')).toBeLessThan(at('ensure'));
    expect(view(r)!.stopsOwed).toEqual([]);
  });

  it('past the deadline, an ensure that fails answers fleetFailed and keeps the end: the attempt failed, its body stopped, the bound one not started', async () => {
    const { r, newId } = await overdue();
    r.body.ensureAnswer = { ok: false, detail: 'ensure exited 1' };
    const res = await restart(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS.fleetFailed);
    expect(view(r)).toMatchObject({ pending: null, stopsOwed: [], lastAttempt: { sessionId: newId, outcome: 'deadline-passed' } });
    expect(r.body.idsOf('stop')).toEqual([newId]);
    expect(r.body.count('keepAwake-on')).toBe(0);
    expect(r.host.delivered).toEqual([]);
  });

  it('past the deadline, a writer that throws or refuses answers 503 unavailable and acts on no body; the attempt stays pending', async () => {
    for (const fail of ['throws', 'refuses'] as const) {
      const { r, newId } = await overdue();
      (r.coord as unknown as { failPending: () => unknown }).failPending = fail === 'throws'
        ? () => { throw new Error('the database is busy'); }
        : () => ({ ok: false, reason: 'unmeasured', detail: 'unreadable for the test' });
      const res = await restart(r);
      expect(res.statusCode, fail).toBe(REFUSAL_STATUS.unavailable);
      expect(res.json()).toMatchObject({ ok: false, error: 'unavailable' });
      expect(r.body.log).toEqual([]);
      expect(view(r)!.pending).toMatchObject({ sessionId: newId });
    }
  });

  it('past the deadline, a Restart the body refuses ends nothing: the attempt stays pending', async () => {
    const r = await rig();
    const made = await rebind(r);
    r.body.reset();
    r.facts.bodyState = { kind: 'up' };
    r.time.advance((made.json().deadlineAt as number) - r.time.ports.clock.wall() + 1);
    const res = await restart(r);
    expect(res.json()).toMatchObject({ error: 'overlord-body-alive', detail: 'alive' });
    expect(view(r)!.pending).toMatchObject({ sessionId: made.json().sessionId });
    expect(r.body.log).toEqual([]);
  });

  it('409 overlord-attempt-pending while a rebind is pending inside its deadline, for an asleep and a gone old body, even after a forced stop', async () => {
    for (const force of [false, true]) {
      for (const state of [{ kind: 'asleep' }, { kind: 'gone', cause: 'stopped' }] as OverlordBodyState[]) {
        const r = await rig();
        expect((await rebind(r, { force })).statusCode).toBe(200);
        r.body.reset(); r.host.delivered.length = 0;
        r.facts.bodyState = state;
        const before = snapshot(r);
        const res = await restart(r);
        expect(res.statusCode, `${force} ${state.kind}`).toBe(REFUSAL_STATUS['overlord-attempt-pending']);
        expect(res.json()).toMatchObject({ ok: false, error: 'overlord-attempt-pending' });
        // Nothing is ensured, kept awake or prompted: the old body is not started beside the pending one.
        expect(r.body.ops()).toEqual([]);
        expect(r.host.delivered).toEqual([]);
        expect(snapshot(r)).toEqual(before);
      }
    }
  });

  it('an absent body fact reads unmeasured: refused, nothing run', async () => {
    const r = await rig({ noBodyFact: true });
    const res = await restart(r);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'overlord-body-alive', detail: 'unmeasured' });
    expect(r.body.log).toEqual([]);
  });

  it('an asleep and a gone body are accepted: ensure(bound id), then keep-awake on, then the first prompt', async () => {
    const states: OverlordBodyState[] = [{ kind: 'asleep' }, { kind: 'gone', cause: 'absent' }, { kind: 'gone', cause: 'orphan' }];
    for (const state of states) {
      const r = await rig();
      r.facts.bodyState = state;
      const before = rowOf(r);
      const res = await restart(r);
      expect(res.statusCode, state.kind).toBe(200);
      expect(res.json()).toEqual({ ok: true, sessionId: r.oldId, awake: true, prompted: true });
      expect(r.body.ops()).toEqual(['ensure', 'keepAwake-on']);
      expect(r.body.log.map((c) => c.id)).toEqual([r.oldId, r.oldId]);
      expect(r.host.delivered).toEqual([`${r.oldId}:${PROMPT}`]);
      // The same id again: nothing is created, nothing recorded, the row is untouched.
      expect(r.body.count('create')).toBe(0);
      expect(r.journal.seen).toEqual([]);
      expect(rowOf(r)).toEqual(before);
    }
  });

  it('a failed ensure answers 502 with its detail and the id, and sends no prompt and no keep-awake', async () => {
    const r = await rig();
    r.body.ensureAnswer = { ok: false, detail: 'ensure exited 1: no such session' };
    const res = await restart(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS.fleetFailed);
    expect(res.json()).toMatchObject({ ok: false, error: 'fleetFailed', detail: 'ensure exited 1: no such session', sessionId: r.oldId });
    expect(r.body.ops()).toEqual(['ensure']);
    expect(r.host.delivered).toEqual([]);
  });

  it('a failed keep-awake still answers 200 with awake: false, and the prompt is still sent', async () => {
    const r = await rig();
    r.body.keepAwakeAnswer = () => ({ ok: false, detail: 'unreadable marker' });
    const res = await restart(r);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, sessionId: r.oldId, awake: false, prompted: true });
    expect(r.host.delivered).toEqual([`${r.oldId}:${PROMPT}`]);
    expect(r.body.count('stop')).toBe(0);
  });

  it('a first prompt that is not delivered answers prompted: false; a foreign marker raises one item', async () => {
    const r = await rig();
    r.host.answer = { kind: 'unreachable', detail: 'gone' };
    r.body.keepAwakeAnswer = () => ({ ok: true, foreign: ['no-roll'] });
    const res = await restart(r);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, sessionId: r.oldId, awake: true, prompted: false });
    expect(items(r)).toHaveLength(1);
    expect(items(r)[0]!.why).toContain('no-roll');
  });
});

describe('the unmeasured designation row', () => {
  it('answers 503 unavailable for both doors, and acts on nothing', async () => {
    const r = await rig();
    r.db.exec("UPDATE overlord_designation SET accountPools = 'nope'");
    const before = snapshot(r);
    const a = await rebind(r);
    expect(a.statusCode).toBe(REFUSAL_STATUS.unavailable);
    expect(a.json()).toMatchObject({ error: 'unavailable', detail: 'the designation row could not be read' });
    const b = await restart(r);
    expect(b.statusCode).toBe(503);
    expect(b.json()).toMatchObject({ error: 'unavailable', detail: 'the designation row could not be read' });
    expect(r.body.ops()).toEqual([]);
    expect(r.facts.bodyAsked).toEqual([]);
    expect(snapshot(r)).toEqual(before);
  });
});
