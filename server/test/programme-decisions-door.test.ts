// Programme lifecycle W3 (spec 2026-11-24 §13, R9; D-8990): `POST /api/programmes/decisions` AS REGISTERED, on a real server
// with sign-in armed (a passphrase, a real session cookie, the real step-up), a real `CoordStore` and a fixture registry.
// Fixture HOME, neutral names only (prog-a, lane-a): the operator's real file is never in this repository.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as lifecycle from '../src/coord/programmeLifecycleStore.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { LINEAR_SYNC_PROGRAMME } from '../../shared/plan.js';
import type { ProgrammeDecisionsAnswer } from '../../shared/programmeLifecycle.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'a test passphrase for the decisions suite';
const ORIGIN = 'http://localhost:7788';
const URL_ = '/api/programmes/decisions';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; removeTmpFixtures(); });

interface Rig {
  coord: CoordStore;
  send: (method: 'GET' | 'POST', url: string, payload?: unknown, o?: { cookie?: boolean; headers?: Record<string, string> }) => Promise<LightMyRequestResponse>;
  stepUp: () => Promise<void>;
  /** Preview, and apply (the rig stepped up), each answering 200. */
  preview: (decisions: unknown) => Promise<ProgrammeDecisionsAnswer>;
  apply: (decisions: unknown) => Promise<ProgrammeDecisionsAnswer>;
}

/** One programme row with its runs, as a fixture: `open` runs `working`, `closed` runs `done`, each dispatched. */
function prog(coord: CoordStore, slug: string, p: { state?: string; planEnd?: string | null; coordinator?: string | null; open?: number; closed?: number; claimedBy?: string } = {}): void {
  coord.db.prepare('INSERT INTO programs (slug, title, createdAt, state, planEnd, coordinator, coordinatorUuid) VALUES (?, ?, 1, ?, ?, ?, ?)')
    .run(slug, slug, p.state ?? 'active', p.planEnd ?? null, p.coordinator ?? null, p.coordinator == null ? null : `u-${p.coordinator}`);
  const add = (wave: number, state: string): void => {
    const r = coord.db.prepare("INSERT INTO runs (program, wave, project, state, claimedBy, openedAt, kind) VALUES (?, ?, 'project-a', ?, ?, 1, 'work')")
      .run(slug, wave, state, p.claimedBy ?? p.coordinator ?? null);
    coord.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy) VALUES (?, 1, 'planned', 'dispatched', 'coordinator')").run(Number(r.lastInsertRowid));
  };
  for (let i = 0; i < (p.open ?? 0); i++) add(i + 1, 'working');
  for (let i = 0; i < (p.closed ?? 0); i++) add(100 + i, 'done');
}

