// D-5523 (#601, the operator's ruling of 2026-10-18): with the claimant's own
// project no longer compared with the run's or the home's, programme ownership
// rests on the claimed-by-another guard, the reviewClaimant gate, attribution
// and the binding gates. These are the security review's exploit probes, kept
// as permanent tests: every attack must stay refused (E1-E6), and E7 pins the
// ruling's one widened door (an unclaimed programme is claimable from any
// project), which D-5523 lists for the operator.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRuns } from './coordReadHelpers.js';

const TOKEN = 'f'.repeat(64);
const headers = { 'x-ccrc-mail-token': TOKEN };
const PARENT = 'project-a-calm-mesa';
const CHILD = 'project-a-quiet-basin';
const FOREIGN = 'project-b-far-ridge';
const B_CHILD = 'project-b-low-fen';
const THIRD = 'project-c-pale-crag';
const WORKER_B = 'project-b-busy-hand';

const seed = (home: string, id: string, project: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'lane-a', project, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const seedFleet = (home: string): void => {
  seed(home, PARENT, 'project-a');
  seed(home, CHILD, 'project-a', { child: '5' });
  seed(home, FOREIGN, 'project-b');
  seed(home, B_CHILD, 'project-b', { child: '7' });
  seed(home, THIRD, 'project-c');
  seed(home, WORKER_B, 'project-b', { child: '9' });
};
const noPrLine = (id: string): string =>
  JSON.stringify({ id, rows: [], baseShort: 'main', branch: `ws/${id}`, ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 });
const runner: Runner = async (_cmd, args) =>
  (args[0] === 'pr-state' ? { code: 0, stdout: [CHILD, B_CHILD, WORKER_B].map(noPrLine).join('\n') + '\n', stderr: '' } : { code: 0, stdout: '', stderr: '' });

const openApp = async (home: string) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, runner);
  const app = await buildServer({ ...base, mailToken: TOKEN, coord });
  return { app, coord };
};
const post = (app: FastifyInstance, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/runs', headers, payload: body });
const att = (id: string) => ({ claimedBy: id, claimedByUuid: `u-${id}` });
const OPEN = { program: 'program-a', title: 'Wave', project: 'project-a', wave: 1, waveOf: 1, homeProject: 'project-a' } as const;

describe('cross-project claimant — exploit probes (D-5523)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('E1 hijack: a correctly attributed session of another project cannot open a work run on a programme another coordinator claims', async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    const w = await openApp(home); app = w.app;
    expect((await post(app, { ...OPEN, ...att(PARENT) })).statusCode).toBe(200);
    for (const who of [FOREIGN, THIRD]) {
      const r = await post(app, { ...OPEN, wave: 2, ...att(who) });
      expect([r.statusCode, r.json()], who).toMatchObject([409, { ok: false, refused: 'claimed-by-another', by: PARENT }]);
    }
    expect(okRuns(w.coord.runs())).toHaveLength(1);
  });

  it('E1b hijack of a cross-project coordinator: a session in the run project cannot take over FOREIGN\'s programme', async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    const w = await openApp(home); app = w.app;
    expect((await post(app, { ...OPEN, ...att(FOREIGN) })).statusCode).toBe(200);
    const r = await post(app, { ...OPEN, wave: 2, ...att(PARENT) });
    expect([r.statusCode, r.json()]).toMatchObject([409, { ok: false, refused: 'claimed-by-another', by: FOREIGN }]);
  });

  it('E2 a foreign session cannot open a review run of a run another coordinator claims', async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    const w = await openApp(home); app = w.app;
    const first = await post(app, { ...OPEN, ...att(PARENT) });
    const id = (first.json() as { id: number }).id;
    for (const to of ['dispatched', 'working', 'awaiting-review'] as const) w.coord.advance(id, to, 'test');
    const r = await post(app, { kind: 'review', reviews: id, program: 'program-a', title: 'R', homeProject: 'project-a', ...att(FOREIGN) });
    expect(r.statusCode).toBe(400);
    expect(okRuns(w.coord.runs())).toHaveLength(1);
  });

  it("E3 a cross-project claimant cannot bind an existing child of ITS OWN project into a run of another project", async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    const w = await openApp(home); app = w.app;
    const r = await post(app, { ...OPEN, ...att(FOREIGN), sessionId: B_CHILD });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ refused: 'project-mismatch' });
    expect(w.coord.parentOfSession(B_CHILD)).toBeNull();
  });

  it('E3b a third-project claimant cannot rebind an existing child of the run project held by another programme', async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    const w = await openApp(home); app = w.app;
    const s0 = await post(app, { ...OPEN, ...att(PARENT), sessionId: CHILD }); expect([s0.statusCode, s0.json()]).toMatchObject([200, { ok: true }]);
    const r = await post(app, { ...OPEN, program: 'program-z', homeProject: 'project-z', ...att(THIRD), sessionId: CHILD });
    expect([r.statusCode, r.json()]).toMatchObject([409, { refused: 'project-mismatch', by: 'project-c' }]);
    expect(w.coord.parentOfSession(CHILD)).toBe(PARENT);
  });

  it('E4 a live worker of another coordinator, in another project, still cannot coordinate a new programme anywhere', async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    const w = await openApp(home); app = w.app;
    // FOREIGN coordinates project-b work, WORKER_B is its worker.
    const op = await post(app, { ...OPEN, program: 'program-b', project: 'project-b', homeProject: 'project-b', ...att(FOREIGN), sessionId: WORKER_B });
    expect([op.statusCode, op.json()]).toMatchObject([200, { ok: true }]);
    const r = await post(app, { ...OPEN, program: 'program-w', homeProject: 'project-c', project: 'project-c', ...att(WORKER_B) });
    expect([r.statusCode, r.json()]).toMatchObject([409, { refused: 'claimant-is-a-worker', by: FOREIGN }]);
  });

  it('E5 a traversal claimedBy with a matching uuid file outside the registry is never admitted', async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    writeFileSync(path.join(home, 'outside.uuid'), 'u-x');
    writeFileSync(path.join(home, 'outside.project'), 'project-a');
    const w = await openApp(home); app = w.app;
    const r = await post(app, { ...OPEN, claimedBy: '../outside', claimedByUuid: 'u-x' });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).not.toBe(409);
    expect(okRuns(w.coord.runs())).toHaveLength(0);
  });

  it('E6 a claimant whose project field is whitespace only is refused (fails closed)', async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    seed(home, 'project-x-blank', '  \n');
    const w = await openApp(home); app = w.app;
    const r = await post(app, { ...OPEN, ...att('project-x-blank') });
    expect([r.statusCode, r.json()]).toMatchObject([409, { refused: 'project-mismatch' }]);
  });

  it('E7 (behaviour probe) a reconstructed programme with no claimed run can be claimed by a session of ANY project', async () => {
    const home = mkTmp('sec-'); seedFleet(home);
    const w = await openApp(home); app = w.app;
    const op = w.coord.openRun({ program: 'program-a', title: 'Wave one', project: 'project-a', wave: 1, waveOf: 1,
      claimedBy: PARENT, kind: 'work', reviews: null, homeProject: 'project-a' });
    if (!('id' in op)) throw new Error('fixture');
    w.coord.db.prepare('UPDATE runs SET claimedBy = NULL').run();
    const r = await post(app, { ...OPEN, wave: 2, ...att(THIRD) });
    expect(r.statusCode).toBe(200);
  });
});
