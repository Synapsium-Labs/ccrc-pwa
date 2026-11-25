// Landing order wave 5f, review 1413 F1: `POST /api/runs/:id/advance` carries the landing line's refusals and failures over
// HTTP exactly as the store answers them (plan Review Focus row 3, §5: "mayApply and the fence survive HTTP for an uncertain
// pin or retreat COMMIT"). The route's branch is `landingAdvanceReject` then `refuseAdvance` (routes.ts, advance.ts): a 503
// whose `reject` keeps `code`, `recovery` and `mayApply` whole. Each class here asserts the status, the code, the recovery,
// whether `mayApply` is present, that the run did not move, and that no success and no notice left. The harness copies
// `landing-ejection-ask.test.ts#scenario`: a landing store over a fixture coord.db, a NotifyLog and a push double.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { NotifyLog } from '../src/notifylog.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { landingStoreOver } from './landingFixture.js';

const TOKEN = 'f'.repeat(64);
const PROJECT = 'demo';
const SID = 'demo-adv1';
const TIP = 'a'.repeat(40);
const COORD = 'ccrc-pwa-coordinator';

const seedRow = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`,
    started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const gitRoot = (tip: string): string => {
  const root = mkTmp('ccrc-advroute-git-');
  const dir = path.join(root, PROJECT, '.git', 'refs', 'heads', 'ws');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, SID), `${tip}\n`);
  return root;
};

const prLine = (): string => JSON.stringify({ id: SID, baseShort: 'main', branch: `ws/${SID}`, ahead: 1, tip: TIP,
  checkedAt: Date.now(),
  rows: [{ number: 7, state: 'OPEN', headRefName: `ws/${SID}`, baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false }] });

/** One COMMIT throws, once; every other statement runs for real (`landing-journal-store.test.ts#failOnce`). */
const failOnce = (db: DatabaseSync, ...words: string[]): void => {
  const real = db.exec.bind(db);
  const left = new Set(words);
  vi.spyOn(db, 'exec').mockImplementation((sql: string) => { if (left.delete(sql)) throw new Error(`fixture ${sql} fault`); return real(sql); });
};

