// Landing order wave 5j-b, Task 9 (D-9049): `POST /api/landing/pause` and `POST /api/landing/withdraw`, the operator's two
// doors on the landing line, over the real store, the real journal adapter and the real server. Fixture HOME, database and
// journal directory only; the box token is a test constant. Dark, each door opens and records `flag-off`. Armed, the global
// gate demands a session (the box token alone is refused), and the record's actor is the device actor text of that session:
// a real login with a chosen `user-agent` gives the labelled session, and a hand-built `sessionAuth` answering `device: null`
// gives `unmeasured`, which no real session yields (the `collect-lane-route.test.ts` rig; section 11, C8). Every answer is
// read whole by `inject` before its app closes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createLandingJournal } from '../src/coord/landingJournal.js';
import { deviceActor } from '../src/ccdargv.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { GateDecision } from '../src/auth/gate.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import { LANDING_REFUSAL_STATUS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const P = 'project-a';
const PASSPHRASE = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
/** A real, long User-Agent whose 120-unit cut ends in a space: the device actor keeps it, untrimmed. */
const LONG_UA = `${'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778 Mobile Safari/537.36'.padEnd(119, 'z')} more`;

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)));
  removeTmpFixtures();
});

interface World { home: string; db: DatabaseSync; store: CoordStore; app: FastifyInstance; journal: () => string }
const storeAt = (home: string, port = true): { db: DatabaseSync; store: CoordStore; dir: string } => {
  const dir = path.join(home, '.ccrc');
  mkdirSync(dir, { recursive: true });
  const db = openCoordDb(path.join(dir, 'coord.db'));
  const store = port ? new CoordStore(db, { landingJournal: createLandingJournal(dir) }) : new CoordStore(db);
  if (port) { const r = store.replayLandingJournal(); if (!r.ok) throw new Error(`fixture replay refused: ${r.error}`); }
  return { db, store, dir };
};
const journalOf = (dir: string) => (): string => { try { return readFileSync(path.join(dir, 'landing.log'), 'utf8'); } catch { return ''; } };
/** A (pr 1) the head and B (pr 2) after A: run-less entries created by `lane-a`. */
const seedLine = (store: CoordStore): void => {
  for (const pr of [1, 2]) {
    const r = store.writeLandingAuthority({ kind: 'entry', project: P, pr, pinnedSha: 'a'.repeat(40), handoffCommit: 'c'.repeat(40), setBy: 'lane-a' }, 1000 + pr);
    if (!r.ok) throw new Error('fixture entry refused');
  }
  const a = store.readLanding(P);
  if (!a.ok) throw new Error('fixture read refused');
  const r = store.writeLandingAuthority({ kind: 'order', project: P, pr: 2, afterIds: [a.facts.entries[0]!.id], setBy: 'lane-a' }, 1100);
  if (!r.ok) throw new Error('fixture order refused');
};

const world = async (o: { armed?: boolean; port?: boolean; coord?: boolean; seed?: boolean } = {}): Promise<World> => {
  const home = mkTmp('ccrc-landing-doors-');
  const { db, store, dir } = storeAt(home, o.port ?? true);
  if (o.armed) writeFileSync(path.join(dir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST, 1)}\n`, { mode: 0o600 });
  if (o.seed !== false && (o.port ?? true)) seedLine(store);
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const base = testDeps(home);
  const app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: o.armed === true, cookieSecure: false }, mailToken: TOKEN,
    notifyLog: log, ...(o.coord === false ? {} : { coord: store }) });
  closers.push(() => app.close());
  return { home, db, store, app, journal: journalOf(dir) };
};
const login = async (a: FastifyInstance, ua: string): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', headers: { 'user-agent': ua }, payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};
const door = (app: FastifyInstance, which: 'pause' | 'withdraw', body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/api/landing/${which}`, headers, payload: body as object });
const pinTimeOf = (store: CoordStore, pr: number): number => {
  const r = store.readLanding(P);
  if (!r.ok) throw new Error('fixture read refused');
  return r.facts.entries.find((e) => e.pr === pr)!.pinnedAt;
};
const lastRecord = (w: World): Record<string, unknown> => {
  const lines = w.journal().split('\n').filter((l) => l !== '');
  return JSON.parse(lines.at(-1)!) as Record<string, unknown>;
};
const NO_SUCCESSOR = ['head', 'next', 'order', 'successor', 'coordinator', 'released'];