async function rig(opts: { authEnabled?: boolean } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-decisions-');
  for (const id of ['lane-a', 'lane-b', 'lane-c']) seedRow(home, id, { project: 'project-a' });
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const base = testDeps(home, recorder().run);
  const armed = opts.authEnabled ?? true;
  app = await buildServer({ ...base, coord, mailToken: ID_GATE_TOKEN,
    cfg: { ...base.cfg, authEnabled: armed, cookieSecure: false, rpId: 'localhost', origin: ORIGIN } }, new Bus());
  let cookie = '';
  if (armed) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE }, headers: { 'user-agent': 'a test phone', origin: ORIGIN } });
    expect(login.statusCode, login.body).toBe(204);
    const set = login.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    cookie = line.slice(0, line.indexOf(';'));
  }
  const self = app;
  const send: Rig['send'] = (method, url, payload, o = {}) => self.inject({
    method, url,
    headers: { origin: ORIGIN, ...(o.cookie === false || cookie === '' ? {} : { cookie }), ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...o.headers },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
  const stepUp = async () => {
    const r = await send('POST', '/api/auth/step-up/passphrase', { passphrase: PASSPHRASE });
    expect(r.statusCode, r.body).toBeLessThan(300);
  };
  const ok = async (body: unknown) => {
    const r = await send('POST', URL_, body);
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as ProgrammeDecisionsAnswer;
  };
  return { coord, send, stepUp, preview: (decisions) => ok({ decisions }), apply: async (decisions) => { await stepUp(); return ok({ decisions, apply: true }); } };
}

type Ev = { program: string; edge: string; fromState: string | null; toState: string | null; actorKind: string; actor: string; why: string; detail: string | null };
const events = (r: Rig): Ev[] => r.coord.db.prepare('SELECT program, edge, fromState, toState, actorKind, actor, why, detail FROM programme_events ORDER BY id').all() as unknown as Ev[];
const row = (r: Rig, slug: string) => r.coord.programmeLifecycleRow(slug)!;
const outcomes = (a: ProgrammeDecisionsAnswer) => Object.fromEntries(a.entries.map((e) => [e.slug, e.outcome]));
const d = (slug: string, to: string, why = `${slug}: the operator decided ${to}`) => ({ slug, to, why });

/** One programme of every kind the operator's list decides, and what it does not name. */
function seedAll(r: Rig): void {
  prog(r.coord, 'prog-live', { open: 1, coordinator: 'lane-a' });        // Active
  prog(r.coord, 'prog-kept-idle', { state: 'done', closed: 1 });         // a D-51 done the migration kept
  prog(r.coord, 'prog-kept-done', { state: 'done', closed: 1 });
  prog(r.coord, 'prog-kept-dropped', { state: 'abandoned', closed: 1 });
  prog(r.coord, 'prog-held', { state: 'paused', closed: 1 });            // Paused
  prog(r.coord, 'prog-odd', { state: 'retired-by-hand', closed: 1 });    // Unknown
  prog(r.coord, 'prog-unnamed', { closed: 1 });                          // Idle, unlisted
}
const FILE = [
  d('prog-live', 'active'), d('prog-kept-idle', 'idle'), d('prog-kept-done', 'done'), d('prog-kept-dropped', 'done'),
  d('prog-held', 'paused'), d('prog-odd', 'idle'),
];

describe('the credential (spec §14): a preview needs the session, the apply a step-up', () => {
  it('cookieless is 401, the box token included; signed in, it previews; apply without a step-up is refused and writes nothing', async () => {
    const r = await rig();
    prog(r.coord, 'prog-a', { closed: 1 });
    const body = { decisions: [d('prog-a', 'paused')] };
    expect((await r.send('POST', URL_, body, { cookie: false })).statusCode).toBe(401);
    expect((await r.send('POST', URL_, body, { cookie: false, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN } })).statusCode).toBe(401);
    expect((await r.preview(body.decisions)).apply).toBe(false);
    const res = await r.send('POST', URL_, { ...body, apply: true });
    expect([res.statusCode, res.json().error]).toEqual([403, 'step-up-required']);
    expect(row(r, 'prog-a').state).toBe('active');
    expect(events(r)).toEqual([]);
    expect(outcomes(await r.apply(body.decisions))).toEqual({ 'prog-a': 'applied' });
    expect(row(r, 'prog-a').state).toBe('paused');
  });
  it('dark, the preview answers and the apply is refused', async () => {
    const r = await rig({ authEnabled: false });
    prog(r.coord, 'prog-a', { closed: 1 });
    expect(outcomes(await r.preview([d('prog-a', 'paused')]))).toEqual({ 'prog-a': 'would-apply' });
    const res = await r.send('POST', URL_, { decisions: [d('prog-a', 'paused')], apply: true });
    expect([res.statusCode, res.json().error]).toEqual([501, 'auth-off']);
    expect(events(r)).toEqual([]);
  });
  it('a shape fault refuses the whole file, before anything is written', async () => {
    const r = await rig();
    prog(r.coord, 'prog-a', { closed: 1 });
    await r.stepUp();
    for (const body of [[], {}, { decisions: [] }, { decisions: [d('prog-a', 'paused'), d('prog-b', 'finished')], apply: true }, { decisions: [d('prog-a', 'paused')], apply: 'yes' }]) {
      const res = await r.send('POST', URL_, body);
      expect([res.statusCode, res.json().error], JSON.stringify(body)).toEqual([400, 'bad-request']);
    }
    expect(events(r)).toEqual([]);
    expect(row(r, 'prog-a').state).toBe('active');
  });
});

