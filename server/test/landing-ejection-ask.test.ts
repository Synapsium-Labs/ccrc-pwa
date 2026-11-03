// Landing order wave 5e, Task 2: the second ejection of a landing-line entry raises ONE operator notice through the
// notice funnel (D-7624). The advance is never refused, no mail goes to the coordinator (clause 19), and a third
// ejection raises nothing more. The harness copies `merging-episode.test.ts#scenario`, adds a `NotifyLog` as
// `run-routes.test.ts`'s `capApp` does, and a push double.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const PROJECT = 'demo';
const SID = 'demo-ep1';
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
  const root = mkTmp('ccrc-ejask-git-');
  const dir = path.join(root, PROJECT, '.git', 'refs', 'heads', 'ws');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, SID), `${tip}\n`);
  return root;
};

const prLine = (): string => JSON.stringify({ id: SID, baseShort: 'main', branch: `ws/${SID}`, ahead: 1, tip: TIP,
  checkedAt: Date.now(),
  rows: [{ number: 7, state: 'OPEN', headRefName: `ws/${SID}`, baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false }] });

async function scenario(o: { visible?: boolean } = {}) {
  const home = mkTmp('ccrc-ejask-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  seedRow(home, COORD);
  seedRow(home, SID);
  const run: Runner = async (_c, args) => (args[0] !== 'pr-state'
    ? { ran: true, code: 0, stdout: '', stderr: '' }
    : { ran: true, code: 0, stdout: `${prLine()}\n`, stderr: '' });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const push = { notify: vi.fn() };
  const base = testDeps(home, run);
  const deps = { ...base, mailToken: TOKEN, coord, cfg: { ...base.cfg, projectsRoot: gitRoot(TIP) },
    fleetState: { ccdVerbs: ['pr-state', 'pr-landing-v1'] } as never, notifyLog, push: push as never,
    ...(o.visible ? { viewers: { isVisible: () => true } as never } : {}) };
  const app = await buildServer(deps);
  const opened = coord.openRun({ program: 'landing', title: 't', project: PROJECT, wave: 1, waveOf: 3, claimedBy: COORD });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, SID);
  expect(coord.advance(opened.id, 'dispatched', 'test').ok).toBe(true);
  expect(coord.advance(opened.id, 'working', 'test').ok).toBe(true);
  const fingerprint = { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP };
  const post = (to: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/api/runs/${opened.id}/advance`, headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { to, fingerprint, ...extra } });
  const toMerging = async () => { expect((await post('awaiting-review')).statusCode).toBe(200); return post('merging'); };
  const eject = () => post('working', { ejection: { base: 'b'.repeat(40), kind: 'new-head' } });
  const asks = () => notifyLog.catchUp(notifyLog.epoch, 0).events.filter((x) => x.title.startsWith('Landing: '));
  return { app, coord, id: opened.id, post, toMerging, eject, asks, push };
}

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

describe('the second ejection raises one operator notice (D-7624)', () => {
  it('the first ejection raises nothing, the second raises one notice through the funnel, the third raises nothing more', async () => {
    const { app: a, id, toMerging, eject, asks, push } = await scenario(); app = a;
    expect((await toMerging()).statusCode).toBe(200); expect((await eject()).statusCode).toBe(200);
    expect(asks()).toHaveLength(0);
    expect((await toMerging()).statusCode).toBe(200); expect((await eject()).statusCode).toBe(200);
    expect(asks()).toHaveLength(1);
    expect(asks()[0]).toMatchObject({ kind: 'run', sessionId: 'demo-ep1', runId: id, title: 'Landing: demo #7 ejected twice' });
    expect(push.notify).toHaveBeenCalledTimes(1);
    expect(push.notify.mock.calls[0]![0]).toMatchObject({ tag: 'landing-ejected-demo-7', sessionId: 'demo-ep1' });
    expect((await toMerging()).statusCode).toBe(200); expect((await eject()).statusCode).toBe(200);
    expect(asks()).toHaveLength(1); expect(push.notify).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: the notice sends no mail: the coordinator opens no dialog (clause 19)', async () => {
    const { app: a, coord, toMerging, eject } = await scenario(); app = a;
    const n = () => (coord.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n;
    expect((await toMerging()).statusCode).toBe(200);
    const before = n();
    expect((await eject()).statusCode).toBe(200);
    expect(n()).toBe(before);                       // the first ejecting advance: 0 new rows
    expect((await toMerging()).statusCode).toBe(200);
    const beforeSecond = n();
    expect((await eject()).statusCode).toBe(200);
    expect(n()).toBe(beforeSecond);                 // the second ejecting advance, which raises the notice: 0 new rows
    expect(coord.db.prepare("SELECT COUNT(*) AS n FROM mail WHERE subject LIKE '%ejected twice%' OR body LIKE '%ejected twice%'").get())
      .toEqual({ n: 0 });
  });

  it('a refused ejecting advance raises nothing', async () => {
    const { app: a, post, asks } = await scenario(); app = a;
    expect((await post('awaiting-review')).statusCode).toBe(200);
    const res = await post('working', { ejection: { base: 'b'.repeat(40), kind: 'new-head' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().reject.code).toBe('ejection-not-merging');
    expect(asks()).toHaveLength(0);
  });

  it('the notice is recorded even while the operator watches the worker\'s session (record-always)', async () => {
    const { app: a, toMerging, eject, asks, push } = await scenario({ visible: true }); app = a;
    expect((await toMerging()).statusCode).toBe(200); expect((await eject()).statusCode).toBe(200);
    expect((await toMerging()).statusCode).toBe(200); expect((await eject()).statusCode).toBe(200);
    expect(asks()).toHaveLength(1);
    expect(push.notify).not.toHaveBeenCalled();
  });
});