describe('the doors with sign-in dark (F5 ruling): each opens and records flag-off', () => {
  it('a pause, its resume and a withdraw each answer 200 with no credential', async () => {
    const w = await world();
    const p = await door(w.app, 'pause', { project: P, paused: true });
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json()).toEqual({ ok: true, project: P, operatorPaused: true, changed: true, seq: 4 });
    expect(lastRecord(w)).toMatchObject({ kind: 'pause', paused: true, setBy: 'operator', actor: 'flag-off' });
    const r = await door(w.app, 'pause', { project: P, paused: false });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ ok: true, project: P, operatorPaused: false, changed: true, seq: 5 });
    expect(lastRecord(w)).toMatchObject({ kind: 'pause', paused: false, actor: 'flag-off' });
    const x = await door(w.app, 'withdraw', { project: P, pr: 1, pinnedAt: pinTimeOf(w.store, 1) });
    expect(x.statusCode, x.body).toBe(200);
    const body = x.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, changed: true, seq: 6, entry: { pr: 1, state: 'withdrawn' }, previous: { pr: 1, state: 'pinned' } });
    expect((body.notices as { word: string }[]).map((n) => n.word)).toEqual(['landing-withdrawn', 'landing-held']);
    expect(lastRecord(w)).toMatchObject({ kind: 'withdraw', setBy: 'operator', actor: 'flag-off', subject: { pr: 1 } });
  });

  it('no door answers a head, next, order or successor field, nor the internal coordinator or released', async () => {
    const w = await world();
    const answers = [await door(w.app, 'pause', { project: P, paused: true }), await door(w.app, 'pause', { project: P, paused: true }),
      await door(w.app, 'withdraw', { project: P, pr: 1, pinnedAt: pinTimeOf(w.store, 1) })];
    for (const a of answers) {
      expect(a.statusCode, a.body).toBe(200);
      for (const k of NO_SUCCESSOR) expect(Object.keys(a.json() as object), k).not.toContain(k);
    }
  });

  it('a repeated pause answers changed false, seq null, and appends nothing', async () => {
    const w = await world();
    await door(w.app, 'pause', { project: P, paused: true });
    const bytes = w.journal();
    const again = await door(w.app, 'pause', { project: P, paused: true });
    expect(again.json()).toEqual({ ok: true, project: P, operatorPaused: true, changed: false, seq: null });
    expect(w.journal()).toBe(bytes);
  });
});

describe('the doors with sign-in armed: the gate demands a session; the box token alone is refused', () => {
  it('a session labelled by a real, long User-Agent: pause, resume and withdraw each 200, the actor exactly deviceActor\'s text', async () => {
    const w = await world({ armed: true });
    const cookie = await login(w.app, LONG_UA);
    const actor = deviceActor(LONG_UA.slice(0, 120));
    expect(actor.endsWith(' ')).toBe(true);
    for (const [which, body] of [['pause', { project: P, paused: true }], ['pause', { project: P, paused: false }]] as const) {
      const res = await door(w.app, which, body, { cookie });
      expect(res.statusCode, res.body).toBe(200);
      expect(lastRecord(w)).toMatchObject({ kind: 'pause', paused: body.paused, actor });
    }
    const x = await door(w.app, 'withdraw', { project: P, pr: 1, pinnedAt: pinTimeOf(w.store, 1) }, { cookie });
    expect(x.statusCode, x.body).toBe(200);
    expect(lastRecord(w)).toMatchObject({ kind: 'withdraw', actor });
  });

  it.each([['the box token only', tok], ['neither credential', {}]] as const)('%s: each door answers 401 and nothing is journalled', async (_l, headers) => {
    const w = await world({ armed: true });
    const bytes = w.journal();
    for (const [which, body] of [['pause', { project: P, paused: true }], ['pause', { project: P, paused: false }],
      ['withdraw', { project: P, pr: 1, pinnedAt: pinTimeOf(w.store, 1) }]] as const) {
      const res = await door(w.app, which, body, headers);
      expect(res.statusCode, `${which} ${res.body}`).toBe(401);
    }
    expect(w.journal()).toBe(bytes);
  });

  it('a session with no device label records unmeasured (a hand-built sessionAuth, the collect-lane rig)', async () => {
    const home = mkTmp('ccrc-landing-doors-rig-');
    const { store, dir } = storeAt(home);
    seedLine(store);
    const base = testDeps(home);
    const notifyLog = new NotifyLog(path.join(home, 'notify.json'));
    await notifyLog.load();
    const deps: Deps = { ...base, notifyLog, coord: store, cfg: { ...base.cfg, authEnabled: true } };
    const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });
    const app = Fastify();
    registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
    closers.push(() => app.close());
    const res = await door(app, 'pause', { project: P, paused: true });
    expect(res.statusCode, res.body).toBe(200);
    const lines = journalOf(dir)().split('\n').filter((l) => l !== '');
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ kind: 'pause', actor: 'unmeasured' });
  });
});

