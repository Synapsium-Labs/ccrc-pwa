// PR landing in ccrc, stage 1, Task PL-5: the advance to `merging` records the episode in its transition row and, for
// a `live` episode, answers the `checksMail` token. Everything else about the advance route is pinned by
// `run-routes.test.ts` and `run-states.test.ts`; the characterization cases here pin only what this task must not move.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { CHECKS_MAIL_TOKEN, readMergingAtDetail } from '../../shared/landing.js';

const TOKEN = 'f'.repeat(64);
const PROJECT = 'demo';
const SID = 'demo-ep1';
const TIP = 'a'.repeat(40);
const OTHER_TIP = 'b'.repeat(40);
const COORD = 'ccrc-pwa-coordinator';

const seedRow = (home: string, id: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`,
    started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const gitRoot = (tip: string): string => {
  const root = mkTmp('ccrc-ep-git-');
  const dir = path.join(root, PROJECT, '.git', 'refs', 'heads', 'ws');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, SID), `${tip}\n`);
  return root;
};

interface Pr { number: number | null; state?: 'OPEN' | 'CLOSED'; isDraft?: boolean }
const prLine = (pr: Pr, tip: string): string => JSON.stringify({ id: SID, baseShort: 'main', branch: `ws/${SID}`, ahead: 1, tip,
  checkedAt: Date.now(),
  rows: pr.number === null ? [] : [{ number: pr.number, state: pr.state ?? 'OPEN', headRefName: `ws/${SID}`, baseRefName: 'main',
    isCrossRepository: false, ours: true, isDraft: pr.isDraft ?? false }] });

interface Opts { markers?: string[]; verbs?: string[] | null; pr?: Pr; unlistable?: boolean }

async function scenario(o: Opts = {}) {
  const home = mkTmp('ccrc-ep-');
  const pr = o.pr ?? { number: 7 };
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  seedRow(home, COORD);
  seedRow(home, SID);
  for (const m of o.markers ?? []) writeFileSync(path.join(reg, m), '');
  // `unlistable`: the registry lists fine for `verifyDone`'s own reads and fails from its `pr-state` call on, so the
  // advance is admitted and only the mode's own listing is lost.
  let lost = false;
  const run: Runner = async (_c, args) => {
    if (args[0] !== 'pr-state') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (o.unlistable) lost = true;
    return { ran: true, code: 0, stdout: `${prLine(pr, TIP)}\n`, stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const verbs = o.verbs === undefined ? ['pr-state', 'pr-landing-v1'] : o.verbs;
  const deps = { ...base, mailToken: TOKEN, coord, cfg: { ...base.cfg, projectsRoot: gitRoot(TIP) },
    fleetState: (verbs === null ? undefined : { ccdVerbs: verbs }) as never };
  if (o.unlistable) deps.io = { ...base.io, readdir: async (d: string) => (lost && d === base.cfg.registryDir ? null : base.io.readdir(d)) } as never;
  const app = await buildServer(deps);
  const opened = coord.openRun({ program: 'landing', title: 't', project: PROJECT, wave: 1, waveOf: 3, claimedBy: COORD });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, SID);
  expect(coord.advance(opened.id, 'dispatched', 'test').ok).toBe(true);
  expect(coord.advance(opened.id, 'working', 'test').ok).toBe(true);
  const post = (to: string, tip = TIP, prNumber: number | null = pr.number, prPhase = pr.isDraft ? 'draft' : prNumber === null ? 'none' : 'open') =>
    app.inject({ method: 'POST', url: `/api/runs/${opened.id}/advance`, headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { to, fingerprint: { branchTip: tip, prNumber, prPhase, handoffCommit: tip } } });
  const toMerging = async () => { expect((await post('awaiting-review')).statusCode).toBe(200); return post('merging'); };
  const details = () => (coord.db.prepare('SELECT id, fromState, toState, causedBy, detail FROM run_events WHERE runId = ? ORDER BY id').all(opened.id) as
    { id: number; fromState: string; toState: string; causedBy: string; detail: string | null }[]).map((r) => ({ id: r.id, to: r.toState, from: r.fromState, by: r.causedBy, detail: r.detail }));
  return { app, coord, id: opened.id, post, toMerging, details };
}

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

const LIVE = ['landing-checks-live'];
const mergingRows = (d: ReturnType<Awaited<ReturnType<typeof scenario>>['details']>) =>
  d.filter((r) => r.to === 'merging' && r.from !== 'merging');

describe('the advance records the episode', () => {
  it('an advance to merging writes merging-at:<head>:<pr>:<mode> in its transition row, with the verified handoffCommit and the measured number', async () => {
    const s = await scenario({ markers: LIVE }); app = s.app;
    expect((await s.toMerging()).statusCode).toBe(200);
    const rows = mergingRows(s.details());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toBe(`merging-at:${TIP}:7:live`);
    expect(readMergingAtDetail(rows[0]!.detail!)).toEqual({ head: TIP, pr: 7, mode: 'live' });
  });

  it('the transition row\'s id is currentEpisode(run).e, and causedBy is still coordinator', async () => {
    const s = await scenario({ markers: LIVE }); app = s.app;
    await s.toMerging();
    const row = mergingRows(s.details())[0]!;
    expect(s.coord.currentEpisode(s.id)!.e).toBe(row.id);
    expect(row.by).toBe('coordinator');
  });

  it('a refused verifyDone writes no transition and no episode', async () => {
    const s = await scenario({ markers: LIVE }); app = s.app;
    expect((await s.post('awaiting-review')).statusCode).toBe(200);
    const res = await s.post('merging', OTHER_TIP);
    expect(res.statusCode).toBe(409);
    expect(mergingRows(s.details())).toEqual([]);
    expect(s.coord.currentEpisode(s.id)).toBeNull();
  });

  it('an advance to awaiting-review or working writes no merging-at detail', async () => {
    const s = await scenario({ markers: LIVE }); app = s.app;
    expect((await s.post('awaiting-review')).statusCode).toBe(200);
    expect((await s.post('working')).statusCode).toBe(200);
    expect(s.details().some((r) => r.detail?.startsWith('merging-at:'))).toBe(false);
  });

  it('merging -> working -> awaiting-review -> merging at the same head gives two episodes with different ids', async () => {
    const s = await scenario({ markers: LIVE }); app = s.app;
    await s.toMerging();
    const e1 = s.coord.currentEpisode(s.id)!.e;
    expect((await s.post('working')).statusCode).toBe(200);
    expect((await s.toMerging()).statusCode).toBe(200);
    const e2 = s.coord.currentEpisode(s.id)!.e;
    expect(e2).toBeGreaterThan(e1);
    expect(mergingRows(s.details()).map((r) => r.detail)).toEqual([`merging-at:${TIP}:7:live`, `merging-at:${TIP}:7:live`]);
  });

  it('merging -> merging and working -> merging are refused bad-transition and write no episode', async () => {
    const s = await scenario({ markers: LIVE }); app = s.app;
    const fromWorking = await s.post('merging');
    expect(fromWorking.statusCode).toBe(409);
    expect(fromWorking.json()).toMatchObject({ ok: false, reject: { code: 'bad-transition' } });
    expect(mergingRows(s.details())).toEqual([]);
    await s.toMerging();
    const again = await s.post('merging');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ ok: false, reject: { code: 'bad-transition' } });
    expect(mergingRows(s.details())).toHaveLength(1);
  });
});

describe('the mode and the token', () => {
  it('live marker, capability and a bound open PR: the answer carries checksMail', async () => {
    const s = await scenario({ markers: LIVE }); app = s.app;
    const res = await s.toMerging();
    expect(res.json()).toMatchObject({ ok: true, run: { state: 'merging' }, checksMail: CHECKS_MAIL_TOKEN });
    expect(CHECKS_MAIL_TOKEN).toBe('checks-mail-v1');
  });

  it('no live marker: the episode is shadow and the answer has no checksMail', async () => {
    const s = await scenario(); app = s.app;
    const res = await s.toMerging();
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('checksMail');
    expect(mergingRows(s.details())[0]!.detail).toBe(`merging-at:${TIP}:7:shadow`);
  });

  it('landing-disabled: the episode is off and the answer has no checksMail', async () => {
    const s = await scenario({ markers: [...LIVE, 'landing-disabled'] }); app = s.app;
    const res = await s.toMerging();
    expect(res.json()).not.toHaveProperty('checksMail');
    expect(mergingRows(s.details())[0]!.detail).toBe(`merging-at:${TIP}:7:off`);
  });

  it('an unlistable registry: the episode is off and the answer has no checksMail', async () => {
    const s = await scenario({ markers: LIVE, unlistable: true }); app = s.app;
    s.coord.advance(s.id, 'awaiting-review', 'test');
    const res = await s.post('merging');
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('checksMail');
    expect(mergingRows(s.details())[0]!.detail).toBe(`merging-at:${TIP}:7:off`);
  });

  it('a ccd without pr-landing-v1 is off', async () => {
    const s = await scenario({ markers: LIVE, verbs: ['pr-state'] }); app = s.app;
    const res = await s.toMerging();
    expect(res.json()).not.toHaveProperty('checksMail');
    expect(mergingRows(s.details())[0]!.detail).toBe(`merging-at:${TIP}:7:off`);
  });

  it('an advance with no bound PR is off, even with the live marker', async () => {
    const s = await scenario({ markers: LIVE, pr: { number: null } }); app = s.app;
    const res = await s.toMerging();
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('checksMail');
    expect(mergingRows(s.details())[0]!.detail).toBe(`merging-at:${TIP}:none:off`);
  });

  it('an advance measuring draft is off', async () => {
    const s = await scenario({ markers: LIVE, pr: { number: 7, isDraft: true } }); app = s.app;
    const res = await s.toMerging();
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('checksMail');
    expect(mergingRows(s.details())[0]!.detail).toBe(`merging-at:${TIP}:7:off`);
  });

  it('the mode reads the measured PR, not the claim: a stale claim of no PR against a measured open #7 still records 7:live and carries checksMail', async () => {
    const s = await scenario({ markers: LIVE }); app = s.app;
    expect((await s.post('awaiting-review', TIP, null, 'none')).statusCode).toBe(200);
    const res = await s.post('merging', TIP, null, 'none');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ checksMail: CHECKS_MAIL_TOKEN });
    expect(mergingRows(s.details())[0]!.detail).toBe(`merging-at:${TIP}:7:live`);
  });

  it('the mode reads the measured PR, not the claim: a claim of open against a measured draft #7 records 7:off and carries no checksMail', async () => {
    const s = await scenario({ markers: LIVE, pr: { number: 7, isDraft: true } }); app = s.app;
    expect((await s.post('awaiting-review', TIP, 7, 'open')).statusCode).toBe(200);
    const res = await s.post('merging', TIP, 7, 'open');
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('checksMail');
    expect(mergingRows(s.details())[0]!.detail).toBe(`merging-at:${TIP}:7:off`);
  });
});

describe('handoffCommit keeps its one writer', () => {
  it('the advance never writes runs.handoffCommit: the only UPDATE of the column is the close\'s, in store.ts', () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
    const writers = files(src).filter((f) => /UPDATE\s+runs\s+SET[^`'"]*handoffCommit\s*=/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f));
    expect(writers).toEqual(['coord/store.ts']);
  });
});
