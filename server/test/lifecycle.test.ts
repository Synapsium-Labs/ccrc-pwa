import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner, listProjects } from '../src/lifecycle.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { mkTmp } from './tmpHelpers.js';

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
  const home = mkTmp('ccrc-');
  seedDefault(home);
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return opts.fail ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' };
  };
  const env: NodeJS.ProcessEnv = { CCRC_HOME: home };
  if (opts.projectsRoot) env.CCRC_PROJECTS_ROOT = opts.projectsRoot;
  const cfg = loadConfig(env);
  const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO });
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

  it('POST /api/sessions/:id/stop uses the id-prefix wrapper, not a swapped registry wrapper', async () => {
    // After `ccd swap`, the registry `wrapper` field flips to the new account but
    // the session id and tmux name keep the ORIGINAL wrapper prefix
    // (claude2-cctest). Stop must target the id's prefix wrapper so ccd recomputes
    // the correct id — using the swapped wrapper would kill a nonexistent session
    // and leave the real one alive.
    const home = mkTmp('ccrc-');
    seedSession(home, 'claude2-cctest', {
      wrapper: 'claude',            // swapped to claude…
      project: 'cctest',
      workdir: '/data/projects/cctest',
      uuid: '2'.repeat(36),
      started: '1',
      lastswap: '1784650000',
    });
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO });
    const res = await app.inject({ method: 'POST', url: '/api/sessions/claude2-cctest/stop', payload: {} });
    expect(res.statusCode).toBe(200);
    // …but stop must still target claude2-cctest, not claude-cctest.
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'cctest']]);
    await app.close();
  });

  it('POST /api/sessions/:id/stop passes a WORKSPACE id whole, never a reversed one', async () => {
    // A workspace id is `<project>-<slug>`, not `<wrapper>-<project>`. Reversing
    // it cannot work: `rp-llm-quiet-mesa` does not end in `-rp-llm`, so the
    // prefix rule falls through to rec.wrapper and ccd recomputes
    // `claude-rp-llm` — a DIFFERENT, live session. It would then kill tmux
    // cc-claude-rp-llm and disable claude-session@claude-rp-llm, exit 0, and
    // the PWA would report success while the workspace kept running.
    const home = mkTmp('ccrc-');
    seedSession(home, 'rp-llm-quiet-mesa', {
      wrapper: 'claude',
      project: 'rp-llm',
      workspace: 'quiet-mesa',
      workdir: '/home/rc/worktrees/rp-llm/quiet-mesa',
      uuid: '3'.repeat(36),
      started: '1',
    });
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO });
    const res = await app.inject({ method: 'POST', url: '/api/sessions/rp-llm-quiet-mesa/stop', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'rp-llm-quiet-mesa']]);
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
    const root = mkTmp('ccrc-projects-');
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

    const direct = await listProjects(localIO, cfg);
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
    const out = await listProjects(localIO, cfg);
    expect(out.roots).toEqual(['/nope/does-not-exist']);
    expect(out.projects).toEqual([{ name: 'MekWarLive', workdir: '/data/projects/MekWarLive' }]);
    await app.close();
  });
});

// The composition-root factory task 13S introduced: it is the ONLY thing that
// turns a raw `Runner` into the single `Deps.runCcd` capability, so every route
// above reaches ccd through it. Covered directly because nothing else can see
// its three decisions apart — which binary it names, how it maps an exit code,
// and whether a failure still carries the output the 502 body quotes.
describe('ccdRunner — the one ccd capability Deps carries', () => {
  const spy = (result: { code: number; stdout: string; stderr: string }) => {
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return result; };
    return { run, calls };
  };
  const cfg = loadConfig({ CCRC_HOME: mkTmp('ccrc-') });

  it('names cfg.ccdBin and passes the argv tokens through verbatim', async () => {
    const { run, calls } = spy({ code: 0, stdout: '', stderr: '' });
    await ccdRunner(run, cfg)(CCD_ARGV.wsReap('a'.repeat(64), ID));
    expect(calls).toEqual([[cfg.ccdBin, 'ws-reap', '--expect', 'a'.repeat(64), '--session', ID]]);
  });

  it('ok is exit code 0 and nothing else', async () => {
    const zero = spy({ code: 0, stdout: '', stderr: '' });
    const one = spy({ code: 1, stdout: '', stderr: '' });
    const other = spy({ code: 127, stdout: '', stderr: '' });
    expect((await ccdRunner(zero.run, cfg)(CCD_ARGV.ensure(ID))).ok).toBe(true);
    expect((await ccdRunner(one.run, cfg)(CCD_ARGV.ensure(ID))).ok).toBe(false);
    expect((await ccdRunner(other.run, cfg)(CCD_ARGV.ensure(ID))).ok).toBe(false);
  });

  it('passes stdout and stderr through untouched on success', async () => {
    const { run } = spy({ code: 0, stdout: 'out\n', stderr: 'warn\n' });
    expect(await ccdRunner(run, cfg)(CCD_ARGV.wsAudit(ID)))
      .toEqual({ ok: true, stdout: 'out\n', stderr: 'warn\n' });
  });

  it('a FAILURE still carries stdout and stderr — the 502 body quotes stderr', async () => {
    const { run } = spy({ code: 1, stdout: 'partial\n', stderr: 'boom\n' });
    expect(await ccdRunner(run, cfg)(CCD_ARGV.wsArchive(ID)))
      .toEqual({ ok: false, stdout: 'partial\n', stderr: 'boom\n' });
  });
});