describe('preview, then apply, then a second apply (spec §13)', () => {
  it('the preview writes nothing and says what the apply then does', async () => {
    const r = await rig();
    seedAll(r);
    const p = await r.preview(FILE);
    expect(events(r)).toEqual([]);
    expect(outcomes(p)).toEqual({ 'prog-live': 'unchanged', 'prog-kept-idle': 'would-apply', 'prog-kept-done': 'would-apply',
      'prog-kept-dropped': 'would-apply', 'prog-held': 'unchanged', 'prog-odd': 'would-apply' });
    const a = await r.apply(FILE);
    expect(outcomes(a)).toEqual({ ...outcomes(p), 'prog-kept-idle': 'applied', 'prog-kept-done': 'applied', 'prog-kept-dropped': 'applied', 'prog-odd': 'applied' });
    expect(a.counts).toEqual({ open: 0, active: 1, idle: 2, paused: 1, done: 2, abandoned: 0, unknown: 0 });
    expect({ ...a, apply: false, entries: [] }).toEqual({ ...p, entries: [] });
    expect(a).toMatchObject({ listed: 6, unlisted: [{ slug: 'prog-unnamed', shown: 'idle' }], placeholders: 0, conflicts: [], reservedRow: true });
  });

  it('each applied decision is one event of the one writer: backfill, the operator, the file\'s why, what it asked', async () => {
    const r = await rig();
    seedAll(r);
    await r.apply(FILE);
    const seen = events(r);
    expect(seen.map((e) => [e.program, e.edge, e.fromState, e.toState])).toEqual([
      ['prog-kept-idle', 'reopened', 'done', 'active'],      // a D-51 done decided idle takes the reopen edge
      ['prog-kept-done', 'ended', 'done', 'done'],           // an end the migration kept is recorded
      ['prog-kept-dropped', 'ended', 'abandoned', 'done'],
      ['prog-odd', 'repaired', 'retired-by-hand', 'active'], // an Unknown row takes the repair edge
    ]);
    for (const e of seen) expect([e.actorKind, e.actor === '' || e.actor === 'unmeasured', e.why]).toEqual(['backfill', false, FILE.find((x) => x.slug === e.program)!.why]);
    expect(seen.map((e) => JSON.parse(e.detail!))).toEqual([{ decided: 'idle' }, { decided: 'done' }, { decided: 'done' }, { decided: 'idle', unreadable: 'retired-by-hand' }]);
    expect(row(r, 'prog-kept-done')).toMatchObject({ state: 'done', planEnd: 'done' });
    expect(row(r, 'prog-kept-idle')).toMatchObject({ state: 'active', planEnd: null });
  });

  it('a second apply writes zero events and answers unchanged; nothing outside the file changes', async () => {
    const r = await rig();
    seedAll(r);
    await r.apply(FILE);
    const first = events(r).length;
    const again = await r.apply(FILE);
    expect(events(r)).toHaveLength(first);
    expect(new Set(Object.values(outcomes(again)))).toEqual(new Set(['unchanged']));
    expect(row(r, 'prog-unnamed')).toMatchObject({ state: 'active' });
  });

  it('an end the file decides releases the coordinator, closes nothing open, and tells it, in the same transaction', async () => {
    const r = await rig();
    prog(r.coord, 'prog-a', { closed: 1, coordinator: 'lane-b' });
    await r.apply([d('prog-a', 'done')]);
    expect(row(r, 'prog-a')).toMatchObject({ state: 'done', planEnd: 'done', coordinator: null });
    const mail = r.coord.db.prepare('SELECT toId, subject, body FROM mail').all() as { toId: string; subject: string; body: string }[];
    expect(mail.map((m) => [m.toId, m.subject])).toEqual([['lane-b', 'You own no programme now']]);
    expect(mail[0]!.body).toMatch(/prog-a ended \(done\): prog-a: the operator decided done/);
  });
});