async function scenario() {
  const home = mkTmp('ccrc-advroute-');
  seedRow(home, COORD);
  seedRow(home, SID);
  const run: Runner = async (_c, args) => (args[0] !== 'pr-state'
    ? { ran: true, code: 0, stdout: '', stderr: '' }
    : { ran: true, code: 0, stdout: `${prLine()}\n`, stderr: '' });
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = landingStoreOver(openCoordDb(dbPath), dbPath);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const push = { notify: vi.fn() };
  const base = testDeps(home, run);
  const deps = { ...base, mailToken: TOKEN, coord, cfg: { ...base.cfg, projectsRoot: gitRoot(TIP) },
    fleetState: { ccdVerbs: ['pr-state', 'pr-landing-v1'] } as never, notifyLog, push: push as never };
  const app = await buildServer(deps);
  const opened = coord.openRun({ program: 'landing', title: 't', project: PROJECT, wave: 1, waveOf: 3, claimedBy: COORD });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  const id = opened.id;
  coord.setSession(id, SID);
  expect(coord.advance(id, 'dispatched', 'test').ok).toBe(true);
  expect(coord.advance(id, 'working', 'test').ok).toBe(true);
  const fingerprint = { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP };
  const post = (to: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/api/runs/${id}/advance`, headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { to, fingerprint, ...extra } });
  const state = (): string => (coord.db.prepare('SELECT state FROM runs WHERE id = ?').get(id) as { state: string }).state;
  const events = (): number => (coord.db.prepare('SELECT COUNT(*) AS n FROM run_events WHERE runId = ?').get(id) as { n: number }).n;
  const notices = (): number => notifyLog.catchUp(notifyLog.epoch, 0).events.length;
  const toAwaiting = async () => { expect((await post('awaiting-review')).statusCode).toBe(200); };
  const toMerging = async () => { await toAwaiting(); expect((await post('merging')).statusCode).toBe(200); };
  /** The second-ejection asks (`landing-ejection-ask.test.ts`): a wrongly successful retreat over a row already ejected once raises one. */
  const asks = () => notifyLog.catchUp(notifyLog.epoch, 0).events.filter((x) => x.title.startsWith('Landing: '));
  return { app, coord, id, post, state, events, notices, push, toAwaiting, toMerging, asks };
}

type Fx = Awaited<ReturnType<typeof scenario>>;

/** The answer is the 503 landing refusal with exactly these reject fields, and nothing of a success rides along. */
const expectLandingRefusal = (res: LightMyRequestResponse, reject: Record<string, unknown>): void => {
  expect(res.statusCode, res.body).toBe(503);
  const body = res.json() as Record<string, unknown>;
  expect(body).toEqual({ ok: false, reject });
  expect(body).not.toHaveProperty('run');
  expect(body).not.toHaveProperty('landing');
};

/** The run did not move and no notice (feed row or push) was raised. */
const expectNothingLeft = (f: Fx, before: { state: string; events: number; notices: number }): void => {
  expect(f.state()).toBe(before.state);
  expect(f.events()).toBe(before.events);
  expect(f.notices()).toBe(before.notices);
  expect(f.push.notify).not.toHaveBeenCalled();
};
const measure = (f: Fx) => ({ state: f.state(), events: f.events(), notices: f.notices() });

let app: FastifyInstance | undefined;
afterEach(async () => { vi.restoreAllMocks(); if (app) await app.close(); app = undefined; });

describe('POST /api/runs/:id/advance carries the landing refusals over HTTP (review 1413 F1)', () => {
  it('a fenced line: 503 landing-fenced with its recovery word and no mayApply, the run stays at merging', async () => {
    const f = await scenario(); app = f.app;
    await f.toMerging();
    // the fence is raised through another door (an uncertain authority COMMIT); it holds every landing entrance
    failOnce(f.coord.db, 'COMMIT');
    expect(f.coord.writeLandingAuthority({ kind: 'entry', project: PROJECT, pr: 99, pinnedSha: 'c'.repeat(40),
      handoffCommit: 'd'.repeat(40), setBy: COORD }, Date.now()))
      .toEqual({ ok: false, error: 'landing-db-commit', recovery: 'replay', mayApply: true });
    vi.restoreAllMocks();
    const before = measure(f);
    expectLandingRefusal(await f.post('working'), { code: 'landing-fenced', recovery: 'replay' });
    expectNothingLeft(f, before);
    expect(before.state).toBe('merging');
  });

  it('an uncertain pin COMMIT: 503 landing-db-commit with mayApply and recovery, the run stays at awaiting-review', async () => {
    const f = await scenario(); app = f.app;
    await f.toAwaiting();
    const before = measure(f);
    failOnce(f.coord.db, 'COMMIT');
    expectLandingRefusal(await f.post('merging'), { code: 'landing-db-commit', recovery: 'replay', mayApply: true });
    vi.restoreAllMocks();
    expectNothingLeft(f, before);
    expect(before.state).toBe('awaiting-review');
    // the fence it raised answers the retry on the same route
    expectLandingRefusal(await f.post('merging'), { code: 'landing-fenced', recovery: 'replay' });
  });

  it('an uncertain retreat COMMIT: 503 landing-db-commit with mayApply and recovery, the run stays at merging', async () => {
    const f = await scenario(); app = f.app;
    await f.toMerging();
    const before = measure(f);
    failOnce(f.coord.db, 'COMMIT');
    expectLandingRefusal(await f.post('working'), { code: 'landing-db-commit', recovery: 'replay', mayApply: true });
    vi.restoreAllMocks();
    expectNothingLeft(f, before);
    expect(before.state).toBe('merging');
  });

  it.each([['bare', {}], ['named', { ejection: { base: 'b'.repeat(40), kind: 'new-head' } }]] as const)(
    'a %s stale-head retreat over an unreadable projection: 503 landing-projection-unreadable, recovery repair, no mayApply, the run stays at merging',
    async (_n, extra) => {
      const f = await scenario(); app = f.app;
      await f.toMerging();
      // the pin names another head than the episode's, and a retained field no longer reads; one ejection already counted,
      // so a retreat that wrongly went through would raise the second-ejection ask
      f.coord.db.prepare("UPDATE landing_entries SET pinnedSha = ?, handoffCommit = 'not-a-hash', ejections = 1 WHERE pr = 7").run('c'.repeat(40));
      const before = measure(f);
      expectLandingRefusal(await f.post('working', extra), { code: 'landing-projection-unreadable', recovery: 'repair' });
      expectNothingLeft(f, before);
      expect(f.asks()).toHaveLength(0);
      expect(before.state).toBe('merging');
    });
});

describe('an equal-head retreat over a row that does not read is refused before the run moves (wave 5i, M16)', () => {
  const damage = {
    handoffCommit: "UPDATE landing_entries SET handoffCommit = 'not-a-hash', ejections = 1 WHERE pr = 7",
    setBy: "UPDATE landing_entries SET setBy = '', ejections = 1 WHERE pr = 7",
  } as const;
  const rawRow = (f: Fx): unknown => f.coord.db.prepare('SELECT * FROM landing_entries WHERE pr = 7').get();
  it.each([
    ['bare', 'handoffCommit', {}], ['named', 'handoffCommit', { ejection: { base: 'b'.repeat(40), kind: 'new-head' } }],
    ['bare', 'setBy', {}], ['named', 'setBy', { ejection: { base: 'b'.repeat(40), kind: 'new-head' } }],
  ] as const)('a %s retreat, the pin at the episode head, a corrupt %s: 503 landing-projection-unreadable, recovery repair; nothing moves, no ask',
    async (_n, field, extra) => {
      const f = await scenario(); app = f.app;
      await f.toMerging();
      f.coord.db.prepare(damage[field]).run();
      const before = measure(f);
      const row = rawRow(f);
      expectLandingRefusal(await f.post('working', extra), { code: 'landing-projection-unreadable', recovery: 'repair' });
      expectNothingLeft(f, before);
      expect(f.asks()).toHaveLength(0);
      expect(rawRow(f)).toEqual(row);
      expect(before.state).toBe('merging');
    });

  it.each([['bare', {}], ['named', { ejection: { base: 'b'.repeat(40), kind: 'new-head' } }]] as const)(
    'positive control: a readable %s equal-head retreat over a row ejected once really is the second ejection and raises its ask',
    async (_n, extra) => {
      const f = await scenario(); app = f.app;
      await f.toMerging();
      f.coord.db.prepare('UPDATE landing_entries SET ejections = 1 WHERE pr = 7').run();
      expect((await f.post('working', extra)).statusCode).toBe(200);
      expect(f.state()).toBe('working');
      expect(f.asks()).toHaveLength(1);
      expect(f.asks()[0]).toMatchObject({ title: 'Landing: demo #7 ejected twice' });
    });
});

describe('a retreat past an owned row stored pinned that does not read is refused whatever it displays (fix round 2, R1)', () => {
  // Each damages a field the display fold reads, so the row DISPLAYS `unknown` while its stored word is still `pinned`.
  const display = {
    afterIds: "afterIds = 'not-json'", fixesMain: 'fixesMain = 7', ejectionKind: "ejectionKind = 'bogus'",
    pinnedAt: "pinnedAt = 'x'", ejections: "ejections = 'x'",
  } as const;
  const bare = {}, named = { ejection: { base: 'b'.repeat(40), kind: 'new-head' } };
  const rawAll = (f: Fx) => ({
    entry: f.coord.db.prepare('SELECT * FROM landing_entries WHERE pr = 7').get(),
    run: f.coord.db.prepare('SELECT * FROM runs WHERE id = ?').get(f.id),
    witness: f.coord.db.prepare('SELECT * FROM landing_projection_witness').all(),
    mail: f.coord.db.prepare('SELECT COUNT(*) AS n FROM mail').get(),
  });
  const cases = (Object.keys(display) as (keyof typeof display)[]).flatMap((field) =>
    [['equal', bare], ['equal', named], ['stale', bare], ['stale', named]].map(([head, extra]) => [field, head, extra === bare ? 'bare' : 'named', extra] as const));
  it.each(cases)('a stored-pinned owned row with a damaged %s, %s head, %s retreat: 503 landing-projection-unreadable, recovery repair; nothing moves',
    async (field, head, _kind, extra) => {
      const f = await scenario(); app = f.app;
      await f.toMerging();
      const set = head === 'stale' ? `pinnedSha = '${'c'.repeat(40)}', ` : '';
      const seed = field === 'ejections' ? '' : 'ejections = 1, ';
      f.coord.db.exec(`UPDATE landing_entries SET ${set}${seed}${display[field]} WHERE pr = 7`);
      const stored = (f.coord.db.prepare('SELECT state FROM landing_entries WHERE pr = 7').get() as { state: string }).state;
      expect(stored).toBe('pinned');
      const before = measure(f);
      const raw = rawAll(f);
      expectLandingRefusal(await f.post('working', extra), { code: 'landing-projection-unreadable', recovery: 'repair' });
      expectNothingLeft(f, before);
      expect(rawAll(f)).toEqual(raw);
      expect(f.asks()).toHaveLength(0);
      expect(before.state).toBe('merging');
    });

  it.each([['bare', bare], ['named', named]] as const)('control: a readable owned pinned %s retreat at the equal head still ejects, and counts', async (_n, extra) => {
    const f = await scenario(); app = f.app;
    await f.toMerging();
    expect((await f.post('working', extra)).statusCode).toBe(200);
    expect(f.state()).toBe('working');
    expect(f.coord.db.prepare('SELECT state, ejections FROM landing_entries WHERE pr = 7').get()).toMatchObject({ state: 'ejected', ejections: 1 });
  });
  it('control: a readable owned pinned retreat at a stale head still quarantines', async () => {
    const f = await scenario(); app = f.app;
    await f.toMerging();
    f.coord.db.exec(`UPDATE landing_entries SET pinnedSha = '${'c'.repeat(40)}' WHERE pr = 7`);
    expect((await f.post('working')).statusCode).toBe(200);
    expect(f.coord.db.prepare('SELECT state, ejections FROM landing_entries WHERE pr = 7').get()).toMatchObject({ state: 'unknown', ejections: 0 });
  });
  it('control: an owned row stored landed with a damaged field is kept as today (the retreat goes through, nothing is ejected)', async () => {
    const f = await scenario(); app = f.app;
    await f.toMerging();
    f.coord.db.exec("UPDATE landing_entries SET state = 'landed', ejections = 1, afterIds = 'not-json' WHERE pr = 7");
    expect((await f.post('working')).statusCode).toBe(200);
    expect(f.state()).toBe('working');
    expect(f.coord.db.prepare('SELECT state, ejections FROM landing_entries WHERE pr = 7').get()).toMatchObject({ state: 'landed', ejections: 1 });
    expect(f.asks()).toHaveLength(0);
  });
});
