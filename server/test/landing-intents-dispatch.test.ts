// Landing order wave 5g (Task 2, D-8083 to D-8086): a dispatch names its landing intents, and another programme's
// hold on one refuses it. Through the route, with the fixture `ccd` recording its calls; each case on a fresh fixture.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { DISPATCH_SPAWN_POLL_MS } from '../src/coord/routes.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const TOKEN = 'f'.repeat(64);
const LIVE_PANE = 4242;

function seed(home: string, id: string, project: string): void {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', child: '999',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
}

/** One fixture: a runner that answers each `ws-add` with the next fresh registry row, and records every call. */
async function fixture() {
  const home = mkTmp('ccrc-intents-dispatch-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'sessions', `${LIVE_PANE}.json`),
    JSON.stringify({ pid: LIVE_PANE, sessionId: 'u-live', status: 'idle', statusUpdatedAt: 1 }));
  const calls: string[][] = [];
  let spawned = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'ws-add') {
      const project = args.find((a) => /^project-[ab]$/.test(a)) ?? 'project-a';
      seed(home, `${project}-fresh${++spawned}`, project);
    }
    if (args[0] === 'ensure') return { ran: true as const, code: 0, stdout: `alive: ${args[1] ?? ''}\n`, stderr: '' };
    return { ran: true as const, code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  // Review 1660 A2: every listing of the registry directory is recorded, so a case can say a refusal made none.
  const listings: string[] = [];
  const io = {
    ...base.io,
    readdir: (dir: string) => { if (dir === base.cfg.registryDir) listings.push(dir); return base.io.readdir(dir); },
    readdirMeasured: (dir: string) => { if (dir === base.cfg.registryDir) listings.push(dir); return base.io.readdirMeasured(dir); },
  };
  const app = await buildServer({ ...base, io, mailToken: TOKEN, coord });
  const open = (program: string, wave: number, project = 'project-a'): number => {
    const o = coord.openRun({ program, title: 't', project, wave, waveOf: null, claimedBy: `coord-${program}` });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    return o.id;
  };
  const post = (id: number, body: unknown) => app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`,
    headers: { 'x-ccrc-mail-token': TOKEN }, payload: body as Record<string, unknown> });
  const state = (id: number): string => (coord.db.prepare('SELECT state FROM runs WHERE id = ?').get(id) as { state: string }).state;
  const rowCount = (id: number): number =>
    (coord.db.prepare('SELECT COUNT(*) AS n FROM landing_intents WHERE runId = ?').get(id) as { n: number }).n;
  return { app, coord, calls, listings, open, post, state, rowCount };
}

let live: FastifyInstance | undefined;
afterEach(async () => { if (live) await live.close(); live = undefined; });
const make = async () => { const f = await fixture(); live = f.app; return f; };

describe('a dispatch names its landing intents', () => {
  it('programme A dispatches with keys: 200 echoes them, one row each; naming none answers []', async () => {
    const f = await make();
    const a = f.open('prog-a', 1);
    const res = await f.post(a, { brief: 'go', intents: ['#123'] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, intents: ['#123'] });
    expect(f.rowCount(a)).toBe(1);
    const none = f.open('prog-a', 2);
    const res2 = await f.post(none, { brief: 'go' });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toMatchObject({ ok: true, intents: [] });
    expect(f.rowCount(none)).toBe(0);
  });

  it("programme B's dispatch of a key A holds is refused 409 with the key and the holder, before any ccd call", async () => {
    const f = await make();
    const a = f.open('prog-a', 1);
    expect((await f.post(a, { brief: 'go', intents: ['#123'] })).statusCode).toBe(200);
    const b = f.open('prog-b', 1);
    const before = f.calls.length;
    const res = await f.post(b, { brief: 'go', intents: ['#123', 'D-9'] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'intent-held', key: '#123', holder: { runId: a, program: 'prog-a' } });
    expect(f.calls).toHaveLength(before);
    expect(f.state(b)).toBe('planned');
    expect(f.rowCount(b)).toBe(0);
  });

  it("A's run closed done frees the key for B", async () => {
    const f = await make();
    const a = f.open('prog-a', 1);
    expect((await f.post(a, { brief: 'go', intents: ['#123'] })).statusCode).toBe(200);
    for (const to of ['closing', 'done'] as const) expect(f.coord.advance(a, to, 'test').ok).toBe(true);
    const b = f.open('prog-b', 1);
    const res = await f.post(b, { brief: 'go', intents: ['#123'] });
    expect(res.statusCode).toBe(200);
  });

  it("the same programme's wave 2 may name the key wave 1 holds at merging", async () => {
    const f = await make();
    const a1 = f.open('prog-a', 1);
    expect((await f.post(a1, { brief: 'go', intents: ['#123'] })).statusCode).toBe(200);
    f.coord.db.prepare("UPDATE runs SET state = 'merging' WHERE id = ?").run(a1);
    const a2 = f.open('prog-a', 2);
    const res = await f.post(a2, { brief: 'go', intents: ['#123'] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ intents: ['#123'] });
  });

  it('a run in another project may name the same key', async () => {
    const f = await make();
    const a = f.open('prog-a', 1);
    expect((await f.post(a, { brief: 'go', intents: ['#123'] })).statusCode).toBe(200);
    const b = f.open('prog-b', 1, 'project-b');
    expect((await f.post(b, { brief: 'go', intents: ['#123'] })).statusCode).toBe(200);
  });

  it('an intents body that is not an array answers 400 bad-request with an intents: detail', async () => {
    const f = await make();
    const a = f.open('prog-a', 1);
    const res = await f.post(a, { brief: 'go', intents: '#123' });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; detail: string };
    expect(body.error).toBe('bad-request');
    expect(body.detail.startsWith('intents:')).toBe(true);
    // D-8085: a grammar refusal is answered before any fleet act, writes no row and leaves the run planned.
    expect(f.calls).toHaveLength(0);
    expect(f.state(a)).toBe('planned');
    expect(f.rowCount(a)).toBe(0);
    // Review 1660 A2: nor is the registry directory listed (the pause and caps read follows the request step).
    expect(f.listings).toHaveLength(0);
  });

  it('CONTROL: a dispatch that succeeds lists the registry directory at least once', async () => {
    const f = await make();
    const a = f.open('prog-a', 1);
    expect((await f.post(a, { brief: 'go', intents: ['#123'] })).statusCode).toBe(200);
    expect(f.listings.length).toBeGreaterThanOrEqual(1);
  });
});

// Review 1654 F2: the route re-runs the whole decision once after `worker-starting`, so the held read runs again and
// a key taken during the wait refuses the re-run, after the first pass's `ensure` already started the bound pane.
describe('the worker-starting re-run repeats the held check', () => {
  it('a key another programme takes during the wait answers 409 intent-held; the run stays planned, no hold, no row', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const home = mkTmp('ccrc-intents-restart-');
      const id = 'project-a-bound1';
      const pane = 5151;
      seed(home, id, 'project-a');
      rmSync(path.join(home, '.cc-sessions', `${id}.child`)); // a bound worker with no child marker
      const reg = path.join(home, '.cc-sessions');
      writeFileSync(path.join(reg, `${id}.hookstate.json`), JSON.stringify({
        v: 1, state: 'done', sessionId: `u-${id}`, updatedAt: Date.now() - 30_000, event: 'Stop' }));
      const calls: string[][] = [];
      let ensures = 0;
      const run: Runner = async (_cmd, args) => {
        calls.push(args);
        if (args[0] === 'ensure') {
          const first = ++ensures === 1;
          return { ran: true as const, code: 0, stdout: first ? `ensured ${id}\n` : `alive: ${id}\n`, stderr: '' };
        }
        if (args[0] === 'list-panes') return { ran: true as const, code: 0, stdout: `${pane}\n`, stderr: '' };
        return { ran: true as const, code: 0, stdout: '', stderr: '' };
      };
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord });
      live = app;
      const o = coord.openRun({ program: 'prog-a', title: 't', project: 'project-a', wave: 2, waveOf: 3, claimedBy: 'coord-a' });
      if (!('id' in o)) throw new Error('fixture openRun refused');
      coord.setSession(o.id, id);
      let res: Awaited<ReturnType<typeof app.inject>> | undefined;
      // `inject` is lazy until it is awaited or `then`-ed: start it now.
      const p = Promise.resolve(app.inject({ method: 'POST', url: `/api/runs/${o.id}/dispatch`,
        headers: { 'x-ccrc-mail-token': TOKEN }, payload: { brief: 'go', intents: ['#123'] } })).then((r) => { res = r; });
      // First pass: ensure started the pane, no live file yet, so the route parks on its poll timer.
      for (const until = Date.now() + 8000; Date.now() < until && vi.getTimerCount() === 0;) await new Promise<void>((r) => { setImmediate(r); });
      expect(vi.getTimerCount(), JSON.stringify(calls) + (res?.body ?? 'pending')).toBeGreaterThan(0);
      expect(ensures).toBe(1);
      // During the wait: programme B's run takes the key through the real store path, and the pane comes up idle.
      const b = coord.openRun({ program: 'prog-b', title: 't', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'coord-b' });
      if (!('id' in b)) throw new Error('fixture openRun refused');
      expect(coord.dispatchRun({ runId: b.id, sessionId: 'ws-b', workspace: null, branch: null, resumed: false,
        clearedAt: null, items: [], intents: ['#123'] }).ok).toBe(true);
      mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
      writeFileSync(path.join(home, '.claude', 'sessions', `${pane}.json`),
        JSON.stringify({ pid: pane, sessionId: `u-${id}`, status: 'idle', statusUpdatedAt: Date.now() - 60_000 }));
      for (let i = 0; i < 200 && res === undefined; i++) {
        await vi.advanceTimersByTimeAsync(DISPATCH_SPAWN_POLL_MS);
        await new Promise<void>((r) => { setImmediate(r); });
      }
      await p;
      expect(res?.statusCode, res?.body).toBe(409);
      expect(res?.json()).toEqual({ ok: false, refused: 'intent-held', key: '#123', holder: { runId: b.id, program: 'prog-b' } });
      expect(ensures).toBe(1);
      expect(calls.filter((c) => c[0] === 'ws-hold')).toHaveLength(0);
      expect((coord.db.prepare('SELECT state FROM runs WHERE id = ?').get(o.id) as { state: string }).state).toBe('planned');
      expect((coord.db.prepare('SELECT COUNT(*) AS n FROM landing_intents WHERE runId = ?').get(o.id) as { n: number }).n).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
