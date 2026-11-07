// Landing order wave 5g (Task 2, D-8083 to D-8086): a dispatch names its landing intents, and another programme's
// hold on one refuses it. Through the route, with the fixture `ccd` recording its calls; each case on a fresh fixture.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
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
  const app = await buildServer({ ...base, mailToken: TOKEN, coord });
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
  return { app, coord, calls, open, post, state, rowCount };
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
  });
});
