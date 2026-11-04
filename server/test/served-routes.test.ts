// Console speed S2, per-request reads: the three routes the phone polls (`GET /api/accounts`, `GET /api/projects`,
// `GET /api/fleet`) answer over ONE fixture HOME with NO watcher, so every field comes from the route's own reads.
// This file pins today's status and body shape: later steps add the "fresh watcher state answers with ageMs" cases
// beside these, and the cases here must stay green when they do.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const now = (): number => Math.floor(Date.now() / 1000);
const WORKDIR = (home: string): string => path.join(home, 'projects', 'project-a');
const ROWS = ['claude-project-a-sess-a', 'claude-project-a-sess-b'] as const;

/** One fixture: a limits file for one account, a project directory, two registry rows on it. */
function fixture(): { home: string } {
  const home = mkTmp('ccrc-served-routes-');
  const limits = path.join(home, '.cc-limits');
  mkdirSync(limits, { recursive: true });
  const t = now();
  writeFileSync(path.join(limits, 'claude.json'),
    JSON.stringify({ five: 12, seven: 34, ts: t - 30, fiveResetAt: t + 3600, sevenResetAt: t + 200000 }));
  const workdir = WORKDIR(home);
  mkdirSync(path.join(workdir, '.git'), { recursive: true });
  writeFileSync(path.join(workdir, 'README'), 'x');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const id of ROWS) {
    const fields: Record<string, string> = {
      wrapper: 'claude', project: 'project-a', workdir, uuid: `u-${id}`, started: '1', workspace: id, branch: `ws/${id}`,
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  }
  return { home };
}

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; });

/** A server over the fixture with no watcher (the third argument of `buildServer` left out). */
async function get(url: string): Promise<{ status: number; body: Record<string, unknown>; home: string }> {
  const f = fixture();
  app = await buildServer(testDeps(f.home));
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, home: f.home };
}

/** A fleet row's keys, as the route sends them today (a field added later is an additive change this list takes). */
const FLEET_ROW_KEYS = [
  'archivedAt', 'archivedBytes', 'ask', 'askSummary', 'background', 'boardProject', 'branch', 'bucket', 'bucketSince',
  'child', 'ctxPct', 'deadSince', 'dialogPending', 'effort', 'graphGateDenials', 'graphQueries', 'held', 'hibernatedAt',
  'home', 'hookState', 'id', 'lastEnd', 'lifecycle', 'limits', 'model', 'name', 'openRun', 'paneCols', 'pr', 'presence',
  'project', 'releasedFrom', 'role', 'route', 'run', 'spawnState', 'started', 'status', 'statusUnmeasured',
  'statusUpdatedAt', 'stoppedBy', 'stranded', 'subagents', 'substrate', 'swapBlocked', 'tasks', 'title', 'ultracode',
  'unmeasured', 'usage', 'version', 'withCoordinator', 'workdir', 'workspace', 'wrapper',
];

describe('served routes with no watcher: today\'s answers (console speed S2, step 0)', () => {
  it('GET /api/accounts: the measured account, the projection and the roster', async () => {
    const r = await get('/api/accounts');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['accounts', 'projected', 'roster']);
    const accounts = r.body.accounts as { wrapper: string; five: number; seven: number }[];
    expect(accounts.map((a) => [a.wrapper, a.five, a.seven])).toEqual([['claude', 12, 34]]);
    expect(Object.keys(accounts[0]!).sort()).toEqual([
      'authDead', 'disabled', 'five', 'fiveResetAt', 'fiveRolledOver', 'seven', 'sevenResetAt', 'sevenRolledOver',
      'ts', 'wrapper',
    ]);
    expect(r.body.projected).toEqual({ wrapper: 'claude', score: 34 });
    const roster = r.body.roster as { id: string }[];
    expect(roster.map((a) => a.id)).toEqual(['claude', 'claude-a', 'claude-b', 'gpt', 'claude-d']);
  });

  it('GET /api/projects: one project from the root, the registry listed, no age field', async () => {
    const r = await get('/api/projects');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['projects', 'registry', 'roots']);
    expect(r.body.registry).toBe('listed');
    expect(r.body.roots).toEqual([path.join(r.home, 'projects')]);
    const projects = r.body.projects as Record<string, unknown>[];
    expect(projects.map((p) => [p.name, p.workdir])).toEqual([['project-a', WORKDIR(r.home)]]);
    expect(Object.keys(projects[0]!).sort()).toEqual(['name', 'placement', 'pool', 'readiness', 'repo', 'workdir']);
    expect(projects[0]).toMatchObject({
      readiness: null, pool: { state: 'untagged' }, placement: { kind: 'projected', wrapper: 'claude', score: 34 },
      repo: { state: 'unmeasured' },
    });
    expect('ageMs' in r.body).toBe(false);
  });

  it('GET /api/fleet: both registry rows, dead and orphaned, and the pools block', async () => {
    const r = await get('/api/fleet');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['pools', 'sessions']);
    const sessions = r.body.sessions as Record<string, unknown>[];
    expect(sessions.map((s) => s.id)).toEqual([...ROWS]);
    for (const s of sessions) {
      expect(Object.keys(s).sort()).toEqual(FLEET_ROW_KEYS);
      expect(s).toMatchObject({
        wrapper: 'claude', project: 'project-a', workdir: WORKDIR(r.home), status: 'dead', lifecycle: 'orphan',
        bucket: 'dead', limits: { five: 12, seven: 34 }, unmeasured: [], started: true,
      });
    }
    expect(r.body.pools).toEqual({
      listed: true, byProject: {}, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown',
    });
    expect('stale' in r.body).toBe(false);
    expect('ageMs' in r.body).toBe(false);
  });
});
