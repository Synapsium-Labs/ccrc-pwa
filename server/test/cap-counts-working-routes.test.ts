// D-8792 (waiting workers spec 2026-11-19 Part 3) through the routes: the caps view's two additive fields, and the
// send-back door (`POST /api/runs/:id/advance`, an idle run back to `working`), in shadow and armed. The rules themselves
// are pinned in `caps-counts-working.test.ts`; this file holds that the routes wire them: one port pair (`capPorts`)
// for both doors and the view, the real `workerFactsFor` over a fixture registry, and the `cap-counts-working` row as
// the only switch.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { CAP_COUNTS_WORKING_LANE } from '../../shared/lane-arm.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const PROJECT = 'demo';
const SLEEPER = 'demo-sleeper';

const apps: FastifyInstance[] = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

async function rig(armed: boolean) {
  const home = mkTmp('ccrc-cap-routes-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  if (armed) coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'live', 1);
  // tmux proves the sleeper's pane gone, as it is for a hibernated session (review 2875 F5: a stamp alone is not proof);
  // every other ask is unanswered, so nothing else reads gone.
  const runner: Runner = async (cmd, args) => (cmd === 'tmux' && args[0] === 'has-session' && args.some((a) => a.includes(SLEEPER))
    ? { ran: true, code: 1, stdout: '', stderr: `can't find session: ${SLEEPER}` }
    : { ran: true, code: 1, stdout: '', stderr: '' });
  const app = await buildServer({ ...testDeps(home, runner), mailToken: TOKEN, coord });
  apps.push(app);
  /** A registry row for `id`, asleep (`ccd hibernate`'s marker) when `asleep`. */
  const seed = (id: string, asleep: boolean): void => {
    const fields: Record<string, string> = {
      wrapper: 'claude-a', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
      workspace: id, branch: `ws/${id}`, base: 'origin/main', ...(asleep ? { hibernated: '1700000000' } : {}),
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };
  /** A dispatched run of `session`, moved to `state` (null session: a row with no worker, which always counts). */
  const run = (program: string, session: string | null, state: 'dispatched' | 'awaiting-review'): number => {
    const o = coord.openRun({ program, title: program, project: PROJECT, wave: 1, waveOf: 1, claimedBy: `c-${program}` }) as { id: number };
    coord.markDispatched(o.id, session ?? 'demo-x', `${program}-ws`, `ws/${program}`, false);
    expect(coord.advance(o.id, 'dispatched', 'test').ok).toBe(true);
    if (state === 'awaiting-review') {
      expect(coord.advance(o.id, 'working', 'test').ok).toBe(true);
      expect(coord.advance(o.id, 'awaiting-review', 'test').ok).toBe(true);
    }
    if (session === null) coord.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(o.id);
    return o.id;
  };
  const caps = async () => (await app.inject({ method: 'GET', url: '/api/coord/caps' })).json() as { usage: Record<string, unknown> };
  const sendBack = (id: number) => app.inject({ method: 'POST', url: `/api/runs/${id}/advance`,
    headers: { 'x-ccrc-mail-token': TOKEN },
    payload: { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } } });
  return { app, coord, seed, run, caps, sendBack };
}

describe('GET /api/coord/caps reports the waiting runs through the cap reader (D-8792)', () => {
  it('shadow: a run whose worker sleeps is reported waiting, still counted, and the cap is not working-only', async () => {
    const r = await rig(false);
    r.seed(SLEEPER, true);
    r.run('a', SLEEPER, 'dispatched');
    expect((await r.caps()).usage).toEqual({ running: 1, waiting: 1, workingOnly: false });
  });

  it('armed: the same run is reported waiting and the cap says it counts working runs only', async () => {
    const r = await rig(true);
    r.seed(SLEEPER, true);
    r.run('a', SLEEPER, 'dispatched');
    expect((await r.caps()).usage).toEqual({ running: 1, waiting: 1, workingOnly: true });
  });

  it('a run with no worker, and a worker that cannot be read, are never reported waiting', async () => {
    const r = await rig(true);
    r.seed('demo-unread', false);   // listed, but no pane or live file this box can read: unmeasured
    r.run('a', null, 'dispatched');
    r.run('b', 'demo-unread', 'dispatched');
    expect((await r.caps()).usage).toEqual({ running: 2, waiting: 0, workingOnly: true });
  });

  it('review 2875 F1: the POST answers the measured view too, its readings taken after the lock', async () => {
    const r = await rig(false);
    r.seed(SLEEPER, true);
    r.run('a', SLEEPER, 'dispatched');
    const res = await r.app.inject({ method: 'POST', url: '/api/coord/caps', payload: { maxConcurrentWorkers: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, caps: { maxConcurrentWorkers: 3 }, usage: { running: 1, waiting: 1, workingOnly: false } });
  });
});

describe('POST /api/runs/:id/advance: a send-back to a sleeping worker at a full cap (D-8792)', () => {
  it('shadow: refused at the cap as today, and the run does not move', async () => {
    const r = await rig(false);
    r.coord.setCaps({ maxConcurrentWorkers: 1 });
    r.seed(SLEEPER, true);
    const id = r.run('mine', SLEEPER, 'awaiting-review');
    r.run('blocker', null, 'dispatched');
    const res = await r.sendBack(id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, reject: { code: 'cap-concurrency', limit: 1, running: 1 } });
    expect(r.coord.run(id)).toMatchObject({ ok: true, run: { state: 'awaiting-review' } });
  });

  it('armed: admitted at a full cap with no slot freed, and the run is working again', async () => {
    const r = await rig(true);
    r.coord.setCaps({ maxConcurrentWorkers: 1 });
    r.seed(SLEEPER, true);
    const id = r.run('mine', SLEEPER, 'awaiting-review');
    r.run('blocker', null, 'dispatched');
    const res = await r.sendBack(id);
    expect(res.statusCode).toBe(200);
    expect(r.coord.run(id)).toMatchObject({ ok: true, run: { state: 'working' } });
  });

  it('armed: a send-back to a worker with no registry row is still charged at a full cap', async () => {
    const r = await rig(true);
    r.coord.setCaps({ maxConcurrentWorkers: 1 });
    const id = r.run('mine', 'demo-not-listed', 'awaiting-review');
    r.run('blocker', null, 'dispatched');
    const res = await r.sendBack(id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, reject: { code: 'cap-concurrency', limit: 1, running: 1 } });
  });
});
