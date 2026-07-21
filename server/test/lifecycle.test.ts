import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { listProjects } from '../src/lifecycle.js';

const ID = 'claude2-MekWarLive';

const seedSession = (home: string, id: string, fields: Record<string, string>) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const seedDefault = (home: string) =>
  seedSession(home, ID, {
    wrapper: 'claude2',
    project: 'MekWarLive',
    workdir: '/data/projects/MekWarLive',
    uuid: '1'.repeat(36),
    started: '1',
  });

/** Server over a seeded one-session registry; every exec succeeds (or fails with stderr 'boom'). */
async function makeApp(opts: { fail?: boolean; projectsRoot?: string } = {}): Promise<{
  app: FastifyInstance;
  calls: string[][];
  cfg: CcrcConfig;
  home: string;
}> {
  const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
  seedDefault(home);
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return opts.fail ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' };
  };
  const env: NodeJS.ProcessEnv = { CCRC_HOME: home };
  if (opts.projectsRoot) env.CCRC_PROJECTS_ROOT = opts.projectsRoot;
  const cfg = loadConfig(env);
  const app = await buildServer({ cfg, run, tmux: new Tmux(run) });
  return { app, calls, cfg, home };
}

describe('lifecycle routes', () => {
  it('POST /api/sessions defaults to ccd enable', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'foo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([[cfg.ccdBin, 'enable', 'claude', 'foo']]);
    await app.close();
  });

  it('POST /api/sessions with enable:false and workdir uses ccd start with the workdir arg', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { wrapper: 'claude', project: 'foo', workdir: '/data/projects/foo', enable: false },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'start', 'claude', 'foo', '/data/projects/foo']]);
    await app.close();
  });

  it('POST /api/sessions/:id/ensure passes the id through', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/ensure`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([[cfg.ccdBin, 'ensure', ID]]);
    await app.close();
  });

  it('POST /api/sessions/:id/stop derives wrapper+project from the registry', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive']]);
    await app.close();
  });

  it('POST /api/sessions/:id/stop on an unknown id returns 404 without calling ccd', async () => {
    const { app, calls } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/sessions/nope/stop', payload: {} });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it('POST /api/sessions/:id/swap sends exact argv', async () => {
    const { app, calls, cfg } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/swap`,
      payload: { wrapper: 'claude' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'swap', ID, 'claude']]);
    await app.close();
  });

  it('a failing ccd maps to 502 with stderr', async () => {
    const { app } = await makeApp({ fail: true });
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/swap`,
      payload: { wrapper: 'claude' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'boom' });
    await app.close();
  });
});

describe('listProjects', () => {
  it('merges projects-root directories with registry workdirs, deduped by workdir', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ccrc-projects-'));
    mkdirSync(path.join(root, 'alpha'));
    mkdirSync(path.join(root, 'mekwar'));
    mkdirSync(path.join(root, '.hidden'));               // dotfile — skipped
    writeFileSync(path.join(root, 'stray.txt'), 'x');    // plain file — skipped

    const { app, cfg, home } = await makeApp({ projectsRoot: root });
    // Duplicate of a projects-root dir (same workdir) + one workdir outside the root.
    seedSession(home, 'claude-mekwar', {
      wrapper: 'claude', project: 'mekwar', workdir: path.join(root, 'mekwar'),
      uuid: '2'.repeat(36), started: '1',
    });
    seedSession(home, 'claude-otherproj', {
      wrapper: 'claude', project: 'otherproj', workdir: '/data/projects/other-place',
      uuid: '3'.repeat(36), started: '1',
    });

    const direct = await listProjects(cfg);
    expect(direct.roots).toEqual([root]);
    expect(direct.projects).toEqual([
      { name: 'MekWarLive', workdir: '/data/projects/MekWarLive' },   // default seeded registry session
      { name: 'alpha', workdir: path.join(root, 'alpha') },
      { name: 'mekwar', workdir: path.join(root, 'mekwar') },         // present once despite registry duplicate
      { name: 'otherproj', workdir: '/data/projects/other-place' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(direct);
    await app.close();
  });

  it('returns registry-only projects when the projects root is missing', async () => {
    const { app, cfg } = await makeApp({ projectsRoot: '/nope/does-not-exist' });
    const out = await listProjects(cfg);
    expect(out.roots).toEqual(['/nope/does-not-exist']);
    expect(out.projects).toEqual([{ name: 'MekWarLive', workdir: '/data/projects/MekWarLive' }]);
    await app.close();
  });
});
