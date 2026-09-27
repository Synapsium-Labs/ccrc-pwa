// Routing spec 2026-09-14, slice 4, Task 6 — `GET /api/projects?class=`: the
// same per-project placement forecast `projects-route-placement.test.ts`
// pins, now asked "who could take this project running THAT class today",
// never a second copy of the pool machinery those tests already drive.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { sweepLatestPath } from '../src/shares.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { ProjectPlacement, ProjectPoolWire } from '../../shared/api.js';

let home: string;
let projectsRoot: string;
let app: FastifyInstance | undefined;

const dead: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

const open = async (io: FleetIO = localIO): Promise<FastifyInstance> => {
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot });
  const a = await buildServer({
    cfg, runCcd: ccdRunner(dead, cfg), tmux: new Tmux(dead), io, queue: new KeyedQueue(),
  });
  await a.ready();
  return a;
};

const getProjects = (
  a: FastifyInstance, qs = '',
): Promise<{ statusCode: number; json: () => unknown }> =>
  a.inject({ method: 'GET', url: `/api/projects${qs}` });

const rowsOf = (body: unknown): Array<{ name: string; pool: ProjectPoolWire; placement: ProjectPlacement }> =>
  (body as { projects: Array<{ name: string; pool: ProjectPoolWire; placement: ProjectPlacement }> }).projects;

const limits = (w: string, five: number, seven: number): void => {
  const dir = path.join(home, '.cc-limits');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${w}.json`), JSON.stringify({
    five, seven, ts: Math.floor(Date.now() / 1000) - 60,
    fiveResetAt: Math.floor(Date.now() / 1000) + 9000,
    sevenResetAt: Math.floor(Date.now() / 1000) + 400000,
  }));
};

/** Plants `~/.cc-sessions/usage/sweep/latest.json` the way `ccd-serviceable
 *  .test.ts`/`shares.test.ts` plant it — one fresh reading, every named
 *  account at the same Fable-share estimate (a fraction, `shareFor`'s own
 *  `pct` rounds it to a percent). */
const plantSweep = (accounts: readonly string[], estimate: number): void => {
  const dir = path.join(home, '.cc-sessions', 'usage', 'sweep');
  mkdirSync(dir, { recursive: true });
  const finishedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const perAccount = Object.fromEntries(accounts.map((id) => [id, { fableShare: { estimate } }]));
  writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ finishedAt, perAccount }));
};

const ANTHROPIC_HOME_ABLE = ['claude', 'claude-a', 'claude-b', 'claude-d'] as const;

beforeEach(() => {
  home = mkTmp('ccrc-projects-class-');
  seedRoster(home, DEFAULT_TEST_ROSTER);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  projectsRoot = mkTmp('ccrc-projects-class-root-');
  mkdirSync(path.join(projectsRoot, 'demo'));
  for (const w of ANTHROPIC_HOME_ABLE) limits(w, 10, 10);
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  rmSync(home, { recursive: true, force: true });
  rmSync(projectsRoot, { recursive: true, force: true });
});

describe('GET /api/projects?class= — the placement forecast by class', () => {
  it('every home-able lane at the Fable share ceiling forecasts none, naming the class', async () => {
    // 0.5 -> 50%, safely over FABLE_SHARE_CEILING_PCT (40) for every account
    // the untagged project's forecast would otherwise consider.
    plantSweep(ANTHROPIC_HOME_ABLE, 0.5);
    app = await open();
    const res = await getProjects(app, '?class=fable');
    expect(res.statusCode).toBe(200);
    const demo = rowsOf(res.json()).find((p) => p.name === 'demo')!;
    expect(demo.placement).toEqual({ kind: 'none', pool: null, class: 'fable' });
  });

  it('refuses a class outside the vocabulary before any read', async () => {
    app = await open();
    const res = await getProjects(app, '?class=bogus');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail: 'class: not in the vocabulary' });
  });

  it('`?class=default` answers exactly what no `class` query answers', async () => {
    app = await open();
    const plain = await getProjects(app);
    const named = await getProjects(app, '?class=default');
    expect(plain.statusCode).toBe(200);
    expect(named.json()).toEqual(plain.json());
  });

  it('no `class` query never reads the shares sweep file at all — a malformed sweep changes nothing', async () => {
    // A malformed sweep is not, by itself, proof of "no read": `readSharesMeasured`
    // catches a `JSON.parse` failure into `{ kind: 'malformed' }`
    // (parseSweepShares, src/shares.ts), and `projectHome` ignores `shares`
    // outright once `cls === 'default'` (src/limits.ts) — so a route that
    // read this file unconditionally would land on the exact same
    // `projected` result asserted below. The only assertion that actually
    // pins "no read at all" is on the recorded path list itself.
    mkdirSync(path.join(home, '.cc-sessions', 'usage', 'sweep'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'usage', 'sweep', 'latest.json'), 'not json');
    const registryDir = path.join(home, '.cc-sessions');
    const readPaths: string[] = [];
    const spyIO: FleetIO = {
      ...localIO,
      async readFileMeasured(p, timeoutMs, signal) {
        readPaths.push(p);
        return localIO.readFileMeasured(p, timeoutMs, signal);
      },
    };
    app = await open(spyIO);
    const res = await getProjects(app);
    expect(res.statusCode).toBe(200);
    expect(readPaths).not.toContain(sweepLatestPath(registryDir));
    const demo = rowsOf(res.json()).find((p) => p.name === 'demo')!;
    // Ties go to the earlier account in roster declaration order (claude).
    expect(demo.placement).toEqual({ kind: 'projected', wrapper: 'claude', score: 10 });
  });
});
