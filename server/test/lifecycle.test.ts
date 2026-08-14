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
import { KeyedQueue } from '../src/inject/queue.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

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

/** Server over a seeded one-session registry; every exec succeeds (or fails with stderr 'boom').
 *  `ccdVerbs`, when given, seeds a real `fleetState` (mirroring
 *  `coord-pause-route.test.ts`'s own pattern) — the shape a skew test needs
 *  to prove the server's DECISION, not just its argv. */
async function makeApp(
  opts: { fail?: boolean; projectsRoot?: string; ccdVerbs?: string[] | null } = {},
): Promise<{
  app: FastifyInstance;
  calls: string[][];
  cfg: CcrcConfig;
  home: string;
}> {
  const home = mkTmp('ccrc-');
  seedRoster(home);
  seedDefault(home);
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return opts.fail ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' };
  };
  const env: NodeJS.ProcessEnv = { CCRC_HOME: home };
  if (opts.projectsRoot) env.CCRC_PROJECTS_ROOT = opts.projectsRoot;
  const cfg = loadConfig(env);
  const app = await buildServer({
    cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
    ...(opts.ccdVerbs !== undefined
      ? { fleetState: { connected: true, downSince: null, ccdVerbs: opts.ccdVerbs } }
      : {}),
  });
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
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive', '--surface', 'pwa']]);
    await app.close();
  });

  // Fix round 2 (task 14 follow-up, Important #1): the SKEW CASE the plan
  // owner named directly. Round 1 sent `--surface pwa` unconditionally,
  // measured against `origin/main`'s real pre-flag ccd (which this repo
  // still deploys until BOTH `deploy/deploy.sh` targets have run, since only
  // the agent target installs ccd and neither cross-checks the other's
  // version): `ccd stop <id> --surface pwa` parses on that ccd as a
  // TWO-ARGUMENT stop of a session literally named `<id>---surface`, exit 0,
  // real session untouched. Reproduced directly (not just reasoned about,
  // per DISPATCH-CONTEXT's own rule) against `origin/main:ccd/ccd` under a
  // scratch HOME:
  //   cmd_stop demo-quiet-mesa --surface pwa
  //   -> systemctl --user disable --now claude-session@demo-quiet-mesa---surface
  //   -> tmux kill-session -t cc-demo-quiet-mesa---surface
  //   -> stopped demo-quiet-mesa---surface   rc=0
  // and the SAME old binary given the fallback bare argv instead:
  //   cmd_stop demo-quiet-mesa
  //   -> systemctl --user disable --now claude-session@demo-quiet-mesa
  //   -> tmux kill-session -t cc-demo-quiet-mesa
  //   -> stopped demo-quiet-mesa   rc=0
  // — the REAL session, correctly. `ccdVerbs` without `stop-surface` is
  // exactly the shape the agent reports for that old ccd (it lists `stop`
  // but never prints the new capability token), so this test drives the
  // SAME decision the route makes in that real deployment window.
  it('a fleet ccd that does not advertise stop-surface gets the bare argv old ccd understands (the skew case)', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['start', 'enable', 'ensure', 'stop', 'swap'] });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    // The genuinely load-bearing assertion: this must be 200 because the
    // bare argv sent is one old ccd ACTUALLY EXECUTES, not a 200 papering
    // over a no-op — the whole point is that the fallback is a real stop,
    // not a degraded failure.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive']]);
    await app.close();
  });

  it('a fleet ccd that DOES advertise stop-surface still gets --surface pwa (the capability check is not a permanent regression)', async () => {
    const { app, calls, cfg } = await makeApp({
      ccdVerbs: ['start', 'enable', 'ensure', 'stop', 'swap', 'stop-surface'],
    });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive', '--surface', 'pwa']]);
    await app.close();
  });

  // `null` (no evidence — local mode, or an agent that has not reported
  // caps yet) permits, matching `verbSupported`'s own policy for every
  // OTHER gated verb in this codebase: an absent list must never grey out
  // the fleet. This is a DELIBERATE, pre-existing risk the whole verb-gate
  // architecture already accepts, not a new one this fix introduces — see
  // `stopSurfaceSupported`'s own comment in ccdargv.ts.
  it('no evidence at all (ccdVerbs: null) still sends --surface pwa — consistent with every other gated verb', async () => {
    const { app, calls, cfg } = await makeApp({ ccdVerbs: null });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'MekWarLive', '--surface', 'pwa']]);
    await app.close();
  });

  it('POST /api/sessions/:id/stop uses the id-prefix wrapper, not a swapped registry wrapper', async () => {
    // After `ccd swap`, the registry `wrapper` field flips to the new account but
    // the session id and tmux name keep the ORIGINAL wrapper prefix
    // (claude2-cctest). Stop must target the id's prefix wrapper so ccd recomputes
    // the correct id — using the swapped wrapper would kill a nonexistent session
    // and leave the real one alive.
    const home = mkTmp('ccrc-');
    seedRoster(home);
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
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'POST', url: '/api/sessions/claude2-cctest/stop', payload: {} });
    expect(res.statusCode).toBe(200);
    // …but stop must still target claude2-cctest, not claude-cctest.
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'claude2', 'cctest', '--surface', 'pwa']]);
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
    seedRoster(home);
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
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'POST', url: '/api/sessions/rp-llm-quiet-mesa/stop', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'stop', 'rp-llm-quiet-mesa', '--surface', 'pwa']]);
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

  it('a linked worktree cannot masquerade as a project — either door', async () => {
    const root = mkTmp('ccrc-projects-');
    // (a) a dir under the root whose `.git` is a FILE, not a directory — a
    // linked worktree (or submodule) pointer. Must be skipped.
    const linkedInRoot = path.join(root, 'linked');
    mkdirSync(linkedInRoot);
    writeFileSync(path.join(linkedInRoot, '.git'), 'gitdir: /elsewhere/.git/worktrees/linked\n');
    // (b) a plain dir with NO .git at all — a legitimate non-git project.
    // Must stay listed, not be swept up by the new probe.
    mkdirSync(path.join(root, 'plain'));

    // (c) a registry record whose workdir readdir-probes as a linked
    // worktree. Must be skipped by the union loop too.
    const linkedRegistryWorkdir = mkTmp('ccrc-linked-');
    writeFileSync(path.join(linkedRegistryWorkdir, '.git'), 'gitdir: /elsewhere/.git/worktrees/other\n');

    const { app, cfg, home } = await makeApp({ projectsRoot: root });
    // `makeApp` -> `seedDefault` seeds `ID` at the box's REAL
    // `/data/projects/MekWarLive`, which every other test can ignore because it
    // never readdirs that path. This test's whole point is that the union loop
    // NOW readdirs every registry workdir, so a real path outside the sandbox
    // would make the result depend on whatever this box's disk happens to hold
    // at that path rather than on the fixture — repointed at a plain fixture
    // directory (ordinary, `.git`-less, like case (b)) under the test's own
    // tmp root instead, via the same `seedSession` shape `seedDefault` uses,
    // so the expectation holds identically on every box and in CI.
    const defaultWorkdir = mkTmp('ccrc-mekwarlive-');
    seedSession(home, ID, { workdir: defaultWorkdir });
    seedSession(home, 'claude-linked', {
      wrapper: 'claude', project: 'linked-registry', workdir: linkedRegistryWorkdir,
      uuid: '4'.repeat(36), started: '1',
    });
    // (d) a registry record whose workdir does not exist at all. readdir-null
    // is fail-open — it stays listed, same as before this probe existed.
    seedSession(home, 'claude-gone', {
      wrapper: 'claude', project: 'gone', workdir: path.join(root, 'does-not-exist'),
      uuid: '5'.repeat(36), started: '1',
    });

    const out = await listProjects(localIO, cfg);
    expect(out.projects).toEqual([
      { name: 'MekWarLive', workdir: defaultWorkdir },                // default seeded registry session — fixture, not the box's real path
      { name: 'gone', workdir: path.join(root, 'does-not-exist') },  // missing workdir — stays listed
      { name: 'plain', workdir: path.join(root, 'plain') },
    ]);

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
  const ccdRunnerHome = mkTmp('ccrc-');
  seedRoster(ccdRunnerHome);
  const cfg = loadConfig({ CCRC_HOME: ccdRunnerHome });

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