describe('each entry refused in the preview and in the apply, the rest applied', () => {
  it('unknown, placeholder, reserved, duplicate, missing why, open runs, a recorded end', async () => {
    const r = await rig();
    prog(r.coord, 'prog-a', { closed: 1 });
    prog(r.coord, 'prog-b', { closed: 1 });
    prog(r.coord, 'prog-run', { open: 2, coordinator: 'lane-a' });
    prog(r.coord, 'prog-ended', { state: 'done', planEnd: 'done', closed: 1 });
    r.coord.db.exec('BEGIN');
    lifecycle.mintInTx(r.coord.db, { slug: 'p-abc', title: 'p-abc', state: 'active', placeholder: 'unfiled', actor: { kind: 'system', id: 'sweep' },
      why: 'joined at spawn', coordinator: { session: 'lane-c', uuid: 'u-lane-c' } }, 1);
    r.coord.db.exec('COMMIT');
    const before = events(r).length;
    const file = [d('prog-none', 'idle'), d('p-abc', 'idle'), d(LINEAR_SYNC_PROGRAMME, 'done'), d('prog-a', 'done'), d('prog-a', 'idle'),
      { slug: 'prog-b', to: 'paused' }, d('prog-run', 'done'), d('prog-ended', 'abandoned')];
    const want = [['prog-none', 'refused:unknown-programme'], ['p-abc', 'refused:programme-provisional'], [LINEAR_SYNC_PROGRAMME, 'refused:reserved-programme'],
      ['prog-a', 'refused:duplicate-entry'], ['prog-a', 'refused:duplicate-entry'], ['prog-b', 'refused:why-required'],
      ['prog-run', 'refused:programme-runs-open'], ['prog-ended', 'refused:programme-ended']];
    const p = await r.preview(file);
    expect(p.entries.map((e) => [e.slug, e.outcome])).toEqual(want);
    // The listed counts hold the real programmes alone; the placeholder and the reserved row are apart.
    expect(p).toMatchObject({ listed: 4, placeholders: 1, reservedRow: true, unlisted: [] });
    expect(p.counts).toMatchObject({ idle: 2, active: 1, done: 1, paused: 0 });
    const a = await r.apply([...file, d('prog-c', 'open')]);
    expect(a.entries.slice(0, want.length).map((e) => [e.slug, e.outcome])).toEqual(want);
    expect(events(r)).toHaveLength(before);
    expect(row(r, 'prog-run')).toMatchObject({ state: 'active', coordinator: 'lane-a' });
    expect(r.coord.programOpenRunCount('prog-run')).toBe(2);
    // A refused entry holds back nothing else: the ones that stand are applied.
    expect(outcomes(await r.apply([...file, d('prog-b', 'paused')].filter((e) => e.slug !== 'prog-b' || 'why' in e)))['prog-b']).toBe('applied');
  });

  it('a mismatch is reported and never forced: the runs decide', async () => {
    const r = await rig();
    prog(r.coord, 'prog-run', { open: 1, coordinator: 'lane-a' });
    prog(r.coord, 'prog-held', { state: 'paused', open: 1 });
    prog(r.coord, 'prog-quiet', { closed: 1 });
    prog(r.coord, 'prog-fresh', { state: 'done' });
    const a = await r.apply([d('prog-run', 'idle'), d('prog-held', 'idle'), d('prog-quiet', 'active'), d('prog-fresh', 'idle')]);
    expect(a.entries.map((e) => [e.slug, e.outcome, e.shown, e.edge])).toEqual([
      ['prog-run', 'mismatch', 'active', null], ['prog-held', 'mismatch', 'active', 'resume'],
      ['prog-quiet', 'mismatch', 'idle', null], ['prog-fresh', 'mismatch', 'open', 'reopened']]);
    expect(r.coord.programOpenRunCount('prog-run')).toBe(1);
    expect(events(r).map((e) => [e.program, e.edge])).toEqual([['prog-held', 'resume'], ['prog-fresh', 'reopened']]);
    expect(a.counts).toMatchObject({ active: 2, idle: 1, open: 1 });
  });
});

describe('conflicts: listed for the operator, resolved by a hand-over, never by the file (spec §13)', () => {
  it('a session-in-several conflict stays through a file entry and leaves with a hand-over of each programme', async () => {
    const r = await rig();
    // lane-a holds open runs in both, owning neither: what the migration seeds as a conflict.
    prog(r.coord, 'prog-a', { open: 2, claimedBy: 'lane-a' });
    prog(r.coord, 'prog-b', { open: 1, claimedBy: 'lane-a' });
    const file = [d('prog-a', 'active'), d('prog-b', 'active')];
    const whole = [{ kind: 'session-in-several', session: 'lane-a', programmes: [{ slug: 'prog-a', openRuns: 2 }, { slug: 'prog-b', openRuns: 1 }] }];
    expect((await r.preview(file)).conflicts).toEqual(whole);
    expect((await r.apply(file)).conflicts, 'a file entry never resolves one').toEqual(whole);
    expect([row(r, 'prog-a').coordinator, row(r, 'prog-b').coordinator]).toEqual([null, null]);
    // The first to the party itself (R11 rule 4's one exception), the second to another coordinator, the party mailed.
    const first = await r.send('POST', '/api/programmes/prog-a/coordinator', { session: 'lane-a', why: 'it keeps this one' });
    expect(first.statusCode, first.body).toBe(200);
    expect((await r.preview(file)).conflicts).toEqual([{ kind: 'session-in-several', session: 'lane-a', programmes: [{ slug: 'prog-b', openRuns: 1 }] }]);
    const second = await r.send('POST', '/api/programmes/prog-b/coordinator', { session: 'lane-b', why: 'one coordinator, one programme' });
    expect(second.statusCode, second.body).toBe(200);
    expect((await r.preview(file)).conflicts).toEqual([]);
    const mail = r.coord.db.prepare("SELECT subject FROM mail WHERE toId = 'lane-a' ORDER BY id").all() as { subject: string }[];
    expect(mail.map((m) => m.subject)).toContain('prog-b was handed to lane-b');
  });

  it('a programme several sessions claim is listed with its claimants', async () => {
    const r = await rig();
    prog(r.coord, 'prog-a', { open: 1, claimedBy: 'lane-a' });
    r.coord.db.prepare("INSERT INTO runs (program, wave, project, state, claimedBy, openedAt, kind) VALUES ('prog-a', 9, 'project-a', 'working', 'lane-b', 1, 'work')").run();
    expect((await r.preview([d('prog-a', 'active')])).conflicts)
      .toEqual([{ kind: 'programme-several-claimants', slug: 'prog-a', claimants: ['lane-a', 'lane-b'], openRuns: 2 }]);
  });
});
