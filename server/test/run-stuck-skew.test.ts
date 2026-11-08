// D-8071 (spec §7, §11.2, A45, A60, A61): the verdict's wire, in both directions. The frame, its cold start, `GET /api/runs`
// and `GET /api/runs/:id` all read the watcher's one in-memory reader; an empty reader (a server before its first pass, a
// restart, no watcher at all) stamps nothing, and a reader that has an answer stamps all four fields.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { watcherTeardown } from './watcherTeardown.js';

const COORDINATOR = 'lane-a-coordinator';
const MAIL_TOKEN = 'f'.repeat(64);

const seedSession = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude-a', project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

interface Row { id: number; stuck?: unknown; waitsOn?: unknown; blockedBy?: unknown; coordinatorGone?: unknown }

const firstRuns = (ws: WebSocket): Promise<Row[]> => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timed out waiting for a runs frame')), 3000);
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as { type?: unknown; runs?: Row[] };
    if (m.type === 'runs') { clearTimeout(t); resolve(m.runs ?? []); }
  });
});

describe('the stuck verdict on the wire (D-8071)', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  const teardown = watcherTeardown();
  beforeEach(() => { home = mkTmp('ccrc-stuck-wire-'); seedRoster(home); seedSession(home, COORDINATOR); });
  afterEach(async () => { const closing = app; app = undefined; await teardown.remove(home, closing); });

  async function start(withWatcher: boolean): Promise<{ watcher: FleetWatcher | undefined; runId: number; port: number; emitted: Row[][] }> {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'programme-a', title: 'Lane A', project: 'project-a', wave: 1, waveOf: 3, claimedBy: COORDINATOR }) as { id: number };
    const deps = { ...testDeps(home), coord, mailToken: MAIL_TOKEN };
    const bus = new Bus();
    const emitted: Row[][] = [];
    bus.on('runs', (runs) => emitted.push(runs as unknown as Row[]));
    const watcher = withWatcher ? teardown.track(new FleetWatcher(deps, bus, 10_000)) : undefined;
    app = await buildServer(deps, bus, watcher);
    if (watcher !== undefined) await watcher.tick();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    return { watcher, runId: opened.id, emitted, port: typeof addr === 'object' && addr !== null ? addr.port : 0 };
  }
  const get = async (url: string) => (await app!.inject({ method: 'GET', url, headers: { 'x-ccrc-mail-token': MAIL_TOKEN } })).json() as
    { runs?: Row[]; run?: Row };

  it('an empty reader stamps nothing: no watcher, and a watcher before its first answer', async () => {
    const bare = await start(false);
    const rows = (await get('/api/runs')).runs!;
    expect(rows.map((r) => r.id)).toEqual([bare.runId]);
    for (const k of ['stuck', 'waitsOn', 'blockedBy', 'coordinatorGone']) expect(k in rows[0]!).toBe(false);
    expect('stuck' in (await get(`/api/runs/${bare.runId}`)).run!).toBe(false);
  });

  it('the frame, its cold start, GET /api/runs and GET /api/runs/:id all carry the verdict', async () => {
    const { watcher, runId, port, emitted } = await start(true);
    const stuck = { reason: 'never-started' as const, cause: null, since: 5, closes: null };
    // Let the first pass land, then put a known answer in the reader.
    await new Promise((r) => setTimeout(r, 50));
    watcher!.runVerdicts.replace(new Map([[runId, { stuck, waitsOn: 'coordinator' as const, blockedBy: null, coordinatorGone: false }]]), new Map());
    const want = { stuck, waitsOn: 'coordinator', blockedBy: null, coordinatorGone: false };

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
    const cold = firstRuns(ws);
    await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
    expect((await cold).find((r) => r.id === runId)).toMatchObject(want);
    ws.close();

    expect((await get('/api/runs')).runs!.find((r) => r.id === runId)).toMatchObject(want);
    // The live frame: the reader changed with no run changing, so the next tick pushes a new frame that carries it.
    await watcher!.tick();
    expect(emitted.at(-1)!.find((r) => r.id === runId)).toMatchObject(want);
    expect((await get(`/api/runs/${runId}`)).run).toMatchObject(want);
  });
});