describe('the doors\' bodies and refusals (section 4.5)', () => {
  const statusOf = (word: keyof typeof LANDING_REFUSAL_STATUS): number => LANDING_REFUSAL_STATUS[word];

  it('each bad body answers 400 bad-request and journals nothing', async () => {
    const w = await world();
    const bytes = w.journal();
    for (const body of [{ project: P, paused: true, afterIds: [] }, { project: P, paused: 'yes' }, { project: '', paused: true }, [], { project: P }]) {
      const res = await door(w.app, 'pause', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad-request' });
    }
    for (const body of [{ project: P, pr: 1, pinnedAt: 1, head: 7 }, { project: P, pr: 1, pinnedAt: -1 }, { project: P, pr: 0, pinnedAt: 1 }, { project: P, pr: 1 }]) {
      const res = await door(w.app, 'withdraw', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(w.journal()).toBe(bytes);
  });

  it('pause: a project the line has never seen is 404 landing-project-unknown', async () => {
    const w = await world();
    const res = await door(w.app, 'pause', { project: 'project-b', paused: true });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'landing-project-unknown' });
  });

  it('withdraw: missing 404, terminal 409 with no detail, moved 409', async () => {
    const w = await world();
    const missing = await door(w.app, 'withdraw', { project: P, pr: 9, pinnedAt: 1 });
    expect([missing.statusCode, missing.json()]).toEqual([statusOf('landing-entry-missing'), { ok: false, error: 'landing-entry-missing' }]);
    const moved = await door(w.app, 'withdraw', { project: P, pr: 1, pinnedAt: pinTimeOf(w.store, 1) + 1 });
    expect([moved.statusCode, moved.json()]).toEqual([409, { ok: false, error: 'landing-entry-moved' }]);
    const at = pinTimeOf(w.store, 1);
    expect((await door(w.app, 'withdraw', { project: P, pr: 1, pinnedAt: at })).statusCode).toBe(200);
    const terminal = await door(w.app, 'withdraw', { project: P, pr: 1, pinnedAt: at });
    expect([terminal.statusCode, terminal.json()]).toEqual([409, { ok: false, error: 'landing-entry-terminal' }]);
  });

  it('withdraw: recovery-unresolved 409 and identity-conflict 409', async () => {
    const w = await world();
    w.db.prepare("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (90, ?, 9, 'no-run', NULL, 1)").run(P);
    const rec = await door(w.app, 'withdraw', { project: P, pr: 9, pinnedAt: 1 });
    expect([rec.statusCode, rec.json()]).toEqual([409, { ok: false, error: 'landing-recovery-unresolved' }]);
    // An identity conflict: a recovered subject of project-a whose id another project's row holds.
    const v = await world();
    v.db.prepare("INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (96, 'project-b', 8, ?, ?, NULL, 'pinned', 'lane-b', 1)")
      .run('a'.repeat(40), 'c'.repeat(40));
    v.db.prepare("INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (96, ?, 50, 'no-run', NULL, 1)").run(P);
    const conflict = await door(v.app, 'withdraw', { project: P, pr: 1, pinnedAt: pinTimeOf(v.store, 1) });
    expect([conflict.statusCode, conflict.json()]).toEqual([409, { ok: false, error: 'landing-identity-conflict' }]);
  });

  it('withdraw: an unrecognised stored word is 503 landing-projection-unreadable with recovery repair; an unreadable association 503 run-unreadable', async () => {
    const w = await world();
    w.db.prepare("UPDATE landing_entries SET state = 'later' WHERE pr = 1").run();
    const bad = await door(w.app, 'withdraw', { project: P, pr: 1, pinnedAt: 1001 });
    expect([bad.statusCode, bad.json()]).toEqual([503, { ok: false, error: 'landing-projection-unreadable', recovery: 'repair' }]);
    const v = await world();
    const o = v.store.openRun({ program: 'prog-a', title: 't', project: P, wave: 1, waveOf: null, claimedBy: 'coord-a' });
    if (!('id' in o)) throw new Error('fixture openRun refused');
    // A run-bound row with no journal subject (so no recovery holds it), whose run row's claimant is a BLOB.
    v.db.prepare("INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (97, ?, 7, ?, ?, ?, 'pinned', 'coord-a', 7)")
      .run(P, 'a'.repeat(40), 'c'.repeat(40), o.id);
    v.db.prepare("UPDATE runs SET claimedBy = x'00' WHERE id = ?").run(o.id);   // a BLOB: the association does not read
    const run = await door(v.app, 'withdraw', { project: P, pr: 7, pinnedAt: 7 });
    expect([run.statusCode, run.json()]).toMatchObject([503, { ok: false, error: 'run-unreadable' }]);
  });

  // The two words only the writer itself can answer (review run 3864's F3 ruling): the deps hand the door the real store, whose
  // writer is spied to answer each word once. No seam in source; the route's status and word are what is pinned.
  it.each([['landing-record-unparseable', 500], ['landing-sequence-overflow', 409]] as const)('the writer\'s %s answers %i with its word', async (word, status) => {
    const w = await world();
    const spy = vi.spyOn(w.store, 'writeLandingAuthority').mockReturnValue({ ok: false, error: word } as never);
    for (const [which, body] of [['pause', { project: P, paused: true }], ['withdraw', { project: P, pr: 1, pinnedAt: 1001 }]] as const) {
      const res = await door(w.app, which, body);
      expect([statusOf(word), res.statusCode, res.json()], which).toEqual([status, status, { ok: false, error: word }]);
    }
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('an infrastructure refusal is 503 (no journal port), and with no coordination 501', async () => {
    const w = await world({ port: false });
    const res = await door(w.app, 'pause', { project: P, paused: true });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'landing-journal-unavailable' });
    const none = await world({ coord: false, seed: false });
    expect((await door(none.app, 'withdraw', { project: P, pr: 1, pinnedAt: 1 })).statusCode).toBe(501);
  });
});
